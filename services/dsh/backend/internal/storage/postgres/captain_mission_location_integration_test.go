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
)

func TestCaptainMissionLocationOwnerLatestAndTerminalPurge(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("DSH_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("isolated DSH_DATABASE_URL required")
	}
	root, err := sql.Open("postgres", databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = root.Close() })
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	if err = root.PingContext(ctx); err != nil {
		t.Fatal(err)
	}
	withFreshDatabase(t, root, databaseURL, func(ctx context.Context, db *sql.DB, records []postgres.MigrationRecord, sqls []string) {
		if err := postgres.Migrate(ctx, db, records, sqls, testDeliveryProofKeyring(t)); err != nil {
			t.Fatal(err)
		}
		if err := postgres.VerifySchema(ctx, db, records); err != nil {
			t.Fatal(err)
		}
		if _, err := db.ExecContext(ctx, "INSERT INTO dsh.service_cities(id,display_name_ar,active) VALUES('mission_city','صنعاء',true)"); err != nil {
			t.Fatal(err)
		}
		insertCanonicalStoreFixture(t, ctx, db, canonicalStoreFixture{ID: "mission_store", PartnerActorID: "mission_partner", Name: "متجر المهمة", ServiceCityID: "mission_city"})
		if _, err := db.ExecContext(ctx, "INSERT INTO dsh.commerce_carts(id,client_actor_id,store_id,state,version) VALUES('mission_cart','mission_client','mission_store','checked_out',1)"); err != nil {
			t.Fatal(err)
		}
		if _, err := db.ExecContext(ctx, `INSERT INTO dsh.commerce_orders(id,client_actor_id,store_id,cart_id,address_id,address_version,address_text,address_latitude,address_longitude,service_city_id,serviceability_policy_version,serviceability_status,serviceability_store_version,serviceability_address_version,state,total_amount_minor,payment_cash_amount_minor,currency,version,fulfillment_mode)
        VALUES('mission_order','mission_client','mission_store','mission_cart','mission_address',1,'صنعاء',15.369,44.191,'mission_city','CITY_SCOPE_V1','SERVICEABLE',1,1,'CAPTAIN_ASSIGNED',1000,1000,'YER',1,'BTHWANI_CAPTAIN')`); err != nil {
			t.Fatal(err)
		}
		if _, err := db.ExecContext(ctx, `INSERT INTO dsh.captain_dispatch_offers(id,order_id,captain_actor_id,state,expires_at,idempotency_key,request_hash)
        VALUES('mission_offer','mission_order','mission_captain','accepted',clock_timestamp()+interval '5 minutes','mission-offer-key','mission-hash')`); err != nil {
			t.Fatal(err)
		}
		if _, err := db.ExecContext(ctx, `INSERT INTO dsh.captain_assignments(id,order_id,captain_actor_id,accepted_offer_id,state)
        VALUES('mission_assignment','mission_order','mission_captain','mission_offer','assigned')`); err != nil {
			t.Fatal(err)
		}
		missing, err := postgres.ReadOperatorMissionLocation(ctx, db, "mission_order")
		if err != nil || missing.State != "NO_SIGNAL" || missing.Latitude != nil {
			t.Fatalf("no signal leaked coords: %+v err=%v", missing, err)
		}
		now := time.Now().UTC().Truncate(time.Millisecond)
		if err := postgres.UpdateCaptainMissionLocation(ctx, db, "mission_assignment", "different_captain", 15.37, 44.20, 14, now, 1); !errors.Is(err, postgres.ErrMissionLocationForbidden) {
			t.Fatalf("wrong owner accepted: %v", err)
		}
		if err := postgres.UpdateCaptainMissionLocation(ctx, db, "mission_assignment", "mission_captain", 15.37, 44.20, 14, now.Add(-3*time.Minute), 1); !errors.Is(err, postgres.ErrMissionLocationInvalid) {
			t.Fatalf("expired fix accepted: %v", err)
		}
		if err := postgres.UpdateCaptainMissionLocation(ctx, db, "mission_assignment", "mission_captain", 15.37, 44.20, 14, now, 1); err != nil {
			t.Fatalf("current owner fix rejected: %v", err)
		}
		if err := postgres.UpdateCaptainMissionLocation(ctx, db, "mission_assignment", "mission_captain", 15.38, 44.21, 14, now, 1); !errors.Is(err, postgres.ErrMissionLocationStale) {
			t.Fatalf("duplicate sequence overwrote position: %v", err)
		}
		if err := postgres.UpdateCaptainMissionLocation(ctx, db, "mission_assignment", "mission_captain", 15.38, 44.21, 12, now.Add(time.Second), 2); err != nil {
			t.Fatalf("newer location rejected: %v", err)
		}
		current, err := postgres.ReadOperatorMissionLocation(ctx, db, "mission_order")
		if err != nil || current.State != "FRESH" || current.Latitude == nil || *current.Latitude != 15.38 {
			t.Fatalf("last fix not visible to operator projection: %+v err=%v", current, err)
		}
		var count int
		if err := db.QueryRowContext(ctx, "SELECT count(*) FROM dsh.captain_mission_latest WHERE assignment_id='mission_assignment'").Scan(&count); err != nil || count != 1 {
			t.Fatalf("expected a single latest row: count=%d err=%v", count, err)
		}
		if _, err := db.ExecContext(ctx, "UPDATE dsh.captain_assignments SET state='reassigned',version=version+1 WHERE id='mission_assignment'"); err != nil {
			t.Fatal(err)
		}
		after, err := postgres.ReadOperatorMissionLocation(ctx, db, "mission_order")
		if err != nil || after.State != "NO_ACTIVE" || after.Latitude != nil {
			t.Fatalf("inactive assignment disclosed GPS: %+v err=%v", after, err)
		}
		if err := postgres.UpdateCaptainMissionLocation(ctx, db, "mission_assignment", "mission_captain", 15.38, 44.21, 12, now.Add(time.Second), 3); !errors.Is(err, postgres.ErrMissionLocationForbidden) {
			t.Fatalf("terminated mission accepted new fix: %v", err)
		}
		deleted, err := postgres.PurgeExpiredCaptainMissionLocations(ctx, db)
		if err != nil || deleted != 1 {
			t.Fatalf("old mission row not purged: count=%d err=%v", deleted, err)
		}
		absent, err := postgres.ReadOperatorMissionLocation(ctx, db, "missing_order")
		if !errors.Is(err, postgres.ErrOrderNotFound) || absent.Latitude != nil {
			t.Fatalf("unknown order disclosure: %+v err=%v", absent, err)
		}
	})
}
