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
		if _, err := db.ExecContext(ctx, "INSERT INTO dsh.stores(id,partner_actor_id,name) VALUES($1,$2,$3)", storeID, "conversation-history-partner", "متجر اختبار المحادثة"); err != nil {
			t.Fatalf("insert store: %v", err)
		}
		if _, err := db.ExecContext(ctx, "INSERT INTO dsh.commerce_carts(id,client_actor_id,store_id,state,version) VALUES($1,$2,$3,'checked_out',1)", cartID, clientID, storeID); err != nil {
			t.Fatalf("insert cart: %v", err)
		}
		if _, err := db.ExecContext(ctx, `INSERT INTO dsh.commerce_orders(id,client_actor_id,store_id,cart_id,address_id,address_version,address_text,address_latitude,address_longitude,service_city_id,serviceability_policy_version,serviceability_status,serviceability_store_version,serviceability_address_version,state,total_amount_minor,currency,version,payment_intent_id,payment_method,payment_state,fulfillment_mode,payment_cash_amount_minor)
			VALUES($1,$2,$3,$4,$5,1,$6,15.3694457,44.1910064,$7,'CITY_SCOPE_V1','SERVICEABLE',1,1,'CREATED',1800,'YER',1,$8,'CASH_ON_DELIVERY','REQUIRES_COLLECTION','BTHWANI_CAPTAIN',1800)`, orderID, clientID, storeID, cartID, "conversation-history-address", "عنوان اختبار المحادثة", cityID, "conversation-history-payment"); err != nil {
			t.Fatalf("insert order: %v", err)
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
		if err != nil || closed.CanSend || closed.ReadOnlyAt == nil || !closed.ReadOnlyAt.Equal(pickupAt.Add(time.Hour)) {
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
