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

// Search proof runs only on a fresh, disposable DSH database managed by
// withFreshDatabase, never on the user's retained local Store/Order state.
func TestCustomerCatalogInfixSearchFreshDatabase(t *testing.T) {
	uri := strings.TrimSpace(os.Getenv("DSH_DATABASE_URL"))
	if uri == "" {
		t.Skip("isolated DSH_DATABASE_URL required")
	}
	root, err := sql.Open("postgres", uri)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = root.Close() })

	withFreshDatabase(t, root, uri, func(ctx context.Context, db *sql.DB, records []postgres.MigrationRecord, statements []string) {
		if err := postgres.Migrate(ctx, db, records, statements, testDeliveryProofKeyring(t)); err != nil {
			t.Fatalf("migrate fresh DSH: %v", err)
		}
		if err := postgres.VerifySchema(ctx, db, records); err != nil {
			t.Fatalf("search-index schema verification: %v", err)
		}
		const city = "search-test-city"
		const store = "search-test-store"
		if _, err := db.ExecContext(ctx, "INSERT INTO dsh.service_cities(id,display_name_ar,active) VALUES($1,$2,true)", city, "مدينة اختبار البحث"); err != nil {
			t.Fatal(err)
		}
		insertCanonicalStoreFixture(t, ctx, db, canonicalStoreFixture{ID: store, PartnerActorID: "search-test-owner", Name: "متجر البحث", ServiceCityID: city, PublicationState: "published"})
		if _, err := db.ExecContext(ctx, `INSERT INTO dsh.joining_cases (
			id,contact_phone_e164,business_name,first_store_name,partner_actor_id,
			state,store_id,origin,financial_profile_state
		) VALUES($1,$2,$3,$4,$5,'approved',$6,'control_panel','ACTIVE')`,
			"search-test-case", "+967700000981", "متجر البحث", "متجر البحث", "search-test-owner", store); err != nil {
			t.Fatalf("admit test Store: %v", err)
		}
		createOffer := func(name, suffix string) string {
			t.Helper()
			input := postgres.CatalogProductInput{
				VerticalID: store + "-vertical", Scope: "STORE_SCOPED", StoreID: store,
				CanonicalName: name, VariantTitle: "عادي", MeasurementKind: "DISCRETE", BaseUnit: "COUNT",
			}
			product, err := postgres.CreateCatalogProduct(ctx, db, input, "create-"+suffix, postgres.HashCatalogProductCreateRequest(input), "search-test-owner", "search-test-correlation")
			if err != nil {
				t.Fatalf("create %s: %v", name, err)
			}
			offerInput := postgres.CatalogOfferInput{
				StoreID: store, VariantID: product.Product.Variants[0].ID,
				PriceMinor: map[string]int64{"charger": 4200, "earbuds": 2100}[suffix], QuantityPolicy: "DISCRETE", QuantityMinBaseUnits: 1,
				QuantityMaxBaseUnits: 5, QuantityStepBaseUnits: 1,
				PricingBasis: "PER_UNIT", PricingUnitBaseUnits: 1, InventoryPolicy: "AVAILABILITY_ONLY",
			}
			offer, err := postgres.CreateCatalogOffer(ctx, db, offerInput, "offer-"+suffix, postgres.HashCatalogOfferCreateRequest(offerInput), "search-test-owner", "search-test-correlation")
			if err != nil {
				t.Fatal(err)
			}
			if _, err := db.ExecContext(ctx, "UPDATE dsh.catalog_store_offers SET publication_state='published',availability=true WHERE id=$1", offer.Offer.ID); err != nil {
				t.Fatal(err)
			}
			return offer.Offer.ID
		}
		first := createOffer("شاحن USB-C سريع", "charger")
		second := createOffer("سماعات USB-C لاسلكية", "earbuds")
		page, err := postgres.SearchPublicCatalog(ctx, db, city, "", "", "USB", 1, "")
		if err != nil || len(page.Offers) != 1 || page.NextCursor == nil {
			t.Fatalf("in-name search page 1 failed: %+v %v", page, err)
		}
		page2, err := postgres.SearchPublicCatalog(ctx, db, city, "", "", "USB", 1, *page.NextCursor)
		if err != nil || len(page2.Offers) != 1 || page2.Offers[0].ID == page.Offers[0].ID {
			t.Fatalf("in-name search page 2 failed: %+v %v", page2, err)
		}
		ids := map[string]bool{page.Offers[0].ID: true, page2.Offers[0].ID: true}
		if !ids[first] || !ids[second] {
			t.Fatalf("the real in-name results are incomplete: %+v", ids)
		}
		for _, tc := range []struct {
			sort, firstID, secondID string
		}{
			{"PRICE_ASC", second, first},
			{"PRICE_DESC", first, second},
		} {
			sorted, err := postgres.SearchPublicCatalog(ctx, db, city, "", "", "USB", 1, "", "", tc.sort)
			if err != nil || len(sorted.Offers) != 1 || sorted.Offers[0].ID != tc.firstID || sorted.NextCursor == nil {
				t.Fatalf("sort=%s first page wrong: %+v %v", tc.sort, sorted, err)
			}
			next, err := postgres.SearchPublicCatalog(ctx, db, city, "", "", "USB", 1, *sorted.NextCursor, "", tc.sort)
			if err != nil || len(next.Offers) != 1 || next.Offers[0].ID != tc.secondID {
				t.Fatalf("sort=%s second page wrong: %+v %v", tc.sort, next, err)
			}
			if _, err := postgres.SearchPublicCatalog(ctx, db, city, "", "", "USB", 1, *sorted.NextCursor, "", ""); !errors.Is(err, postgres.ErrCatalogSearchInvalidCursor) {
				t.Fatalf("sort %s cursor accepted original order: %v", tc.sort, err)
			}
		}
		if _, err := postgres.SearchPublicCatalog(ctx, db, city, "", "", "HDMI", 1, *page.NextCursor); !errors.Is(err, postgres.ErrCatalogSearchInvalidCursor) {
			t.Fatalf("cursor accepted a different query: %v", err)
		}
		for _, query := range []string{"%", "_", "xx-no-match"} {
			empty, err := postgres.SearchPublicCatalog(ctx, db, city, "", "", query, 20, "")
			if err != nil || len(empty.Offers) != 0 {
				t.Fatalf("escaped search %q leaked results: %+v %v", query, empty, err)
			}
		}
		short, err := postgres.SearchPublicCatalog(ctx, db, city, "", "", "US", 20, "")
		if err != nil || len(short.Offers) != 0 {
			t.Fatalf("short search must remain prefix-only: %+v %v", short, err)
		}
		otherCity, err := postgres.SearchPublicCatalog(ctx, db, "other-city", "", "", "USB", 20, "")
		if err != nil || len(otherCity.Offers) != 0 {
			t.Fatalf("city isolation failed: %+v %v", otherCity, err)
		}
	})
}
