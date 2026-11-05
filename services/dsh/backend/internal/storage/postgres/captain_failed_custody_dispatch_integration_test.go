package postgres_test

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"strings"
	"testing"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	_ "github.com/lib/pq"
)

// TestFailedCustodyCaptainCannotReceiveAnotherDispatch ensures an unresolved
// failed delivery retains custody and blocks a new dispatch even if a stale
// "available" flag and fresh GPS fix remain.
func TestFailedCustodyCaptainCannotReceiveAnotherDispatch(t *testing.T) {
	rootURL := strings.TrimSpace(os.Getenv("DSH_DATABASE_URL"))
	if rootURL == "" {
		t.Skip("requires disposable DSH_DATABASE_URL")
	}
	rootDB, err := sql.Open("postgres", rootURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = rootDB.Close() })
	if err := rootDB.Ping(); err != nil {
		t.Fatal(err)
	}
	withFreshDatabase(t, rootDB, rootURL, func(ctx context.Context, db *sql.DB, records []postgres.MigrationRecord, migrations []string) {
		if err := postgres.Migrate(ctx, db, records, migrations, testDeliveryProofKeyring(t)); err != nil {
			t.Fatal(err)
		}
		const city = "custody-city"
		const store = "custody-store"
		const failedOrder = "custody-old-order"
		const readyOrder = "custody-ready-order"
		const failedCaptain = "custody-failed-captain"
		const healthyCaptain = "custody-healthy-captain"

		if _, err := db.ExecContext(ctx, "INSERT INTO dsh.service_cities(id,display_name_ar,active) VALUES($1,$2,true)", city, "مدينة اختبار"); err != nil {
			t.Fatal(err)
		}
		insertCanonicalStoreFixture(t, ctx, db, canonicalStoreFixture{
			ID: store, PartnerActorID: "custody-partner", Name: "متجر اختبار", ServiceCityID: city,
		})
		if _, err := db.ExecContext(ctx, "UPDATE dsh.stores SET delivery_origin_latitude=15.3694457,delivery_origin_longitude=44.1910064 WHERE id=$1", store); err != nil {
			t.Fatal(err)
		}
		for _, item := range []struct{ id, state string }{{failedOrder, "DELIVERY_FAILED"}, {readyOrder, "READY_FOR_DISPATCH"}} {
			if _, err := db.ExecContext(ctx, "INSERT INTO dsh.commerce_carts(id,client_actor_id,store_id,state,version) VALUES($1,'custody-client',$2,'checked_out',1)", item.id+"-cart", store); err != nil {
				t.Fatal(err)
			}
			if _, err := db.ExecContext(ctx, "INSERT INTO dsh.commerce_orders(id,client_actor_id,store_id,cart_id,address_id,address_version,address_text,address_latitude,address_longitude,service_city_id,serviceability_policy_version,serviceability_status,serviceability_store_version,serviceability_address_version,state,total_amount_minor,currency,version,payment_intent_id,payment_method,payment_state,fulfillment_mode,payment_cash_amount_minor) VALUES($1,'custody-client',$2,$3,'custody-address',1,'صنعاء',15.3694457,44.1910064,$4,'CITY_SCOPE_V1','SERVICEABLE',1,1,$5,1800,'YER',1,$6,'CASH_ON_DELIVERY','REQUIRES_COLLECTION','BTHWANI_CAPTAIN',1800)", item.id, store, item.id+"-cart", city, item.state, item.id+"-payment"); err != nil {
				t.Fatal(err)
			}
		}
		for i, actor := range []string{failedCaptain, healthyCaptain} {
			if _, err := db.ExecContext(ctx, "INSERT INTO dsh.captain_admissions(id,actor_id,full_name_ar,state,availability_state,requires_profile_review,version) VALUES($1,$2,'كابتن اختبار','eligible','available',false,1)", actor+"-admission", actor); err != nil {
				t.Fatal(err)
			}
			if _, err := db.ExecContext(ctx, "INSERT INTO dsh.captain_presence_latest(captain_actor_id,latitude,longitude,updated_at) VALUES($1,$2,44.1910064,clock_timestamp())", actor, 15.3694457+float64(i)*0.001); err != nil {
				t.Fatal(err)
			}
		}
		// Persistence regression fixture in a fresh disposable database only.
		if _, err := db.ExecContext(ctx, "INSERT INTO dsh.captain_dispatch_offers(id,order_id,captain_actor_id,state,expires_at,version,idempotency_key,request_hash) VALUES('custody-old-offer',$1,$2,'accepted',clock_timestamp()+interval '1 hour',2,'custody-old-key','old-hash')", failedOrder, failedCaptain); err != nil {
			t.Fatal(err)
		}
		if _, err := db.ExecContext(ctx, "INSERT INTO dsh.captain_assignments(id,order_id,captain_actor_id,accepted_offer_id,state,version,custody_started_at,terminal_result,terminal_at) VALUES('custody-old-assignment',$1,$2,'custody-old-offer','delivery_failed',3,clock_timestamp()-interval '5 minutes','delivery_failed',clock_timestamp())", failedOrder, failedCaptain); err != nil {
			t.Fatal(err)
		}
		nearby, _, err := postgres.ListNearbyCaptainCandidates(ctx, db, readyOrder, "", nil)
		if err != nil || len(nearby) != 1 || nearby[0].ActorID != healthyCaptain {
			t.Fatalf("failed custody cannot enter nearest pool: candidates=%+v err=%v", nearby, err)
		}
		_, _, err = postgres.SetCaptainAvailability(ctx, db, failedCaptain, true, 1, "custody-availability-key", "custody-availability-hash", failedCaptain, "custody-availability-correlation", "")
		if !errors.Is(err, postgres.ErrCaptainOperationConflict) {
			t.Fatalf("failed custody cannot enable dispatch: %v", err)
		}
		_, _, err = postgres.CreateCaptainDispatchOffer(ctx, db, readyOrder, "custody-forbidden-key", postgres.HashCaptainDispatchRequest(readyOrder), "operator-test", "custody-forbidden-correlation", failedCaptain)
		if !errors.Is(err, postgres.ErrCaptainNoAvailable) {
			t.Fatalf("direct dispatch must reject failed custody: %v", err)
		}
		// A stale historical offer can still be rejected after another delivery
		// enters failed custody. Rejection must not restore availability.
		if _, err := db.ExecContext(ctx, "UPDATE dsh.captain_admissions SET availability_state='unavailable' WHERE actor_id=$1", failedCaptain); err != nil {
			t.Fatal(err)
		}
		if _, err := db.ExecContext(ctx, "INSERT INTO dsh.captain_dispatch_offers(id,order_id,captain_actor_id,state,expires_at,version,idempotency_key,request_hash) VALUES('custody-stale-offer',$1,$2,'offered',clock_timestamp()+interval '1 hour',1,'custody-stale-key','stale-hash')", readyOrder, failedCaptain); err != nil {
			t.Fatal(err)
		}
		response, err := postgres.RespondToCaptainOffer(ctx, db, "custody-stale-offer", failedCaptain, "reject", 1, "custody-stale-reject-key", postgres.HashCaptainOfferResponse("custody-stale-offer", "reject", 1), "custody-stale-reject-correlation")
		if err != nil || response.Offer.State != "rejected" {
			t.Fatalf("stale offer rejection: result=%+v err=%v", response, err)
		}
		var availability string
		if err := db.QueryRowContext(ctx, "SELECT availability_state FROM dsh.captain_admissions WHERE actor_id=$1", failedCaptain).Scan(&availability); err != nil || availability != "unavailable" {
			t.Fatalf("failed custody was incorrectly restored after rejecting stale offer: state=%s err=%v", availability, err)
		}

		offer, replayed, err := postgres.CreateCaptainDispatchOffer(ctx, db, readyOrder, "custody-healthy-key", postgres.HashCaptainDispatchRequest(readyOrder), "operator-test", "custody-healthy-correlation", healthyCaptain)
		if err != nil || replayed || offer.State != "offered" {
			t.Fatalf("healthy captain must still receive offer: offer=%+v replayed=%v err=%v", offer, replayed, err)
		}
	})
}
