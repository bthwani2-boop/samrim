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

func TestPartnerStoreContentAnalyticsNeverLeaksAnotherStore(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("DSH_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("isolated DSH_DATABASE_URL required")
	}
	root, err := sql.Open("postgres", databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = root.Close() })
	withFreshDatabase(t, root, databaseURL, func(ctx context.Context, db *sql.DB, records []postgres.MigrationRecord, sqls []string) {
		if err := postgres.Migrate(ctx, db, records, sqls, testDeliveryProofKeyring(t)); err != nil {
			t.Fatal(err)
		}
		const (
			city   = "partner-analytics-city"
			storeA = "partner-analytics-a"
			storeB = "partner-analytics-b"
			reel   = "partner-analytics-content"
		)
		if _, err := db.ExecContext(ctx,
			"INSERT INTO dsh.service_cities(id,display_name_ar,active) VALUES($1,'مدينة اختبار',true)", city); err != nil {
			t.Fatal(err)
		}
		insertCanonicalStoreFixture(t, ctx, db, canonicalStoreFixture{
			ID: storeA, PartnerActorID: "partner-a", Name: "Store A", ServiceCityID: city,
		})
		insertCanonicalStoreFixture(t, ctx, db, canonicalStoreFixture{
			ID: storeB, PartnerActorID: "partner-b", Name: "Store B", ServiceCityID: city,
		})
		if _, err := db.ExecContext(ctx, `INSERT INTO dsh.discovery_content_media_assets(
			id,idempotency_key,request_hash,object_key,uri,content_sha256,content_type,byte_size,
			state,creator,source_description,rights_statement,rights_attested_by_actor_id)
			VALUES('analytics-video','analytics-media-key',$1,'media/analytics-video',
			'asset://analytics-video',$2,'video/mp4',128,'active','Store A','Isolated test','Test rights','partner-a')`,
			strings.Repeat("b", 64), strings.Repeat("a", 64)); err != nil {
			t.Fatal(err)
		}
		if _, err := db.ExecContext(ctx, `INSERT INTO dsh.discovery_content(
			id,kind,title_ar,media_asset_id,target_type,target_id,source_store_id,service_city_id,
			state,starts_at,created_by_actor_id)
			VALUES($1,'SHORT_FORM','مقطع متجر اختباري','analytics-video','STORE',$2,$2,$3,
			'PUBLISHED',clock_timestamp()-interval '1 hour','partner-a')`, reel, storeA, city); err != nil {
			t.Fatal(err)
		}
		if err := postgres.RecordDiscoveryContentEvent(ctx, db, postgres.DiscoveryContentEventInput{
			ID: "analytics-impression", ClientEventID: "analytics-impression", ContentID: reel,
			EventType: "IMPRESSION", ClientSessionID: "analytics-session",
		}); err != nil {
			t.Fatal(err)
		}
		if err := postgres.RecordDiscoveryContentEvent(ctx, db, postgres.DiscoveryContentEventInput{
			ID: "analytics-click", ClientEventID: "analytics-click", ContentID: reel,
			EventType: "CLICK", ClientSessionID: "analytics-session",
		}); err != nil {
			t.Fatal(err)
		}
		// Isolated fixture: two canonically related Store Orders, one completed.
		for _, row := range []struct {
			id    string
			state string
		}{
			{"analytics-order-delivered", "DELIVERED"},
			{"analytics-order-cancelled", "CANCELLED"},
		} {
			cartID := "analytics-cart-" + row.id
			if _, err := db.ExecContext(ctx, "INSERT INTO dsh.commerce_carts(id,client_actor_id,store_id,state,version) VALUES($1,'analytics-client', $2, 'checked_out',1)", cartID, storeA); err != nil {
				t.Fatal(err)
			}
			if _, err := db.ExecContext(ctx, `INSERT INTO dsh.commerce_orders(
				id, client_actor_id, store_id, cart_id, service_city_id, serviceability_store_version,
				state, total_amount_minor, currency, version, payment_intent_id, payment_method,
				payment_state, fulfillment_mode, payment_cash_amount_minor, cancellation_mode,
				cancellation_policy_version)
				VALUES($1,'analytics-client',$2,$3,$4,1,$5,200,'YER',1,$6,'CASH_AT_STORE',
				'REQUIRES_COLLECTION','CUSTOMER_PICKUP',200,'OPERATIONS_ONLY',1)`,
				row.id, storeA, cartID, city, row.state, "analytics-payment-"+row.id); err != nil {
				t.Fatal(err)
			}
			if _, err := db.ExecContext(ctx, `INSERT INTO dsh.discovery_content_events(
				id, client_event_id, content_id, event_type, client_session_id,
				client_actor_id, order_id, occurred_at)
				VALUES($1,$1,$2,'CONVERSION','analytics-session','analytics-client',$3,
				CASE WHEN $3='analytics-order-cancelled' THEN clock_timestamp()-interval '40 days'
				ELSE clock_timestamp() END)`, "analytics-conversion-"+row.id, reel, row.id); err != nil {
				t.Fatal(err)
			}
		}
		totals, err := postgres.ReadStoreContentPerformanceSummary(ctx, db, storeA, "all", nil)
		if err != nil || totals.StoreID != storeA || totals.ContentCount != 1 || totals.Impressions != 1 ||
			totals.Clicks != 1 || totals.AttributedOrdersCreated != 2 || totals.AttributedOrdersCompleted != 1 || totals.Period != "all" {
			t.Fatalf("Store A content summary incorrect: %+v error=%v", totals, err)
		}
		otherTotals, err := postgres.ReadStoreContentPerformanceSummary(ctx, db, storeB, "all", nil)
		if err != nil || otherTotals.StoreID != storeB || otherTotals.ContentCount != 0 ||
			otherTotals.Impressions != 0 || otherTotals.Clicks != 0 || otherTotals.AttributedOrdersCreated != 0 || otherTotals.AttributedOrdersCompleted != 0 {
			t.Fatalf("Store B summary includes another Store: %+v error=%v", otherTotals, err)
		}
		cutoff := time.Now().UTC().AddDate(0, 0, -7)
		recent, err := postgres.ReadStoreContentPerformanceSummary(ctx, db, storeA, "7d", &cutoff)
		if err != nil || recent.Period != "7d" || recent.ContentCount != 1 || recent.Impressions != 1 ||
			recent.Clicks != 1 || recent.AttributedOrdersCreated != 1 || recent.AttributedOrdersCompleted != 1 {
			t.Fatalf("recent marketing attribution totals wrong: %+v err=%v", recent, err)
		}
		if _, err := postgres.ReadStoreContentPerformanceSummary(ctx, db, storeA, "invalid", &cutoff); !errors.Is(err, postgres.ErrDiscoveryContentInvalid) {
			t.Fatalf("invalid period accepted: %v", err)
		}
		items, belongs, err := postgres.ListPartnerStoreContentAnalytics(ctx, db, storeA, reel)
		if err != nil || !belongs {
			t.Fatalf("owner read: belongs=%t error=%v", belongs, err)
		}
		if len(items) != 3 {
			t.Fatalf("expected all three analytics event categories, got %+v", items)
		}
		for _, item := range items {
			want := int64(1)
			if item.EventType == "CONVERSION" {
				want = 2
			}
			if item.ContentID != reel || item.Count != want {
				t.Fatalf("unexpected owner data: %+v", item)
			}
		}
		foreign, belongs, err := postgres.ListPartnerStoreContentAnalytics(ctx, db, storeB, reel)
		if err != nil || belongs || len(foreign) != 0 {
			t.Fatalf("cross-Store leak: belongs=%t items=%+v err=%v", belongs, foreign, err)
		}
		missing, belongs, err := postgres.ListPartnerStoreContentAnalytics(ctx, db, storeA, "missing-content")
		if err != nil || belongs || len(missing) != 0 {
			t.Fatalf("unknown content leak: belongs=%t items=%+v err=%v", belongs, missing, err)
		}
	})
}
