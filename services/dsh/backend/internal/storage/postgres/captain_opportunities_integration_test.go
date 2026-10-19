package postgres_test

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

func TestRecentOpportunityCirclesPrivacyAndWindow(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("DSH_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("requires disposable database via DSH_DATABASE_URL")
	}
	rootDB, err := sql.Open("postgres", databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = rootDB.Close() })
	if err := rootDB.Ping(); err != nil {
		t.Fatal(err)
	}

	withFreshDatabase(t, rootDB, databaseURL, func(ctx context.Context, db *sql.DB, records []postgres.MigrationRecord, migrations []string) {
		if err := postgres.Migrate(ctx, db, records, migrations, testDeliveryProofKeyring(t)); err != nil {
			t.Fatal(err)
		}
		if _, err := db.ExecContext(ctx, "INSERT INTO dsh.service_cities(id,display_name_ar,active) VALUES('circle-city','مدينة اختبار',true)"); err != nil {
			t.Fatal(err)
		}
		empty, err := postgres.ReadCaptainOpportunityHeatmap(ctx, db)
		if err != nil || empty.SampleStatus != "INSUFFICIENT_DATA" || len(empty.Cells) != 0 {
			t.Fatalf("empty map: %+v err=%v", empty, err)
		}
		if empty.SignalType != "RECENT_ACTIVITY" || empty.WindowEnd.Sub(empty.WindowStart) != 30*time.Minute {
			t.Fatalf("wrong time window: %+v", empty)
		}

		for store := 1; store <= 3; store++ {
			storeID := fmt.Sprintf("circle-store-%d", store)
			insertCanonicalStoreFixture(t, ctx, db, canonicalStoreFixture{
				ID: storeID, PartnerActorID: "circle-partner", Name: storeID,
				ServiceCityID: "circle-city", PublicationState: "published",
			})
			if _, err := db.ExecContext(ctx, `UPDATE dsh.stores
                SET delivery_origin_latitude=$2,delivery_origin_longitude=44.1910064
                WHERE id=$1`, storeID, 15.3694457+float64(store)*0.001); err != nil {
				t.Fatal(err)
			}
			for number := 1; number <= 2; number++ {
				orderID := fmt.Sprintf("circle-order-%d-%d", store, number)
				cartID := "cart-" + orderID
				if _, err := db.ExecContext(ctx, `INSERT INTO dsh.commerce_carts(id,client_actor_id,store_id,state,version)
                    VALUES($1,'circle-client',$2,'checked_out',1)`, cartID, storeID); err != nil {
					t.Fatal(err)
				}
				if _, err := db.ExecContext(ctx, `INSERT INTO dsh.commerce_orders(
                    id,client_actor_id,store_id,cart_id,address_id,address_version,address_text,address_latitude,address_longitude,
                    service_city_id,serviceability_policy_version,serviceability_status,serviceability_store_version,
                    serviceability_address_version,state,total_amount_minor,currency,version,payment_intent_id,payment_method,
                    payment_state,fulfillment_mode,payment_cash_amount_minor)
                    VALUES($1,'circle-client',$2,$3,$4,1,'Test address',15.3694457,44.1910064,'circle-city',
                    'CITY_SCOPE_V1','SERVICEABLE',1,1,'READY_FOR_DISPATCH',1800,'YER',1,$5,'CASH_ON_DELIVERY',
                    'REQUIRES_COLLECTION','BTHWANI_CAPTAIN',1800)`, orderID, storeID, cartID, "address-"+orderID, "payment-"+orderID); err != nil {
					t.Fatal(err)
				}
			}
		}
		for i := 1; i <= 5; i++ {
			actor := fmt.Sprintf("circle-captain-%d", i)
			if _, err := db.ExecContext(ctx, `INSERT INTO dsh.captain_admissions(id,actor_id,full_name_ar,state,availability_state,requires_profile_review,version)
                VALUES($1,$2,'كابتن اختبار','eligible','available',false,1)`, "admission-"+actor, actor); err != nil {
				t.Fatal(err)
			}
			if _, err := db.ExecContext(ctx, `INSERT INTO dsh.captain_presence_latest(captain_actor_id,latitude,longitude,updated_at)
                VALUES($1,$2,44.1910064,clock_timestamp()-CASE WHEN $3 THEN interval '16 minutes' ELSE interval '0 minutes' END)`,
				actor, 15.3694457+float64(i)*0.001, i == 5); err != nil {
				t.Fatal(err)
			}
		}
		sample, err := postgres.ReadCaptainOpportunityHeatmap(ctx, db)
		if err != nil {
			t.Fatal(err)
		}
		if len(sample.Cells) != 2 || sample.SampleStatus != "AVAILABLE" {
			t.Fatalf("expected order and available Captain circles: %+v", sample)
		}
		kinds := make(map[string]bool)
		for _, cell := range sample.Cells {
			kinds[cell.Kind] = true
			if cell.Intensity != "LOW" || cell.Latitude == 15.3694457 {
				t.Fatalf("location or exact counts leaked: %+v", cell)
			}
		}
		if !kinds["ORDERS"] || !kinds["CAPTAINS"] {
			t.Fatalf("missing activity layer: %+v", sample.Cells)
		}
		jsonData, err := json.Marshal(sample)
		if err != nil {
			t.Fatal(err)
		}
		for _, secret := range []string{"circle-captain", "circle-order", "circle-store", "circle-client", "Test address", "count"} {
			if strings.Contains(string(jsonData), secret) {
				t.Fatalf("activity map exposed %q", secret)
			}
		}
		if _, err := db.ExecContext(ctx, `UPDATE dsh.captain_admissions SET availability_state='unavailable'
            WHERE actor_id='circle-captain-4'`); err != nil {
			t.Fatal(err)
		}
		afterOffline, err := postgres.ReadCaptainOpportunityHeatmap(ctx, db)
		if err != nil || len(afterOffline.Cells) != 1 || afterOffline.Cells[0].Kind != "ORDERS" {
			t.Fatalf("sub-threshold Captain density must disappear: %+v err=%v", afterOffline, err)
		}
		if _, err := db.ExecContext(ctx, `UPDATE dsh.stores SET publication_state='unpublished',publication_changed_at=NULL
            WHERE id='circle-store-3'`); err != nil {
			t.Fatal(err)
		}
		afterStore, err := postgres.ReadCaptainOpportunityHeatmap(ctx, db)
		if err != nil || len(afterStore.Cells) != 0 || afterStore.SampleStatus != "INSUFFICIENT_DATA" {
			t.Fatalf("sub-threshold demand must disappear: %+v err=%v", afterStore, err)
		}
	}, 80*time.Second)
}
