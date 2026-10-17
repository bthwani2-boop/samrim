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

func TestPartnerFundedPlatformOfferIsNotVisibleOrRedeemableWithoutConsent(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("DSH_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("DSH_DATABASE_URL is required for isolated Partner consent proof")
	}
	rootDB, err := sql.Open("postgres", databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = rootDB.Close() })
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	if err := rootDB.PingContext(ctx); err != nil {
		t.Fatal(err)
	}
	withFreshDatabase(t, rootDB, databaseURL, func(ctx context.Context, db *sql.DB, records []postgres.MigrationRecord, migrationSQL []string) {
		if err := postgres.Migrate(ctx, db, records, migrationSQL, testDeliveryProofKeyring(t)); err != nil {
			t.Fatal(err)
		}
		const city, store, code, offerID = "consent-city", "consent-store", "CONSENT40", "consent-promotion"
		if _, err := db.ExecContext(ctx, "INSERT INTO dsh.service_cities(id,display_name_ar,active) VALUES($1,'Test City',true)", city); err != nil {
			t.Fatal(err)
		}
		insertCanonicalStoreFixture(t, ctx, db, canonicalStoreFixture{ID: store, PartnerActorID: "consent-partner", Name: "Test Store", ServiceCityID: city})
		item, replayed, err := postgres.CreatePromotion(ctx, db, postgres.PromotionInput{
			ID: offerID, Code: code, NameAr: "حملة شريك", Kind: "FIXED", ValueMinor: 100,
			FundingSource: "PARTNER", ServiceCityID: city, RequiresPartnerOptIn: true,
			StartsAt: time.Now().UTC().Add(-time.Hour), CreatedByActorID: "operator-consent",
		}, "create-consent", postgres.HashMarketingFacts("create-consent"))
		if err != nil || replayed {
			t.Fatalf("create consent-gated campaign: %+v replay=%v err=%v", item, replayed, err)
		}
		if _, _, err := postgres.SetPromotionState(ctx, db, offerID, "PUBLISHED", "publish-consent", postgres.HashMarketingFacts("publish-consent"), item.Version); err != nil {
			t.Fatal(err)
		}
		assertHidden := func(stage string) {
			t.Helper()
			public, err := postgres.ListPromotions(ctx, db, true, city, store)
			if err != nil {
				t.Fatal(err)
			}
			for _, promotion := range public {
				if promotion.ID == offerID {
					t.Fatalf("%s: partner-funded campaign disclosed without consent", stage)
				}
			}
			_, _, err = postgres.EvaluatePromotion(ctx, db, code, store, city, "test-customer", 1000, nil, false)
			if !errors.Is(err, postgres.ErrPromotionUnavailable) {
				t.Fatalf("%s: campaign redeemability must fail without consent: %v", stage, err)
			}
		}
		assertHidden("before opt-in")
		counts, err := postgres.CountPublicPromotionsForStores(ctx, db, city, []string{store})
		if err != nil || counts[store] != 0 {
			t.Fatalf("unconsented partner campaign must not contribute to public store badge: counts=%+v err=%v", counts, err)
		}
		// Verify legacy unsafe data is also fail-closed by both public listing and
		// server-side checkout evaluation; never assume old flags were correct.
		if _, err := db.ExecContext(ctx, "UPDATE dsh.commerce_promotions SET requires_partner_opt_in=false WHERE id=$1", offerID); err != nil {
			t.Fatal(err)
		}
		assertHidden("legacy missing opt-in flag")
		opted, replayed, err := postgres.SetPartnerCampaignOptIn(ctx, db, offerID, store, "consent-partner", "OPTED_IN", 1, "consent-optin", "consent-correlation")
		if err != nil || replayed || opted.StoreOptInState != "OPTED_IN" {
			t.Fatalf("partner opt-in: %+v replay=%v err=%v", opted, replayed, err)
		}
		public, err := postgres.ListPromotions(ctx, db, true, city, store)
		if err != nil {
			t.Fatal(err)
		}
		found := false
		for _, promotion := range public {
			found = found || promotion.ID == offerID
		}
		if !found {
			t.Fatal("opted-in Store must see its partner-funded campaign")
		}
		counts, err = postgres.CountPublicPromotionsForStores(ctx, db, city, []string{store})
		if err != nil || counts[store] != 1 {
			t.Fatalf("opted-in partner campaign must contribute to public store badge: counts=%+v err=%v", counts, err)
		}
		promotion, discount, err := postgres.EvaluatePromotion(ctx, db, code, store, city, "test-customer", 1000, nil, false)
		if err != nil || promotion.ID != offerID || discount != 100 {
			t.Fatalf("authorized checkout eligibility: promotion=%+v discount=%d err=%v", promotion, discount, err)
		}
	})
}
