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

// Verify that participation is store-scoped, city-scoped, versioned and
// idempotent, and that public offers disappear on refusal. Uses a fresh DB.
func TestPartnerCampaignConsentGatesStoreVisibilityAndRejectsCrossCity(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("DSH_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("isolated PostgreSQL connection required")
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
		const cityA, cityB = "consent-city-a", "consent-city-b"
		for _, city := range []string{cityA, cityB} {
			if _, err := db.ExecContext(ctx, "INSERT INTO dsh.service_cities(id,display_name_ar,active) VALUES($1,$2,true)", city, "مدينة اختبار "+city); err != nil {
				t.Fatal(err)
			}
		}
		insertCanonicalStoreFixture(t, ctx, db, canonicalStoreFixture{ID: "consent-store-a", PartnerActorID: "partner-a", Name: "Partner A Store", ServiceCityID: cityA, PublicationState: "published"})
		insertCanonicalStoreFixture(t, ctx, db, canonicalStoreFixture{ID: "consent-store-b", PartnerActorID: "partner-b", Name: "Partner B Store", ServiceCityID: cityA, PublicationState: "published"})
		insertCanonicalStoreFixture(t, ctx, db, canonicalStoreFixture{ID: "consent-store-outside", PartnerActorID: "partner-c", Name: "Partner C Store", ServiceCityID: cityB, PublicationState: "published"})
		share := 40
		promotion := postgres.PromotionInput{
			ID: "consent-campaign", Code: "CONSENT40", NameAr: "حملة مشاركة متجرية",
			Kind: "PERCENTAGE", ValueMinor: 20, FundingSource: "SHARED",
			FundingSharePartnerPercent: &share, ServiceCityID: cityA,
			RequiresPartnerOptIn: true, StartsAt: time.Now().UTC().Add(-time.Hour),
			CreatedByActorID: "operator-marketing",
		}
		saved, replayed, err := postgres.CreatePromotion(ctx, db, promotion, "consent-create", "consent-create-hash")
		if err != nil || replayed || saved.State != "DRAFT" {
			t.Fatalf("create: %+v replay=%v error=%v", saved, replayed, err)
		}
		if _, _, err := postgres.SetPromotionState(ctx, db, promotion.ID, "PUBLISHED", "consent-publish", "consent-publish-hash", saved.Version); err != nil {
			t.Fatal(err)
		}
		checkVisible := func(storeID string, count int) {
			t.Helper()
			list, err := postgres.ListPromotions(ctx, db, true, cityA, storeID)
			if err != nil || len(list) != count {
				t.Fatalf("store %s: expected %d visible offers, got %d, error=%v", storeID, count, len(list), err)
			}
		}
		checkVisible("consent-store-a", 0)
		checkVisible("consent-store-b", 0)
		listA, err := postgres.ListPartnerEligibleCampaigns(ctx, db, "consent-store-a")
		if err != nil || len(listA) != 1 || listA[0].StoreOptInState != "" {
			t.Fatalf("campaign invitation not visible: %+v %v", listA, err)
		}
		listOutside, err := postgres.ListPartnerEligibleCampaigns(ctx, db, "consent-store-outside")
		if err != nil || len(listOutside) != 0 {
			t.Fatalf("foreign city invitation leaked: %+v %v", listOutside, err)
		}
		_, _, err = postgres.SetPartnerCampaignOptIn(ctx, db, promotion.ID, "consent-store-outside", "partner-c", "OPTED_IN", 1, "outside-consent", "outside-correlation")
		if !errors.Is(err, postgres.ErrPromotionNotFound) {
			t.Fatalf("cross-city consent must fail: %v", err)
		}
		_, _, err = postgres.SetPartnerCampaignOptIn(ctx, db, promotion.ID, "consent-store-a", "partner-a", "OPTED_IN", 2, "stale-first", "stale-first-correlation")
		if !errors.Is(err, postgres.ErrPromotionVersionConflict) {
			t.Fatalf("first consent requires version 1: %v", err)
		}
		agreed, replayed, err := postgres.SetPartnerCampaignOptIn(ctx, db, promotion.ID, "consent-store-a", "partner-a", "OPTED_IN", 1, "accept-a", "accept-a-correlation")
		if err != nil || replayed || agreed.StoreOptInState != "OPTED_IN" {
			t.Fatalf("consent not saved: %+v replay=%v error=%v", agreed, replayed, err)
		}
		checkVisible("consent-store-a", 1)
		checkVisible("consent-store-b", 0)
		repeated, replayed, err := postgres.SetPartnerCampaignOptIn(ctx, db, promotion.ID, "consent-store-a", "partner-a", "OPTED_IN", 1, "accept-a", "accept-a-correlation")
		if err != nil || !replayed || repeated.StoreOptInVersion != agreed.StoreOptInVersion {
			t.Fatalf("consent replay invalid: %+v replay=%v error=%v", repeated, replayed, err)
		}
		if _, _, err := postgres.SetPartnerCampaignOptIn(ctx, db, promotion.ID, "consent-store-a", "partner-a", "DECLINED", 1, "decline-a", "decline-a-correlation"); err != nil {
			t.Fatal(err)
		}
		checkVisible("consent-store-a", 0)
		_, _, err = postgres.SetPartnerCampaignOptIn(ctx, db, promotion.ID, "consent-store-a", "partner-a", "OPTED_IN", 1, "stale-after-decline", "stale-after-decline-correlation")
		if !errors.Is(err, postgres.ErrPromotionVersionConflict) {
			t.Fatalf("old version unexpectedly restored consent: %v", err)
		}
		var foreignChoices int
		if err := db.QueryRowContext(ctx, "SELECT COUNT(*) FROM dsh.commerce_promotion_store_opt_ins WHERE store_id='consent-store-outside'").Scan(&foreignChoices); err != nil || foreignChoices != 0 {
			t.Fatalf("foreign store decision persisted: %d err=%v", foreignChoices, err)
		}
	})
}
