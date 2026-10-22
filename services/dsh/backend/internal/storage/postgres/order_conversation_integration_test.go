package postgres_test

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	_ "github.com/lib/pq"
)

func TestOrderConversationReturnsLatestBoundedHistoryAndReplaysAfterClosure(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("DSH_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("DSH_DATABASE_URL is required for order conversation persistence proof")
	}
	rootDB, err := sql.Open("postgres", databaseURL)
	if err != nil {
		t.Fatalf("open postgres: %v", err)
	}
	t.Cleanup(func() { _ = rootDB.Close() })
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	if err := rootDB.PingContext(ctx); err != nil {
		t.Fatalf("configured postgres is not reachable: %v", err)
	}

	withFreshDatabase(t, rootDB, databaseURL, func(ctx context.Context, db *sql.DB, records []postgres.MigrationRecord, migrationSQL []string) {
		if err := postgres.Migrate(ctx, db, records, migrationSQL, testDeliveryProofKeyring(t)); err != nil {
			t.Fatalf("apply DSH migrations: %v", err)
		}
		if err := postgres.VerifySchema(ctx, db, records); err != nil {
			t.Fatalf("verify canonical DSH schema: %v", err)
		}
		const (
			orderID  = "conversation-history-order"
			cartID   = "conversation-history-cart"
			storeID  = "conversation-history-store"
			cityID   = "conversation-history-city"
			clientID = "conversation-history-client"
		)
		if _, err := db.ExecContext(ctx, "INSERT INTO dsh.service_cities(id,display_name_ar,active) VALUES($1,$2,true)", cityID, "مدينة اختبار المحادثة"); err != nil {
			t.Fatalf("insert service city: %v", err)
		}
		insertCanonicalStoreFixture(t, ctx, db, canonicalStoreFixture{ID: storeID, PartnerActorID: "conversation-history-partner", Name: "متجر اختبار المحادثة"})
		if _, err := db.ExecContext(ctx, "INSERT INTO dsh.commerce_carts(id,client_actor_id,store_id,state,version) VALUES($1,$2,$3,'checked_out',1)", cartID, clientID, storeID); err != nil {
			t.Fatalf("insert cart: %v", err)
		}
		if _, err := db.ExecContext(ctx, `INSERT INTO dsh.commerce_orders(id,client_actor_id,store_id,cart_id,address_id,address_version,address_text,address_latitude,address_longitude,service_city_id,serviceability_policy_version,serviceability_status,serviceability_store_version,serviceability_address_version,state,total_amount_minor,currency,version,payment_intent_id,payment_method,payment_state,fulfillment_mode,payment_cash_amount_minor,recipient_mode,recipient_name,recipient_phone_e164,recipient_instructions)
			VALUES($1,$2,$3,$4,$5,1,$6,15.3694457,44.1910064,$7,'CITY_SCOPE_V1','SERVICEABLE',1,1,'CREATED',1800,'YER',1,$8,'CASH_ON_DELIVERY','REQUIRES_COLLECTION','BTHWANI_CAPTAIN',1800,'OTHER','Ali Recipient','+967712345678','Gate 2')`, orderID, clientID, storeID, cartID, "conversation-history-address", "عنوان اختبار المحادثة", cityID, "conversation-history-payment"); err != nil {
			t.Fatalf("insert order: %v", err)
		}
		order, err := postgres.ReadOrder(ctx, db, orderID)
		if err != nil || order.Recipient.Mode != "OTHER" || order.Recipient.Name == nil || *order.Recipient.Name != "Ali Recipient" || order.Recipient.PhoneE164 == nil || *order.Recipient.PhoneE164 != "+967712345678" || order.Recipient.Instructions == nil || *order.Recipient.Instructions != "Gate 2" {
			t.Fatalf("order readback lost the delivery-recipient snapshot: %+v err=%v", order.Recipient, err)
		}

		// Delegated Orders staff must share the owner conversation authority,
		// but an inactive grant or a catalog-only grant must never expose it.
		const staffID = "conversation-history-staff"
		if _, err := postgres.ReadOrderConversation(ctx, db, orderID, staffID, "partner", 10); !errors.Is(err, postgres.ErrOrderConversationForbidden) {
			t.Fatalf("ungranted Partner staff read Order conversation: %v", err)
		}
		if _, err := db.ExecContext(ctx, `INSERT INTO dsh.store_access_grants
			(id,store_id,owner_partner_actor_id,delegate_actor_id,permissions,state,version,expires_at,accepted_at)
			VALUES('conversation-history-staff-grant',$1,'conversation-history-partner',$2,ARRAY['catalog'],'active',1,clock_timestamp()+interval '7 days',clock_timestamp())`, storeID, staffID); err != nil {
			t.Fatalf("create delegated staff fixture: %v", err)
		}
		if _, err := postgres.ReadOrderConversation(ctx, db, orderID, staffID, "partner", 10); !errors.Is(err, postgres.ErrOrderConversationForbidden) {
			t.Fatalf("catalog-only staff read Order conversation: %v", err)
		}
		if _, err := db.ExecContext(ctx, `UPDATE dsh.store_access_grants SET permissions=ARRAY['orders']
			WHERE id='conversation-history-staff-grant'`); err != nil {
			t.Fatal(err)
		}
		if _, err := postgres.ReadOrderConversation(ctx, db, orderID, staffID, "partner", 10); err != nil {
			t.Fatalf("Orders-authorized staff cannot read conversation: %v", err)
		}
		staffBody := "رسالة اختبار صلاحية الطلب"
		staffMessage, staffReplay, err := postgres.SendOrderConversationMessage(ctx, db, orderID, staffID, "partner", staffBody,
			"conversation-staff-message-key", postgres.HashOrderConversationMessageRequest(orderID, staffBody), "conversation-staff-correlation")
		if err != nil || staffReplay {
			t.Fatalf("Orders-authorized staff cannot send conversation message: replay=%t err=%v", staffReplay, err)
		}
		if _, err := db.ExecContext(ctx, `UPDATE dsh.store_access_grants SET state='suspended'
			WHERE id='conversation-history-staff-grant'`); err != nil {
			t.Fatal(err)
		}
		if _, err := postgres.ReadOrderConversation(ctx, db, orderID, staffID, "partner", 10); !errors.Is(err, postgres.ErrOrderConversationForbidden) {
			t.Fatalf("suspended staff can still read conversation: %v", err)
		}
		if _, _, err := postgres.SendOrderConversationMessage(ctx, db, orderID, staffID, "partner", staffBody,
			"conversation-staff-suspended-key", postgres.HashOrderConversationMessageRequest(orderID, staffBody), "conversation-staff-suspended-correlation"); !errors.Is(err, postgres.ErrOrderConversationForbidden) {
			t.Fatalf("suspended staff can still send conversation messages: %v", err)
		}
		if _, err := postgres.ReadOrderConversation(ctx, db, orderID, "ungranted-other-staff", "partner", 10); !errors.Is(err, postgres.ErrOrderConversationForbidden) {
			t.Fatalf("foreign staff gained access through another person's grant: %v", err)
		}
		// Leave the existing bounded-history fixture untouched.
		if _, err := db.ExecContext(ctx, "DELETE FROM dsh.commerce_order_conversation_messages WHERE id=$1", staffMessage.ID); err != nil {
			t.Fatalf("remove temporary staff message from history fixture: %v", err)
		}

		// Directed messages are visible only to the chosen recipients, original sender,
		// and operations. Non-recipients cannot forge read acknowledgments.
		privateBody := "رسالة خاصة بالعمليات"
		privateMessage, privateReplay, err := postgres.SendOrderConversationMessage(ctx, db, orderID, clientID, "client", privateBody,
			"conversation-private-operator-key", postgres.HashOrderConversationMessageRequest(orderID, privateBody, "operator"), "conversation-private-operator-correlation", "operator")
		if err != nil || privateReplay {
			t.Fatalf("directed operator message: replay=%t err=%v", privateReplay, err)
		}
		if visible, err := postgres.ReadOrderConversation(ctx, db, orderID, "conversation-history-partner", "partner", 10); err != nil || len(visible.Messages) != 0 || visible.UnreadCount != 0 {
			t.Fatalf("private operator message leaked to store: %+v %v", visible, err)
		}
		if _, err := postgres.MarkOrderConversationRead(ctx, db, orderID, "conversation-history-partner", "partner", privateMessage.ID); !errors.Is(err, postgres.ErrOrderConversationMessageNotFound) {
			t.Fatalf("store acknowledged invisible private message: %v", err)
		}
		if visible, err := postgres.ReadOrderConversation(ctx, db, orderID, "conversation-test-operator", "operator", 10); err != nil || len(visible.Messages) != 1 || visible.Messages[0].ID != privateMessage.ID {
			t.Fatalf("operator cannot supervise targeted conversation: %+v %v", visible, err)
		}
		if visible, err := postgres.ReadOrderConversation(ctx, db, orderID, clientID, "client", 10); err != nil || len(visible.Messages) != 1 {
			t.Fatalf("sender cannot read own targeted message: %+v %v", visible, err)
		}
		if _, err := postgres.MarkOrderConversationRead(ctx, db, orderID, "conversation-test-operator", "operator", privateMessage.ID); err != nil {
			t.Fatalf("operator cannot acknowledge visible message: %v", err)
		}
		if _, _, err := postgres.SendOrderConversationMessage(ctx, db, orderID, clientID, "client", privateBody,
			"conversation-private-operator-key", postgres.HashOrderConversationMessageRequest(orderID, privateBody, "partner"), "conversation-private-changed-correlation", "partner"); !errors.Is(err, postgres.ErrOrderConversationIdempotency) {
			t.Fatalf("same key with changed recipient leaked or bypassed idempotency: %v", err)
		}
		if _, err := db.ExecContext(ctx, "DELETE FROM dsh.commerce_order_conversation_messages WHERE id=$1", privateMessage.ID); err != nil {
			t.Fatal(err)
		}

		// Private image bytes are never exposed as a public media URL.
		image := postgres.OrderConversationMedia{Kind: "image", ContentType: "image/png", Bytes: []byte{0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01}}
		imageBody := "صورة خاصة"
		imageHash := postgres.HashOrderConversationMediaRequest(orderID, imageBody, []string{"operator"}, image)
		imageMessage, replayed, err := postgres.SendOrderConversationMedia(ctx, db, orderID, clientID, "client", imageBody,
			"conversation-private-image-key", imageHash, "conversation-private-image-correlation", []string{"operator"}, image)
		if err != nil || replayed || imageMessage.MediaKind != "image" {
			t.Fatalf("private image send: %+v replay=%t err=%v", imageMessage, replayed, err)
		}
		if _, err := postgres.ReadOrderConversationMedia(ctx, db, orderID, "conversation-history-partner", "partner", imageMessage.ID); !errors.Is(err, postgres.ErrOrderConversationMessageNotFound) {
			t.Fatalf("private media leaked to partner: %v", err)
		}
		if found, err := postgres.ReadOrderConversationMedia(ctx, db, orderID, "conversation-test-operator", "operator", imageMessage.ID); err != nil || string(found.Bytes) != string(image.Bytes) || found.ContentType != "image/png" {
			t.Fatalf("operator private read: %+v %v", found, err)
		}
		if _, err := postgres.ReadOrderConversationMedia(ctx, db, "other-order", clientID, "client", imageMessage.ID); err == nil {
			t.Fatal("foreign order media exposed")
		}
		if prior, replay, err := postgres.SendOrderConversationMedia(ctx, db, orderID, clientID, "client", imageBody,
			"conversation-private-image-key", imageHash, "conversation-image-retry-correlation", []string{"operator"}, image); err != nil || !replay || prior.ID != imageMessage.ID {
			t.Fatalf("media retry duplicate: %+v %t %v", prior, replay, err)
		}
		if _, err := db.ExecContext(ctx, "DELETE FROM dsh.commerce_order_conversation_messages WHERE id=$1", imageMessage.ID); err != nil {
			t.Fatal(err)
		}

		const messageCount = 105
		firstMessageID := ""
		firstIdempotencyKey := ""
		createdAt := time.Date(2026, 9, 27, 10, 0, 0, 0, time.UTC)
		for index := 0; index < messageCount; index++ {
			body := fmt.Sprintf("رسالة %03d", index)
			idempotencyKey := fmt.Sprintf("conversation-message-key-%03d", index)
			correlationID := fmt.Sprintf("conversation-message-correlation-%03d", index)
			message, replayed, err := postgres.SendOrderConversationMessage(ctx, db, orderID, clientID, "client", body, idempotencyKey, postgres.HashOrderConversationMessageRequest(orderID, body), correlationID)
			if err != nil || replayed {
				t.Fatalf("send message %d: replayed=%t err=%v", index, replayed, err)
			}
			if index == 0 {
				firstMessageID = message.ID
				firstIdempotencyKey = idempotencyKey
			}
			if _, err := db.ExecContext(ctx, "UPDATE dsh.commerce_order_conversation_messages SET created_at=$2 WHERE id=$1", message.ID, createdAt.Add(time.Duration(index)*time.Second)); err != nil {
				t.Fatalf("set deterministic message order %d: %v", index, err)
			}
		}

		history, err := postgres.ReadOrderConversation(ctx, db, orderID, clientID, "client", 10)
		if err != nil {
			t.Fatalf("read bounded conversation: %v", err)
		}
		if len(history.Messages) != 10 || history.Messages[0].Body != "رسالة 095" || history.Messages[9].Body != "رسالة 104" {
			t.Fatalf("bounded conversation returned %d messages (%q through %q), want latest 10 in ascending order", len(history.Messages), history.Messages[0].Body, history.Messages[len(history.Messages)-1].Body)
		}

		if history.NextCursor == "" {
			t.Fatal("bounded history must expose an older-page cursor")
		}
		older, err := postgres.ReadOrderConversation(ctx, db, orderID, clientID, "client", 10, history.NextCursor)
		if err != nil || len(older.Messages) != 10 || older.Messages[0].Body != "رسالة 085" || older.Messages[9].Body != "رسالة 094" || older.NextCursor == "" {
			t.Fatalf("cursor page failed: %+v %v", older, err)
		}
		if empty, err := postgres.ReadOrderConversation(ctx, db, orderID, "conversation-history-partner", "partner", 10, privateMessage.ID); err != nil || len(empty.Messages) != 0 {
			t.Fatalf("invisible cursor leaked history: %+v %v", empty, err)
		}
		replay, replayed, err := postgres.SendOrderConversationMessage(ctx, db, orderID, clientID, "client", "رسالة 000", firstIdempotencyKey, postgres.HashOrderConversationMessageRequest(orderID, "رسالة 000"), "conversation-message-replay-correlation")
		if err != nil || !replayed || replay.ID != firstMessageID {
			t.Fatalf("same-key message replay = %+v replayed=%t err=%v", replay, replayed, err)
		}
		if _, _, err := postgres.SendOrderConversationMessage(ctx, db, orderID, clientID, "client", "رسالة معدلة", firstIdempotencyKey, postgres.HashOrderConversationMessageRequest(orderID, "رسالة معدلة"), "conversation-message-conflict-correlation"); !errors.Is(err, postgres.ErrOrderConversationIdempotency) {
			t.Fatalf("same key with changed body = %v, want idempotency conflict", err)
		}
		var storedCount int
		if err := db.QueryRowContext(ctx, "SELECT count(*) FROM dsh.commerce_order_conversation_messages WHERE order_id=$1", orderID).Scan(&storedCount); err != nil || storedCount != messageCount {
			t.Fatalf("canonical conversation contains %d messages, %v; want %d", storedCount, err, messageCount)
		}

		firstReadAt, err := postgres.MarkOrderConversationRead(ctx, db, orderID, "conversation-history-partner", "partner", firstMessageID)
		if err != nil {
			t.Fatalf("mark first message read: %v", err)
		}
		retryReadAt, err := postgres.MarkOrderConversationRead(ctx, db, orderID, "conversation-history-partner", "partner", firstMessageID)
		if err != nil || !firstReadAt.Equal(retryReadAt) {
			t.Fatalf("retry replaced the original read receipt: first=%v retry=%v err=%v", firstReadAt, retryReadAt, err)
		}
		partnerHistory, err := postgres.ReadOrderConversation(ctx, db, orderID, "conversation-history-partner", "partner", 10)
		if err != nil || partnerHistory.UnreadCount != messageCount-1 {
			t.Fatalf("read receipt changed the unread boundary: count=%d err=%v", partnerHistory.UnreadCount, err)
		}

		pickupAt := time.Now().UTC().Add(-2 * time.Hour).Truncate(time.Microsecond)
		if _, err := db.ExecContext(ctx, "UPDATE dsh.commerce_orders SET state='PICKED_UP',version=version+1,updated_at=$2 WHERE id=$1", orderID, pickupAt); err != nil {
			t.Fatalf("complete pickup order: %v", err)
		}
		if _, err := db.ExecContext(ctx, `INSERT INTO dsh.commerce_order_audit(event_type,idempotency_key,correlation_id,acting_actor_id,order_id,from_state,to_state,from_version,result_version,request_hash,created_at)
			VALUES('order_picked_up','conversation-pickup-audit-key','conversation-pickup-audit-correlation','conversation-history-partner',$1,'READY_FOR_PICKUP','PICKED_UP',1,2,'conversation-pickup-request-hash',$2)`, orderID, pickupAt); err != nil {
			t.Fatalf("record pickup transition: %v", err)
		}
		if _, err := db.ExecContext(ctx, "UPDATE dsh.commerce_orders SET updated_at=clock_timestamp() WHERE id=$1", orderID); err != nil {
			t.Fatalf("simulate later financial handoff update: %v", err)
		}
		closed, err := postgres.ReadOrderConversation(ctx, db, orderID, clientID, "client", 10)
		if err != nil || closed.CanSend || closed.ReadOnlyAt == nil || !closed.ReadOnlyAt.Equal(pickupAt) {
			t.Fatalf("completed pickup conversation = %+v err=%v, want expiry anchored to the pickup event", closed, err)
		}
		lateBody := "رسالة بعد الإغلاق"
		if _, _, err := postgres.SendOrderConversationMessage(ctx, db, orderID, clientID, "client", lateBody, "conversation-late-message-key", postgres.HashOrderConversationMessageRequest(orderID, lateBody), "conversation-late-message-correlation"); !errors.Is(err, postgres.ErrOrderConversationReadOnly) {
			t.Fatalf("new message after the grace window = %v, want read-only rejection", err)
		}
		closedReplay, replayed, err := postgres.SendOrderConversationMessage(ctx, db, orderID, clientID, "client", "رسالة 000", firstIdempotencyKey, postgres.HashOrderConversationMessageRequest(orderID, "رسالة 000"), "conversation-closed-replay-correlation")
		if err != nil || !replayed || closedReplay.ID != firstMessageID {
			t.Fatalf("committed message recovery after closure = %+v replayed=%t err=%v", closedReplay, replayed, err)
		}
	})
}
