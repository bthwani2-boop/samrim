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

func TestDiscoveryConversionCreditsOnlyLatestClickAndOneContentPerOrder(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("DSH_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("isolated DSH_DATABASE_URL required")
	}
	rootDB, err := sql.Open("postgres", databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = rootDB.Close() })
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Second)
	defer cancel()
	if err := rootDB.PingContext(ctx); err != nil {
		t.Fatal(err)
	}
	withFreshDatabase(t, rootDB, databaseURL, func(ctx context.Context, db *sql.DB, records []postgres.MigrationRecord, sqls []string) {
		if err := postgres.Migrate(ctx, db, records, sqls, testDeliveryProofKeyring(t)); err != nil {
			t.Fatal(err)
		}
		const city = "single-order-city"
		const store = "single-order-store"
		const actor = "single-order-client"
		const session = "session-single-order-20261018"
		const order = "single-order-order"
		if _, err := db.ExecContext(ctx, "INSERT INTO dsh.service_cities(id,display_name_ar,active) VALUES($1,'Test City',true)", city); err != nil {
			t.Fatal(err)
		}
		insertCanonicalStoreFixture(t, ctx, db, canonicalStoreFixture{ID: store, PartnerActorID: "single-order-partner", Name: "Single Order Test Store", ServiceCityID: city})
		for _, item := range []struct{ id, asset string }{{"first-banner", "asset-first-banner"}, {"last-banner", "asset-last-banner"}} {
			if _, err := db.ExecContext(ctx, `INSERT INTO dsh.discovery_content_media_assets(
        id,idempotency_key,request_hash,object_key,uri,content_sha256,content_type,byte_size,
        state,creator,source_description,rights_statement,rights_attested_by_actor_id)
        VALUES($1,$2,$3,$4,$5,$6,'image/png',128,'active','Fixture Owner','Licensed isolated content','Test rights','marketing-fixture')`,
				item.asset, "idem-"+item.asset, postgres.HashMarketingFacts(item.asset), "fixture/"+item.asset, "asset://"+item.asset, strings.Repeat("a", 64)); err != nil {
				t.Fatal(err)
			}
			if _, err := db.ExecContext(ctx, `INSERT INTO dsh.discovery_content(
        id,kind,title_ar,media_asset_id,target_type,service_city_id,state,starts_at,created_by_actor_id)
        VALUES($1,'BANNER','Test Banner',$2,'INFO',$3,'PUBLISHED',clock_timestamp()-interval '1 hour','marketing-fixture')`,
				item.id, item.asset, city); err != nil {
				t.Fatal(err)
			}
		}
		click := func(contentID, eventID string) {
			t.Helper()
			err := postgres.RecordDiscoveryContentEvent(ctx, db, postgres.DiscoveryContentEventInput{
				ID: eventID, ClientEventID: eventID, ContentID: contentID, EventType: "CLICK", ClientSessionID: session,
			})
			if err != nil {
				t.Fatalf("click %s: %v", contentID, err)
			}
		}
		click("first-banner", "click-first")
		click("last-banner", "click-last")
		if _, err := db.ExecContext(ctx, "INSERT INTO dsh.commerce_carts(id,client_actor_id,store_id,state,version) VALUES('single-order-cart',$1,$2,'checked_out',1)", actor, store); err != nil {
			t.Fatal(err)
		}
		if _, err := db.ExecContext(ctx, `INSERT INTO dsh.commerce_orders(
        id,client_actor_id,store_id,cart_id,address_id,address_version,address_text,address_latitude,address_longitude,
        service_city_id,serviceability_policy_version,serviceability_status,serviceability_store_version,serviceability_address_version,
        state,total_amount_minor,currency,version,payment_intent_id,payment_method,payment_state,fulfillment_mode,payment_cash_amount_minor)
      VALUES($1,$2,$3,'single-order-cart','single-order-address',1,'Test',15.36,44.19,$4,'CITY_SCOPE_V1','SERVICEABLE',1,1,
        'CREATED',1000,'YER',1,'single-order-payment','CASH_ON_DELIVERY','REQUIRES_COLLECTION','BTHWANI_CAPTAIN',1000)`, order, actor, store, city); err != nil {
			t.Fatal(err)
		}
		conversion := func(contentID, eventID string) postgres.DiscoveryContentEventInput {
			return postgres.DiscoveryContentEventInput{ID: eventID, ClientEventID: eventID, ContentID: contentID,
				EventType: "CONVERSION", ClientSessionID: session, ClientActorID: actor, OrderID: order}
		}
		if err := postgres.RecordDiscoveryContentEvent(ctx, db, conversion("first-banner", "conversion-old")); !errors.Is(err, postgres.ErrDiscoveryContentEventInvalid) {
			t.Fatalf("older banner must not claim latest-click order: %v", err)
		}
		winner := conversion("last-banner", "conversion-last")
		if err := postgres.RecordDiscoveryContentEvent(ctx, db, winner); err != nil {
			t.Fatalf("latest conversion: %v", err)
		}
		if err := postgres.RecordDiscoveryContentEvent(ctx, db, winner); err != nil {
			t.Fatalf("exact replay: %v", err)
		}
		if err := postgres.RecordDiscoveryContentEvent(ctx, db, conversion("last-banner", "conversion-duplicate")); !errors.Is(err, postgres.ErrDiscoveryContentEventConflict) {
			t.Fatalf("different event ID must not count the same order twice: %v", err)
		}
		var n int
		var attributed string
		if err := db.QueryRowContext(ctx, "SELECT COUNT(*),MAX(content_id) FROM dsh.discovery_content_events WHERE event_type='CONVERSION' AND order_id=$1", order).Scan(&n, &attributed); err != nil || n != 1 || attributed != "last-banner" {
			t.Fatalf("order has %d conversions, attributed=%s, err=%v", n, attributed, err)
		}
	})
}
