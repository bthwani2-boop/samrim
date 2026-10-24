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

func TestCaptainArrivalIsActorScopedIdempotentAndVisibleToOwnCustomer(t *testing.T) {
	dsn := strings.TrimSpace(os.Getenv("DSH_DATABASE_URL"))
	if dsn == "" {
		t.Skip("requires isolated DSH_DATABASE_URL")
	}
	root, err := sql.Open("postgres", dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = root.Close() })
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	if err := root.PingContext(ctx); err != nil {
		t.Fatal(err)
	}
	withFreshDatabase(t, root, dsn, func(ctx context.Context, db *sql.DB, migrations []postgres.MigrationRecord, sqlMigrations []string) {
		if err := postgres.Migrate(ctx, db, migrations, sqlMigrations, testDeliveryProofKeyring(t)); err != nil {
			t.Fatal(err)
		}
		if err := postgres.VerifySchema(ctx, db, migrations); err != nil {
			t.Fatal(err)
		}
		const (
			client     = "arrival-client"
			partner    = "arrival-partner"
			captain    = "arrival-captain"
			store      = "arrival-store"
			city       = "arrival-city"
			cart       = "arrival-cart"
			order      = "arrival-order"
			offer      = "arrival-offer"
			assignment = "arrival-assignment"
		)
		if _, err := db.ExecContext(ctx, "INSERT INTO dsh.service_cities(id,display_name_ar,active) VALUES($1,'Arrival Test City',true)", city); err != nil {
			t.Fatal(err)
		}
		insertCanonicalStoreFixture(t, ctx, db, canonicalStoreFixture{ID: store, PartnerActorID: partner, Name: "Arrival Test Store"})
		if _, err := db.ExecContext(ctx, "INSERT INTO dsh.commerce_carts(id,client_actor_id,store_id,state,version) VALUES($1,$2,$3,'checked_out',1)", cart, client, store); err != nil {
			t.Fatal(err)
		}
		if _, err := db.ExecContext(ctx, `INSERT INTO dsh.commerce_orders
      (id,client_actor_id,store_id,cart_id,address_id,address_version,address_text,address_latitude,address_longitude,service_city_id,serviceability_policy_version,serviceability_status,serviceability_store_version,serviceability_address_version,state,total_amount_minor,currency,version,payment_intent_id,payment_method,payment_state,fulfillment_mode,payment_cash_amount_minor,recipient_mode)
      VALUES ($1,$2,$3,$4,'arrival-address',1,'Arrival Address',15.3,44.2,$5,'CITY_SCOPE_V1','SERVICEABLE',1,1,'READY_FOR_DISPATCH',1800,'YER',1,'arrival-payment','CASH_ON_DELIVERY','REQUIRES_COLLECTION','BTHWANI_CAPTAIN',1800,'SELF')`, order, client, store, cart, city); err != nil {
			t.Fatal(err)
		}
		if _, err := db.ExecContext(ctx, `INSERT INTO dsh.captain_dispatch_offers(id,order_id,captain_actor_id,state,expires_at,idempotency_key,request_hash)
      VALUES($1,$2,$3,'accepted',clock_timestamp()+interval '1 hour','arrival-offer-key','arrival-hash')`, offer, order, captain); err != nil {
			t.Fatal(err)
		}
		if _, err := db.ExecContext(ctx, `INSERT INTO dsh.captain_assignments
       (id,order_id,captain_actor_id,accepted_offer_id,state,custody_started_at)
       VALUES($1,$2,$3,$4,'in_custody',clock_timestamp())`, assignment, order, captain, offer); err != nil {
			t.Fatal(err)
		}
		if _, err := postgres.RecordCaptainArrival(ctx, db, assignment, "other-captain"); !errors.Is(err, postgres.ErrCaptainArrivalUnavailable) {
			t.Fatalf("other captain could publish arrival: %v", err)
		}
		initial, err := postgres.RecordCaptainArrival(ctx, db, assignment, captain)
		if err != nil {
			t.Fatal(err)
		}
		replay, err := postgres.RecordCaptainArrival(ctx, db, assignment, captain)
		if err != nil || !replay.Equal(initial) {
			t.Fatalf("idempotent replay mismatch %v, %v", replay, err)
		}
		const q = `SELECT COUNT(*) FROM dsh.captain_delivery_arrivals WHERE assignment_id=$1`
		var count int
		if err := db.QueryRowContext(ctx, q, assignment).Scan(&count); err != nil || count != 1 {
			t.Fatalf("arrival duplicates %d, %v", count, err)
		}
		if _, err := postgres.ReadCaptainArrival(ctx, db, assignment, "other-captain"); !errors.Is(err, postgres.ErrCaptainArrivalUnavailable) {
			t.Fatalf("other actor read arrival: %v", err)
		}
		notifications, err := postgres.ListNotifications(ctx, db, client, "client", 15, "")
		if err != nil || len(notifications.Items) != 1 || notifications.Items[0].EventType != "captain_arrived_dropoff" {
			t.Fatalf("arrival not visible to owning customer: %+v, %v", notifications, err)
		}
		stranger, err := postgres.ListNotifications(ctx, db, "stranger", "client", 15, "")
		if err != nil || len(stranger.Items) != 0 {
			t.Fatalf("stranger received arrival: %+v %v", stranger, err)
		}
		if _, err := postgres.MarkNotificationRead(ctx, db, client, "client", notifications.Items[0].ID); err != nil {
			t.Fatal(err)
		}
	})
}
