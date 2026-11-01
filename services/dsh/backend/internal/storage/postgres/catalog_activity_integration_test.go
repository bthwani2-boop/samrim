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

// Proves Store isolation and stable cursor traversal against real canonical
// Product/Offer audit events, never hand-crafted audit table rows.
func TestCatalogActivityStoreScopedPaginationAndIsolation(t *testing.T) {
	dsn := strings.TrimSpace(os.Getenv("DSH_DATABASE_URL"))
	if dsn == "" {
		t.Skip("isolated DSH_DATABASE_URL required")
	}
	root, err := sql.Open("postgres", dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = root.Close() })
	withFreshDatabase(t, root, dsn, func(ctx context.Context, db *sql.DB, records []postgres.MigrationRecord, migrations []string) {
		if err := postgres.Migrate(ctx, db, records, migrations, testDeliveryProofKeyring(t)); err != nil {
			t.Fatal(err)
		}
		const verticalID = "activity-proof-vertical"
		const categoryID = "activity-proof-category"
		const storeA = "activity-proof-store-a"
		const storeB = "activity-proof-store-b"
		if _, err := db.ExecContext(ctx, `INSERT INTO dsh.commerce_verticals(id,name_ar,name_en) VALUES($1,'Activity Test','Activity Test')`, verticalID); err != nil {
			t.Fatal(err)
		}
		if _, err := db.ExecContext(ctx, `INSERT INTO dsh.catalog_categories(id,vertical_id,name_ar,name_en,active) VALUES($1,$2,'Activity Test','Activity Test',true)`, categoryID, verticalID); err != nil {
			t.Fatal(err)
		}
		if _, err := db.ExecContext(ctx, `INSERT INTO dsh.service_cities(id,display_name_ar,active) VALUES('activity-proof-city','Activity Test',true)`); err != nil {
			t.Fatal(err)
		}
		insertCanonicalStoreFixture(t, ctx, db, canonicalStoreFixture{ID: storeA, PartnerActorID: "activity-proof-owner-a", Name: "Activity A", ServiceCityID: "activity-proof-city", PrimaryVerticalID: verticalID, PublicationState: "published"})
		insertCanonicalStoreFixture(t, ctx, db, canonicalStoreFixture{ID: storeB, PartnerActorID: "activity-proof-owner-b", Name: "Activity B", ServiceCityID: "activity-proof-city", PrimaryVerticalID: verticalID, PublicationState: "published"})

		createProduct := func(id, name string) postgres.CatalogProductResult {
			t.Helper()
			input := postgres.CatalogProductInput{
				VerticalID: verticalID, Scope: "SHARED", CanonicalName: name,
				VariantTitle: "Default", MeasurementKind: "DISCRETE", BaseUnit: "COUNT", CategoryIDs: []string{categoryID},
			}
			result, err := postgres.CreateCatalogProduct(ctx, db, input, id+"-create", postgres.HashCatalogProductCreateRequest(input), "activity-proof-operator", id+"-correlation")
			if err != nil {
				t.Fatalf("create canonical product: %v", err)
			}
			return result
		}
		createOffer := func(storeID, actor string, variant postgres.CatalogVariantRecord) {
			t.Helper()
			input := postgres.CatalogOfferInput{
				StoreID: storeID, VariantID: variant.ID, PriceMinor: 350,
				QuantityPolicy: "DISCRETE", QuantityMinBaseUnits: 1, QuantityMaxBaseUnits: 5,
				QuantityStepBaseUnits: 1, PricingBasis: "PER_UNIT", PricingUnitBaseUnits: 1,
				InventoryPolicy: "AVAILABILITY_ONLY",
			}
			_, err := postgres.CreateCatalogOffer(ctx, db, input,
				actor+"-"+variant.ID+"-create", postgres.HashCatalogOfferCreateRequest(input), actor,
				actor+"-"+variant.ID+"-correlation")
			if err != nil {
				t.Fatalf("create canonical offer: %v", err)
			}
		}
		p1 := createProduct("activity-proof-one", "Activity First Product")
		p2 := createProduct("activity-proof-two", "Activity Second Product")
		createOffer(storeA, "activity-proof-owner-a", p1.Product.Variants[0])
		createOffer(storeB, "activity-proof-owner-b", p1.Product.Variants[0])
		createOffer(storeA, "activity-proof-owner-a", p2.Product.Variants[0])

		filterA := postgres.CatalogActivityFilter{StoreID: storeA, Kind: "offer", Limit: 1}
		seen := map[string]bool{}
		for pageNumber := 0; pageNumber < 3; pageNumber++ {
			page, err := postgres.ListCatalogActivity(ctx, db, filterA)
			if err != nil {
				t.Fatalf("Store A page %d: %v", pageNumber, err)
			}
			if len(page.Items) != 1 {
				t.Fatalf("Store A page %d unexpected items: %+v", pageNumber, page)
			}
			item := page.Items[0]
			if item.StoreID != storeA || item.Kind != "offer" || item.Action != "created" || seen[item.ID] {
				t.Fatalf("Store A leaked another Store/Product or repeated an event: %+v", item)
			}
			seen[item.ID] = true
			if pageNumber == 0 {
				if page.NextCursor == "" {
					t.Fatal("Store A first page lacks continuation")
				}
				// Cursor from Store A must be rejected for Store B.
				foreign := postgres.CatalogActivityFilter{StoreID: storeB, Kind: "offer", Limit: 1, Cursor: page.NextCursor}
				if _, err := postgres.ListCatalogActivity(ctx, db, foreign); !errors.Is(err, postgres.ErrCatalogActivityFilter) {
					t.Fatalf("Store A cursor reused for Store B: %v", err)
				}
			}
			filterA.Cursor = page.NextCursor
			if filterA.Cursor == "" {
				break
			}
		}
		if len(seen) != 2 {
			t.Fatalf("Store A expected two distinct Offer audit events, got %d", len(seen))
		}
		pageB, err := postgres.ListCatalogActivity(ctx, db, postgres.CatalogActivityFilter{StoreID: storeB, Kind: "offer", Limit: 20})
		if err != nil || len(pageB.Items) != 1 || pageB.Items[0].StoreID != storeB || pageB.NextCursor != "" {
			t.Fatalf("Store B must see exactly its own single Offer: %+v err=%v", pageB, err)
		}
		productOnly, err := postgres.ListCatalogActivity(ctx, db, postgres.CatalogActivityFilter{Kind: "product", Action: "created", Limit: 20})
		if err != nil || len(productOnly.Items) != 2 {
			t.Fatalf("Operator Product activity filter failed: %+v err=%v", productOnly, err)
		}
		storeProducts, err := postgres.ListCatalogActivity(ctx, db, postgres.CatalogActivityFilter{StoreID: storeA, Kind: "product", Limit: 20})
		if err != nil || len(storeProducts.Items) != 0 {
			t.Fatalf("Store-scoped query exposed shared Product audit: %+v err=%v", storeProducts, err)
		}
	})
}
