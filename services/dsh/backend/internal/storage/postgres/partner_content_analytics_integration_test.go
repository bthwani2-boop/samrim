package postgres_test

import (
	"context"
	"database/sql"
	"os"
	"strings"
	"testing"

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
		totals, err := postgres.ReadStoreContentPerformanceSummary(ctx, db, storeA)
		if err != nil || totals.StoreID != storeA || totals.ContentCount != 1 || totals.Impressions != 1 ||
			totals.Clicks != 1 || totals.AttributedOrdersCreated != 0 {
			t.Fatalf("Store A content summary incorrect: %+v error=%v", totals, err)
		}
		otherTotals, err := postgres.ReadStoreContentPerformanceSummary(ctx, db, storeB)
		if err != nil || otherTotals.StoreID != storeB || otherTotals.ContentCount != 0 ||
			otherTotals.Impressions != 0 || otherTotals.Clicks != 0 || otherTotals.AttributedOrdersCreated != 0 {
			t.Fatalf("Store B summary includes another Store: %+v error=%v", otherTotals, err)
		}
		items, belongs, err := postgres.ListPartnerStoreContentAnalytics(ctx, db, storeA, reel)
		if err != nil || !belongs {
			t.Fatalf("owner read: belongs=%t error=%v", belongs, err)
		}
		if len(items) != 2 {
			t.Fatalf("expected two analytics event categories, got %+v", items)
		}
		for _, item := range items {
			if item.ContentID != reel || item.Count != 1 {
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
