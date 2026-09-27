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
			if _, err := db.ExecContext(ctx, "INSERT INTO dsh.stores(id,partner_actor_id,name) VALUES($1,$2,$3)", store.id, store.partner, store.name); err != nil {
				t.Fatalf("insert store %s: %v", store.id, err)
			}
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
