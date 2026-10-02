package postgres_test

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	_ "github.com/lib/pq"
)

func TestPublicPromotionsAreStoreScopedAndBounded(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("DSH_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("DSH_DATABASE_URL is required for promotion scope persistence proof")
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
			cityID     = "marketing-scope-city"
			storeAID   = "marketing-scope-store-a"
			storeBID   = "marketing-scope-store-b"
			partnerAID = "marketing-scope-partner-a"
			partnerBID = "marketing-scope-partner-b"
		)
		if _, err := db.ExecContext(ctx, "INSERT INTO dsh.service_cities(id,display_name_ar,active) VALUES($1,$2,true)", cityID, "مدينة العروض"); err != nil {
			t.Fatalf("insert service city: %v", err)
		}
		for _, store := range []struct{ id, partner, name string }{{storeAID, partnerAID, "متجر أ"}, {storeBID, partnerBID, "متجر ب"}} {
			insertCanonicalStoreFixture(t, ctx, db, canonicalStoreFixture{
				ID:             store.id,
				PartnerActorID: store.partner,
				Name:           store.name,
				ServiceCityID:  cityID,
			})
		}

		startsAt := time.Now().UTC().Add(-time.Hour)
		for index := 0; index < 6; index++ {
			createPublishedPromotion(t, ctx, db, fmt.Sprintf("global-promotion-%d", index), fmt.Sprintf("GLOBAL%d", index), "", cityID, startsAt.Add(time.Duration(index)*time.Minute))
		}
		createPublishedPromotion(t, ctx, db, "store-a-promotion", "STOREA", storeAID, cityID, startsAt.Add(10*time.Minute))
		createPublishedPromotion(t, ctx, db, "store-b-promotion", "STOREB", storeBID, cityID, startsAt.Add(20*time.Minute))

		global, err := postgres.ListPromotions(ctx, db, true, cityID, "")
		if err != nil {
			t.Fatalf("list public global promotions: %v", err)
		}
		if len(global) != 4 {
			t.Fatalf("global public promotions returned %d records, want the bounded four displayed by Client", len(global))
		}
		for _, promotion := range global {
			if promotion.StoreID != "" {
				t.Errorf("global listing exposed store-scoped promotion %s for %s", promotion.ID, promotion.StoreID)
			}
		}

		storeA, err := postgres.ListPromotions(ctx, db, true, cityID, storeAID)
		if err != nil {
			t.Fatalf("list public store A promotions: %v", err)
		}
		foundStoreA := false
		for _, promotion := range storeA {
			if promotion.StoreID == storeBID {
				t.Errorf("store A listing exposed store B promotion %s", promotion.ID)
			}
			foundStoreA = foundStoreA || promotion.ID == "store-a-promotion"
		}
		if !foundStoreA {
			t.Fatalf("store A listing omitted its applicable promotion: %+v", storeA)
		}
	})
}

func TestOperatorPromotionRegistryFiltersCityBeforePageLimit(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("DSH_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("DSH_DATABASE_URL is required for operator promotion registry pagination proof")
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
		const cityA = "promotion-registry-city-a"
		const cityB = "promotion-registry-city-b"
		for _, city := range []struct{ id, name string }{{cityA, "مدينة أ"}, {cityB, "مدينة ب"}} {
			if _, err := db.ExecContext(ctx, "INSERT INTO dsh.service_cities(id,display_name_ar,active) VALUES($1,$2,true)", city.id, city.name); err != nil {
				t.Fatalf("insert service city %s: %v", city.id, err)
			}
		}

		startsAt := time.Date(2026, 9, 1, 12, 0, 0, 0, time.UTC)
		for _, promotion := range []struct {
			id, code, cityID string
			minute           int
		}{{"city-a-1", "CITYA1", cityA, 1}, {"city-a-2", "CITYA2", cityA, 3}, {"city-a-3", "CITYA3", cityA, 5}, {"city-b-1", "CITYB1", cityB, 4}, {"city-b-2", "CITYB2", cityB, 6}} {
			createPublishedPromotion(t, ctx, db, promotion.id, promotion.code, "", promotion.cityID, startsAt.Add(time.Duration(promotion.minute)*time.Minute))
		}

		query := postgres.OperatorPromotionRegistryQuery{State: "PUBLISHED", ServiceCityID: cityA, Sort: "starts_desc", Limit: 2}
		first, err := postgres.ListOperatorPromotionRegistry(ctx, db, query)
		if err != nil {
			t.Fatalf("list first city A promotion page: %v", err)
		}
		if len(first.Promotions) != 2 || !first.HasMore || first.Promotions[0].ID != "city-a-3" || first.Promotions[1].ID != "city-a-2" {
			t.Fatalf("city A first page must filter before its limit, got %+v", first)
		}

		query.AfterStartsAt = &first.Promotions[1].StartsAt
		query.AfterID = first.Promotions[1].ID
		second, err := postgres.ListOperatorPromotionRegistry(ctx, db, query)
		if err != nil {
			t.Fatalf("list second city A promotion page: %v", err)
		}
		if len(second.Promotions) != 1 || second.HasMore || second.Promotions[0].ID != "city-a-1" {
			t.Fatalf("city A continuation must contain the remaining eligible row only, got %+v", second)
		}
	})
}

func createPublishedPromotion(t *testing.T, ctx context.Context, db *sql.DB, id, code, storeID, cityID string, startsAt time.Time) {
	t.Helper()
	_, replayed, err := postgres.CreatePromotion(ctx, db, postgres.PromotionInput{
		ID: id, Code: code, NameAr: "عرض تجريبي", Kind: "FIXED", ValueMinor: 100,
		FundingSource: "MERCHANT", StoreID: storeID, ServiceCityID: cityID, StartsAt: startsAt,
		CreatedByActorID: "marketing-test-operator",
	}, "create-"+id, postgres.HashMarketingFacts("create", id, code))
	if err != nil || replayed {
		t.Fatalf("create promotion %s: replayed=%t err=%v", id, replayed, err)
	}
	if _, replayed, err := postgres.SetPromotionState(ctx, db, id, "PUBLISHED", "publish-"+id, postgres.HashMarketingFacts("publish", id), 1); err != nil || replayed {
		t.Fatalf("publish promotion %s: replayed=%t err=%v", id, replayed, err)
	}
}

func TestPublicDiscoveryContentIsEligibleAndBoundedBySurface(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("DSH_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("DSH_DATABASE_URL is required for public discovery-content persistence proof")
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
		const cityID = "discovery-feed-city"
		if _, err := db.ExecContext(ctx, "INSERT INTO dsh.service_cities(id,display_name_ar,active) VALUES($1,$2,true)", cityID, "مدينة المحتوى"); err != nil {
			t.Fatalf("insert service city: %v", err)
		}

		startsAt := time.Now().UTC().Add(-time.Hour)
		addContent := func(id, kind, targetType, targetID string, ordinal int) {
			t.Helper()
			assetID := id + "-asset"
			if _, err := db.ExecContext(ctx, `INSERT INTO dsh.discovery_content_media_assets(
				id,idempotency_key,request_hash,object_key,uri,content_sha256,content_type,byte_size,
				state,creator,source_description,rights_statement,rights_attested_by_actor_id
			) VALUES($1,$2,$3,$4,$5,$6,'image/jpeg',128,'active','Fixture Owner','Discovery fixture image','Licensed for integration test','marketing-fixture-operator')`,
				assetID, "idempotency-"+assetID, postgres.HashMarketingFacts(assetID), "fixture/"+assetID, "asset://"+assetID, strings.Repeat("a", 64)); err != nil {
				t.Fatalf("insert discovery media asset %s: %v", assetID, err)
			}
			var targetValue any
			if targetID != "" {
				targetValue = targetID
			}
			if _, err := db.ExecContext(ctx, `INSERT INTO dsh.discovery_content(
				id,kind,title_ar,body_ar,media_asset_id,target_type,target_id,service_city_id,state,starts_at,ordinal,created_by_actor_id
			) VALUES($1,$2,'محتوى تجريبي','',$3,$4,$5,$6,'PUBLISHED',$7,$8,'marketing-fixture-operator')`,
				id, kind, assetID, targetType, targetValue, cityID, startsAt, ordinal); err != nil {
				t.Fatalf("insert discovery content %s: %v", id, err)
			}
		}

		for index := 0; index < 3; index++ {
			addContent(fmt.Sprintf("invalid-media-%02d", index), "BANNER", "STORE", fmt.Sprintf("missing-store-%02d", index), 0)
		}
		for index := 0; index < 10; index++ {
			kind := "BANNER"
			if index%2 == 1 {
				kind = "CAROUSEL"
			}
			addContent(fmt.Sprintf("visible-media-%02d", index), kind, "INFO", "", index+1)
		}
		for index := 0; index < 2; index++ {
			addContent(fmt.Sprintf("invalid-short-%02d", index), "SHORT_FORM", "STORE", fmt.Sprintf("missing-short-store-%02d", index), 0)
		}
		for index := 0; index < 7; index++ {
			addContent(fmt.Sprintf("visible-short-%02d", index), "SHORT_FORM", "INFO", "", index+1)
		}

		items, err := postgres.ListDiscoveryContent(ctx, db, true, " "+cityID+" ")
		if err != nil {
			t.Fatalf("list public discovery content: %v", err)
		}
		if len(items) != 12 {
			t.Fatalf("public discovery returned %d rows, want the Client's bounded 8 media and 4 short-form items", len(items))
		}
		mediaIDs := make([]string, 0, 8)
		shortIDs := make([]string, 0, 4)
		for _, item := range items {
			switch item.Kind {
			case "BANNER", "CAROUSEL":
				mediaIDs = append(mediaIDs, item.ID)
			case "SHORT_FORM":
				shortIDs = append(shortIDs, item.ID)
			default:
				t.Errorf("public projection returned unexpected content kind %q", item.Kind)
			}
			if strings.HasPrefix(item.ID, "invalid-") {
				t.Errorf("public projection retained ineligible high-priority target %s", item.ID)
			}
			if item.MediaURI == "" {
				t.Errorf("public projection returned content without its active media URI: %s", item.ID)
			}
		}
		for index, id := range []string{"visible-media-00", "visible-media-01", "visible-media-02", "visible-media-03", "visible-media-04", "visible-media-05", "visible-media-06", "visible-media-07"} {
			if index >= len(mediaIDs) || mediaIDs[index] != id {
				t.Fatalf("media priority %d = %v, want %s", index, mediaIDs, id)
			}
		}
		for index, id := range []string{"visible-short-00", "visible-short-01", "visible-short-02", "visible-short-03"} {
			if index >= len(shortIDs) || shortIDs[index] != id {
				t.Fatalf("short-form priority %d = %v, want %s", index, shortIDs, id)
			}
		}
	})
}
