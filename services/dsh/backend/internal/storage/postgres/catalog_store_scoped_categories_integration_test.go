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

// Real DSH writer -> PostgreSQL publication view -> customer catalog filter.
// Runs only with a disposable PostgreSQL root DSN; withFreshDatabase creates
// and drops its own dedicated database, never writes to the original database.
func TestStoreScopedCategoriesFreshEndToEnd(t *testing.T) {
	uri := strings.TrimSpace(os.Getenv("DSH_DATABASE_URL"))
	if uri == "" {
		t.Skip("isolated DSH_DATABASE_URL required")
	}
	root, err := sql.Open("postgres", uri)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = root.Close() })
	withFreshDatabase(t, root, uri, func(ctx context.Context, db *sql.DB, records []postgres.MigrationRecord, sqls []string) {
		if err := postgres.Migrate(ctx, db, records, sqls, testDeliveryProofKeyring(t)); err != nil {
			t.Fatal(err)
		}
		if err := postgres.VerifySchema(ctx, db, records); err != nil {
			t.Fatal(err)
		}
		if _, err := db.ExecContext(ctx, "INSERT INTO dsh.service_cities(id,display_name_ar,active) VALUES('g007-city','صنعاء اختبار',true)"); err != nil {
			t.Fatal(err)
		}
		insertCanonicalStoreFixture(t, ctx, db, canonicalStoreFixture{ID: "g007-store", PartnerActorID: "g007-owner", Name: "متجر الفئات", ServiceCityID: "g007-city", PublicationState: "published"})
		insertCanonicalStoreFixture(t, ctx, db, canonicalStoreFixture{ID: "g007-other-store", PartnerActorID: "g007-other-owner", Name: "متجر منفصل", ServiceCityID: "g007-city", PublicationState: "published"})
		vertical := "g007-store-vertical"
		otherVertical := "g007-other-store-vertical"
		if _, err := db.ExecContext(ctx, `INSERT INTO dsh.catalog_categories(id,vertical_id,name_ar,name_en,active) VALUES
   ('g007-category',$1,'فئة أولى','Category One',true),
   ('g007-inactive',$1,'فئة غير نشطة','Inactive Category',false),
   ('g007-wrong',$2,'فئة أخرى','Other Vertical',true)`, vertical, otherVertical); err != nil {
			t.Fatal(err)
		}
		create := func(name, store string, categories []string, key string) (postgres.CatalogProductResult, error) {
			input := postgres.CatalogProductInput{VerticalID: vertical, Scope: "STORE_SCOPED", StoreID: store, CanonicalName: name, VariantTitle: "عادي", MeasurementKind: "DISCRETE", BaseUnit: "COUNT", CategoryIDs: categories}
			return postgres.CreateCatalogProduct(ctx, db, input, key, postgres.HashCatalogProductCreateRequest(input), "g007-owner", "g007-correlation")
		}
		if _, err := create("منتج خارج فئته", "g007-store", []string{"g007-wrong"}, "g007-invalid-vertical"); !errors.Is(err, postgres.ErrCatalogCategoryNotFound) {
			t.Fatalf("wrong-vertical category accepted: %v", err)
		}
		if _, err := create("منتج بفئة غير نشطة", "g007-store", []string{"g007-inactive"}, "g007-inactive-category"); !errors.Is(err, postgres.ErrCatalogCategoryNotFound) {
			t.Fatalf("inactive category accepted: %v", err)
		}
		if _, err := create("منتج متجر آخر", "g007-other-store", []string{"g007-category"}, "g007-cross-store"); !errors.Is(err, postgres.ErrCatalogProductOwnership) {
			t.Fatalf("cross-store/vertical mismatch accepted: %v", err)
		}
		created, err := create("منتج محلي دون فئة", "g007-store", nil, "g007-created")
		if err != nil {
			t.Fatal(err)
		}
		if len(created.Product.CategoryIDs) != 0 {
			t.Fatal("uncategorized Product must stay valid")
		}
		variant := created.Product.Variants[0]
		offerInput := postgres.CatalogOfferInput{StoreID: "g007-store", VariantID: variant.ID, PriceMinor: 350, QuantityPolicy: "DISCRETE", QuantityMinBaseUnits: 1, QuantityMaxBaseUnits: 5, QuantityStepBaseUnits: 1, PricingBasis: "PER_UNIT", PricingUnitBaseUnits: 1, InventoryPolicy: "AVAILABILITY_ONLY"}
		offer, err := postgres.CreateCatalogOffer(ctx, db, offerInput, "g007-offer", postgres.HashCatalogOfferCreateRequest(offerInput), "g007-owner", "g007-correlation")
		if err != nil {
			t.Fatal(err)
		}
		if _, err := db.ExecContext(ctx, "UPDATE dsh.catalog_store_offers SET publication_state='published',availability=true WHERE id=$1", offer.Offer.ID); err != nil {
			t.Fatal(err)
		}
		visible := func(want bool) {
			t.Helper()
			var got bool
			if err := db.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM dsh.catalog_customer_visible_offers WHERE offer_id=$1)", offer.Offer.ID).Scan(&got); err != nil {
				t.Fatal(err)
			}
			if got != want {
				t.Fatalf("customer visibility=%v expected=%v", got, want)
			}
		}
		visible(true)
		update := postgres.CatalogProductUpdateInput{VerticalID: vertical, Scope: "STORE_SCOPED", StoreID: "g007-store", CanonicalName: created.Product.CanonicalName, Description: "", Active: true, CategoryIDs: []string{"g007-category"}}
		updated, err := postgres.UpdateCatalogProduct(ctx, db, created.Product.ID, update, created.Product.Version, "g007-update", postgres.HashCatalogProductUpdateRequest(created.Product.ID, update, created.Product.Version), "g007-owner", "g007-correlation")
		if err != nil {
			t.Fatal(err)
		}
		if len(updated.Product.CategoryIDs) != 1 || updated.Product.CategoryIDs[0] != "g007-category" {
			t.Fatalf("category missing from product readback: %+v", updated.Product.CategoryIDs)
		}
		visible(true)
		filtered, err := postgres.ReadPublicCatalog(ctx, db, "g007-store", "g007-city", "g007-category", "", "", 20, "")
		if err != nil {
			t.Fatal(err)
		}
		found := false
		for _, item := range filtered.Offers {
			if item.ID == offer.Offer.ID {
				found = true
			}
		}
		if !found {
			t.Fatal("categorised Store-scoped offer missing from customer category results")
		}
		replay, replayErr := postgres.UpdateCatalogProduct(ctx, db, created.Product.ID, update, created.Product.Version, "g007-update", postgres.HashCatalogProductUpdateRequest(created.Product.ID, update, created.Product.Version), "g007-owner", "g007-retry")
		if replayErr != nil || !replay.Replayed || replay.Product.ID != created.Product.ID {
			t.Fatalf("idempotent edit replay failed: %+v %v", replay, replayErr)
		}
		if _, err := db.ExecContext(ctx, "UPDATE dsh.catalog_categories SET active=false WHERE id='g007-category'"); err != nil {
			t.Fatal(err)
		}
		visible(false)
		t.Log("G007 fresh v140 writer, cross-vertical/inactive validation, idempotent edit, public category filter and publication guard PASS")
	})
}
