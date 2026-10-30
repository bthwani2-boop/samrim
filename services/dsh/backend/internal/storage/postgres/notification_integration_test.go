package postgres_test

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	_ "github.com/lib/pq"
)

func TestNotificationsAreIsolatedByActorAndStore(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("DSH_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("DSH_DATABASE_URL is required for isolated notification persistence proof")
	}
	rootDB, err := sql.Open("postgres", databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = rootDB.Close() })
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	if err := rootDB.PingContext(ctx); err != nil {
		t.Fatalf("postgres connection: %v", err)
	}

	withFreshDatabase(t, rootDB, databaseURL, func(ctx context.Context, db *sql.DB, migrations []postgres.MigrationRecord, sqlMigrations []string) {
		if err := postgres.Migrate(ctx, db, migrations, sqlMigrations, testDeliveryProofKeyring(t)); err != nil {
			t.Fatal(err)
		}
		if err := postgres.VerifySchema(ctx, db, migrations); err != nil {
			t.Fatal(err)
		}
		const (
			clientID       = "notif-client-a"
			otherClientID  = "notif-client-b"
			partnerID      = "notif-partner-a"
			otherPartnerID = "notif-partner-b"
			storeID        = "notif-store-a"
			cityID         = "notif-city"
			cartID         = "notif-cart"
			orderID        = "notif-order"
		)
		if _, err := db.ExecContext(ctx, "INSERT INTO dsh.service_cities(id,display_name_ar,active) VALUES($1,$2,true)", cityID, "مدينة الإشعارات"); err != nil {
			t.Fatal(err)
		}
		insertCanonicalStoreFixture(t, ctx, db, canonicalStoreFixture{ID: storeID, PartnerActorID: partnerID, Name: "متجر اختبار الإشعارات"})
		if _, err := db.ExecContext(ctx, "INSERT INTO dsh.commerce_carts(id,client_actor_id,store_id,state,version) VALUES($1,$2,$3,'checked_out',1)", cartID, clientID, storeID); err != nil {
			t.Fatal(err)
		}
		if _, err := db.ExecContext(ctx, "INSERT INTO dsh.commerce_orders(id,client_actor_id,store_id,cart_id,address_id,address_version,address_text,address_latitude,address_longitude,service_city_id,serviceability_policy_version,serviceability_status,serviceability_store_version,serviceability_address_version,state,total_amount_minor,currency,version,payment_intent_id,payment_method,payment_state,fulfillment_mode,payment_cash_amount_minor,recipient_mode,recipient_name,recipient_phone_e164,recipient_instructions) VALUES($1,$2,$3,$4,$5,1,'عنوان خاص',15.3694457,44.1910064,$6,'CITY_SCOPE_V1','SERVICEABLE',1,1,'CREATED',1800,'YER',1,$7,'CASH_ON_DELIVERY','REQUIRES_COLLECTION','BTHWANI_CAPTAIN',1800,'OTHER','مستلم خاص','+967712345678','خاص')", orderID, clientID, storeID, cartID, "notif-address", cityID, "notif-payment"); err != nil {
			t.Fatal(err)
		}
		if _, err := db.ExecContext(ctx, "INSERT INTO dsh.commerce_order_audit(event_type,idempotency_key,correlation_id,acting_actor_id,order_id,from_state,to_state,from_version,result_version,request_hash,created_at) VALUES('order_created','notif-audit-key','notif-correlation',$1,$2,'','CREATED',0,1,'notif-request-hash',clock_timestamp())", clientID, orderID); err != nil {
			t.Fatal(err)
		}

		own, err := postgres.ListNotifications(ctx, db, clientID, "client", 10, "")
		if err != nil || len(own.Items) != 1 || own.UnreadCount != 1 {
			t.Fatalf("client own notification = %+v, error %v", own, err)
		}
		id := own.Items[0].ID
		for _, denied := range []struct{ actor, role string }{
			{otherClientID, "client"}, {otherPartnerID, "partner"}, {clientID, "captain"},
		} {
			result, err := postgres.ListNotifications(ctx, db, denied.actor, denied.role, 10, "")
			if err != nil || len(result.Items) != 0 || result.UnreadCount != 0 {
				t.Fatalf("%s/%s sees another actor's notification: %+v error %v", denied.role, denied.actor, result, err)
			}
			if _, err := postgres.MarkNotificationRead(ctx, db, denied.actor, denied.role, id); !errors.Is(err, postgres.ErrNotificationNotFound) {
				t.Fatalf("%s/%s marked another actor's notification read: %v", denied.role, denied.actor, err)
			}
		}
		// The retired Field role is rejected, not treated as a valid but empty inbox.
		if result, err := postgres.ListNotifications(ctx, db, clientID, "field", 10, ""); err == nil || len(result.Items) != 0 || result.UnreadCount != 0 {
			t.Fatalf("retired Field read must fail closed: %+v err=%v", result, err)
		}
		if _, err := postgres.MarkNotificationRead(ctx, db, clientID, "field", id); !errors.Is(err, postgres.ErrNotificationNotFound) {
			t.Fatalf("retired Field cannot mark notifications read: %v", err)
		}
		partner, err := postgres.ListNotifications(ctx, db, partnerID, "partner", 10, "")
		if err != nil || len(partner.Items) != 1 {
			t.Fatalf("own partner notification = %+v error %v", partner, err)
		}
		if _, err := postgres.MarkNotificationRead(ctx, db, partnerID, "partner", id); err != nil {
			t.Fatalf("partner could not mark its own event read: %v", err)
		}
		clientAfterPartnerRead, err := postgres.ListNotifications(ctx, db, clientID, "client", 10, "")
		if err != nil || clientAfterPartnerRead.UnreadCount != 1 {
			t.Fatalf("partner read state affected client count: %+v error %v", clientAfterPartnerRead, err)
		}
		if _, err := postgres.MarkNotificationRead(ctx, db, clientID, "client", id); err != nil {
			t.Fatal(err)
		}
		clientAfterOwnRead, err := postgres.ListNotifications(ctx, db, clientID, "client", 10, "")
		if err != nil || clientAfterOwnRead.UnreadCount != 0 {
			t.Fatalf("client cannot read its own notification: %+v error %v", clientAfterOwnRead, err)
		}
		if _, err := postgres.ListNotifications(ctx, db, otherClientID, "client", 10, "malformed"); !errors.Is(err, postgres.ErrNotificationInvalidCursor) {
			t.Fatalf("invalid cursor accepted: %v", err)
		}
	})
}
