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

// Exercise the detector against fresh migrated PostgreSQL; no mock stage clock.
func TestOperatorMissionLossOpensOnceAndRequiresRecovery(t *testing.T) {
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
	if err := root.PingContext(ctx); err != nil {
		t.Fatal(err)
	}
	withFreshDatabase(t, root, databaseURL, func(ctx context.Context, db *sql.DB, records []postgres.MigrationRecord, sqls []string) {
		if err := postgres.Migrate(ctx, db, records, sqls, testDeliveryProofKeyring(t)); err != nil {
			t.Fatal(err)
		}
		if err := postgres.VerifySchema(ctx, db, records); err != nil {
			t.Fatal(err)
		}
		if _, err := db.ExecContext(ctx, "INSERT INTO dsh.service_cities(id,display_name_ar,active) VALUES('lost_gps_city','Sanaa',true)"); err != nil {
			t.Fatal(err)
		}
		insertCanonicalStoreFixture(t, ctx, db, canonicalStoreFixture{ID: "lost_gps_store", PartnerActorID: "lost_gps_partner", Name: "Mission Tracking Shop", ServiceCityID: "lost_gps_city"})
		for _, item := range []struct {
			id     string
			old    bool
			hasFix bool
		}{
			{"lost_gps_missing", true, false},
			{"lost_gps_auto", true, false},
			{"lost_gps_grace", false, false},
			{"lost_gps_present", true, true},
		} {
			cart, offer, assignment := "cart_"+item.id, "offer_"+item.id, "assignment_"+item.id
			if _, err := db.ExecContext(ctx, `INSERT INTO dsh.commerce_carts(id,client_actor_id,store_id,state,version)
              VALUES($1,'lost_gps_client','lost_gps_store','checked_out',1)`, cart); err != nil {
				t.Fatal(err)
			}
			if _, err := db.ExecContext(ctx, `INSERT INTO dsh.commerce_orders(id,client_actor_id,store_id,cart_id,address_id,address_version,address_text,address_latitude,address_longitude,service_city_id,serviceability_policy_version,serviceability_status,serviceability_store_version,serviceability_address_version,state,total_amount_minor,payment_cash_amount_minor,currency,version,fulfillment_mode)
              VALUES($1,'lost_gps_client','lost_gps_store',$2,$3,1,'Sanaa',15.37,44.19,'lost_gps_city','CITY_SCOPE_V1','SERVICEABLE',1,1,'CAPTAIN_ASSIGNED',1000,1000,'YER',2,'BTHWANI_CAPTAIN')`, item.id, cart, "address_"+item.id); err != nil {
				t.Fatal(err)
			}
			if _, err := db.ExecContext(ctx, `INSERT INTO dsh.captain_dispatch_offers(id,order_id,captain_actor_id,state,expires_at,idempotency_key,request_hash)
              VALUES($1,$2,$3,'accepted',clock_timestamp()+interval '10 minutes',$4,'fixture')`, offer, item.id, "captain_"+item.id, "idem_"+item.id); err != nil {
				t.Fatal(err)
			}
			createdAt := time.Now().UTC().Add(-time.Minute)
			if item.old {
				createdAt = time.Now().UTC().Add(-5 * time.Minute)
			}
			if _, err := db.ExecContext(ctx, `INSERT INTO dsh.captain_assignments(id,order_id,captain_actor_id,accepted_offer_id,state,created_at)
              VALUES($1,$2,$3,$4,'assigned',$5)`, assignment, item.id, "captain_"+item.id, offer, createdAt); err != nil {
				t.Fatal(err)
			}
			if item.hasFix {
				if err := postgres.UpdateCaptainMissionLocation(ctx, db, assignment, "captain_"+item.id, 15.38, 44.20, 10, time.Now().UTC(), 1); err != nil {
					t.Fatal(err)
				}
			}
		}
		n, err := postgres.DetectOperatorOrderExceptions(ctx, db, 25)
		if err != nil || n != 2 {
			t.Fatalf("expected two expired missing GPS alerts, count=%d err=%v", n, err)
		}
		cases, err := postgres.ListOpenOpsCases(ctx, db, "lost_gps_operator", "all", 20, "")
		if err != nil || len(cases.Items) != 2 {
			t.Fatalf("missing GPS cases not actionable: %+v err=%v", cases, err)
		}
		var c, automatic postgres.OpsCase
		for _, item := range cases.Items {
			if item.OrderID == "lost_gps_missing" {
				c = item
			}
			if item.OrderID == "lost_gps_auto" {
				automatic = item
			}
		}
		if automatic.ID <= 0 {
			t.Fatal("unclaimed recovery fixture missing")
		}
		if c.OrderID != "lost_gps_missing" || c.Reason != "CAPTAIN_LOCATION_LOST" || c.Priority != "URGENT" {
			t.Fatalf("wrong signal: %+v", c)
		}
		n, err = postgres.DetectOperatorOrderExceptions(ctx, db, 25)
		if err != nil || n != 0 {
			t.Fatalf("GPS signal repeated: %d err=%v", n, err)
		}
		claimed, _, err := postgres.UpdateOpsCase(ctx, db, c.OrderID, c.ID, "lost_gps_operator", "CLAIM", "", "gps-claim-idem-001", "gps-claim-corr-001", c.Version)
		if err != nil {
			t.Fatal(err)
		}
		if err := postgres.UpdateCaptainMissionLocation(ctx, db, "assignment_lost_gps_auto", "captain_lost_gps_auto", 15.38, 44.2, 11, time.Now().UTC(), 1); err != nil {
			t.Fatal(err)
		}
		n, err = postgres.DetectOperatorOrderExceptions(ctx, db, 25)
		if err != nil || n != 0 {
			t.Fatalf("auto recovery detector failed: count=%d err=%v", n, err)
		}
		var autoState string
		if err := db.QueryRowContext(ctx, "SELECT state FROM dsh.operator_order_cases WHERE id=$1", automatic.ID).Scan(&autoState); err != nil || autoState != "RESOLVED" {
			t.Fatalf("unclaimed recovered alert still open: %s %v", autoState, err)
		}
		var audits int
		if err := db.QueryRowContext(ctx, "SELECT count(*) FROM dsh.operator_order_case_events WHERE case_id=$1 AND action='RESOLVE'", automatic.ID).Scan(&audits); err != nil || audits != 1 {
			t.Fatalf("auto recovery lost audit: count=%d err=%v", audits, err)
		}
		_, _, err = postgres.UpdateOpsCase(ctx, db, c.OrderID, c.ID, "lost_gps_operator", "RESOLVE", "Captain's location is confirmed restored", "gps-resolve-idem-001", "gps-resolve-corr-001", claimed.Version)
		if !errors.Is(err, postgres.ErrOpsCaseUnverified) {
			t.Fatalf("unrecovered GPS case resolved: %v", err)
		}
		if err = postgres.UpdateCaptainMissionLocation(ctx, db, "assignment_lost_gps_missing", "captain_lost_gps_missing", 15.38, 44.2, 11, time.Now().UTC(), 1); err != nil {
			t.Fatal(err)
		}
		resolved, _, err := postgres.UpdateOpsCase(ctx, db, c.OrderID, c.ID, "lost_gps_operator", "RESOLVE", "Captain's location recovered on the canonical mission", "gps-resolve-idem-002", "gps-resolve-corr-002", claimed.Version)
		if err != nil || resolved.State != "RESOLVED" {
			t.Fatalf("fresh fix not sufficient for resolution: %+v %v", resolved, err)
		}
		n, err = postgres.DetectOperatorOrderExceptions(ctx, db, 25)
		if err != nil || n != 0 {
			t.Fatalf("recovered GPS reopened: count=%d err=%v", n, err)
		}
	})
}
