package postgres_test

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	_ "github.com/lib/pq"
)

const (
	testPartnerActorID  = "act_partner_catalog_v1"
	testOperatorActorID = "act_operator_catalog_v1"
)

func TestFreshCatalogRefoundationIntegrity(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("DSH_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("DSH_DATABASE_URL is required for the fresh DSH proof")
	}
	rootDB, err := sql.Open("postgres", databaseURL)
	if err != nil {
		t.Fatalf("open postgres: %v", err)
	}
	t.Cleanup(func() { _ = rootDB.Close() })
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := rootDB.PingContext(ctx); err != nil {
		t.Fatalf("configured postgres is not reachable: %v", err)
	}

	withFreshDatabase(t, rootDB, databaseURL, func(ctx context.Context, db *sql.DB, records []postgres.MigrationRecord, migrationSQL []string) {
		if len(records) != postgres.SchemaVersion || len(migrationSQL) != postgres.SchemaVersion {
			t.Fatalf("unexpected DSH migration graph size: records=%d sql=%d", len(records), len(migrationSQL))
		}
		if records[len(records)-1].Name != "018_remove_unjustified_captain_terminated_state.sql" {
			t.Fatalf("captain dispatch is not the canonical final migration: %s", records[len(records)-1].Name)
		}
		if err := postgres.Migrate(ctx, db, records, migrationSQL); err != nil {
			t.Fatalf("apply fresh DSH migrations: %v", err)
		}
		if err := postgres.VerifySchema(ctx, db, records); err != nil {
			t.Fatalf("verify fresh DSH schema: %v", err)
		}
		if err := postgres.Migrate(ctx, db, records, migrationSQL); err != nil {
			t.Fatalf("rerun DSH migrations with matching checksums: %v", err)
		}
		for _, table := range []string{"central_products", "central_product_mutation_idempotency", "central_product_audit", "store_assortments", "store_assortment_mutation_idempotency", "store_assortment_audit"} {
			var absent bool
			if err := db.QueryRowContext(ctx, "SELECT to_regclass($1) IS NULL", "dsh."+table).Scan(&absent); err != nil || !absent {
				t.Fatalf("legacy catalog relation remains after cutover: %s err=%v", table, err)
			}
		}

		if _, err := postgres.CreateServiceCity(ctx, db, "sanaa", "صنعاء", true, "idem-city-catalog-v1", postgres.HashServiceCityCreateRequest("sanaa", "صنعاء", true), testOperatorActorID, "corr-city-catalog-v1"); err != nil {
			t.Fatalf("create service city: %v", err)
		}
		vertical := postgres.CommerceVerticalRecord{ID: "grocery", NameAr: "بقالة", NameEn: "Grocery", Active: true}
		createdVertical, err := postgres.CreateCommerceVertical(ctx, db, vertical, "idem-vertical-v1", postgres.HashCatalogVerticalCreateRequest(vertical))
		if err != nil || createdVertical.Vertical.ID != vertical.ID || createdVertical.Vertical.Version != 1 {
			t.Fatalf("create commerce vertical: %+v err=%v", createdVertical, err)
		}
		category := postgres.CatalogCategoryRecord{ID: "coffee", VerticalID: vertical.ID, NameAr: "قهوة", NameEn: "Coffee", Active: true}
		if _, err := postgres.CreateCatalogCategory(ctx, db, category, "idem-category-v1", postgres.HashCatalogCategoryCreateRequest(category)); err != nil {
			t.Fatalf("create catalog category: %v", err)
		}
		productInput := postgres.CatalogProductInput{VerticalID: vertical.ID, Scope: "SHARED", CanonicalName: "قهوة عربية", MeasurementKind: "DISCRETE", BaseUnit: "COUNT", VariantTitle: "عبوة 250 غ", CategoryIDs: []string{category.ID}, IdentifierType: "GTIN", IdentifierValue: "6281000000001", ImageURI: "https://example.com/coffee.jpg"}
		createdProduct, err := postgres.CreateCatalogProduct(ctx, db, productInput, "idem-product-v1", postgres.HashCatalogProductCreateRequest(productInput), testOperatorActorID, "corr-product-v1")
		if err != nil || createdProduct.Product.ID == "" || createdProduct.Product.Version != 1 {
			t.Fatalf("create catalog product: %+v err=%v", createdProduct, err)
		}
		product, err := postgres.ReadCatalogProduct(ctx, db, createdProduct.Product.ID)
		if err != nil || len(product.Variants) != 1 || len(product.Variants[0].Identifiers) != 1 || len(product.CategoryIDs) != 1 || len(product.Media) != 1 {
			t.Fatalf("catalog product canonical readback incomplete: %+v err=%v", product, err)
		}
		replay, err := postgres.CreateCatalogProduct(ctx, db, productInput, "idem-product-v1", postgres.HashCatalogProductCreateRequest(productInput), testOperatorActorID, "corr-product-replay-v1")
		if err != nil || !replay.Replayed || replay.Product.ID != product.ID {
			t.Fatalf("catalog product idempotent replay failed: %+v err=%v", replay, err)
		}
		duplicateInput := productInput
		duplicateInput.CanonicalName = "شاي"
		if _, err := postgres.CreateCatalogProduct(ctx, db, duplicateInput, "idem-product-duplicate-v1", postgres.HashCatalogProductCreateRequest(duplicateInput), testOperatorActorID, "corr-product-duplicate-v1"); !errors.Is(err, postgres.ErrCatalogDuplicateIdentifier) {
			t.Fatalf("expected duplicate identifier rejection, got %v", err)
		}

		if _, err := db.ExecContext(ctx, `INSERT INTO dsh.stores(id,partner_actor_id,name,service_city_id,primary_vertical_id,publication_state,publication_changed_at) VALUES('store_catalog_v1',$1,'متجر القهوة','sanaa','grocery','published',clock_timestamp())`, testPartnerActorID); err != nil {
			t.Fatalf("create catalog test store: %v", err)
		}
		variantID := product.Variants[0].ID
		offerInput := postgres.CatalogOfferInput{StoreID: "store_catalog_v1", VariantID: variantID, PriceMinor: 1250, QuantityPolicy: "DISCRETE", QuantityMinBaseUnits: 1, QuantityMaxBaseUnits: 10, QuantityStepBaseUnits: 1, PricingBasis: "PER_UNIT", PricingUnitBaseUnits: 1}
		offer, err := postgres.CreateCatalogOffer(ctx, db, offerInput, "idem-offer-v1", postgres.HashCatalogOfferCreateRequest(offerInput), testPartnerActorID, "corr-offer-v1")
		if err != nil || offer.Offer.PublicationState != "draft" || offer.Offer.Version != 1 {
			t.Fatalf("create store offer: %+v err=%v", offer, err)
		}
		if _, err := postgres.CreateCatalogOffer(ctx, db, offerInput, "idem-offer-v1", postgres.HashCatalogOfferCreateRequest(offerInput), testPartnerActorID, "corr-offer-replay-v1"); err != nil {
			t.Fatalf("store offer replay: %v", err)
		}
		offerUpdate := postgres.CatalogOfferUpdateInput{PriceMinor: 1250, Availability: true, PublicationState: "published", QuantityPolicy: "DISCRETE", QuantityMinBaseUnits: 1, QuantityMaxBaseUnits: 10, QuantityStepBaseUnits: 1, PricingBasis: "PER_UNIT", PricingUnitBaseUnits: 1}
		if _, err := postgres.UpdateCatalogOffer(ctx, db, offer.Offer.ID, offerUpdate, 9, "idem-offer-stale-v1", postgres.HashCatalogOfferUpdateRequest(offer.Offer.ID, offerUpdate, 9), testPartnerActorID, "corr-offer-stale-v1"); !errors.Is(err, postgres.ErrCatalogVersionConflict) {
			t.Fatalf("expected stale offer version rejection, got %v", err)
		}
		published, err := postgres.UpdateCatalogOffer(ctx, db, offer.Offer.ID, offerUpdate, 1, "idem-offer-publish-v1", postgres.HashCatalogOfferUpdateRequest(offer.Offer.ID, offerUpdate, 1), testPartnerActorID, "corr-offer-publish-v1")
		if err != nil || published.Offer.PublicationState != "published" || published.Offer.Version != 2 {
			t.Fatalf("publish store offer: %+v err=%v", published, err)
		}
		ready, err := postgres.HasPublishableCatalog(ctx, db, "store_catalog_v1")
		if err != nil || !ready {
			t.Fatalf("publishable catalog readback failed: ready=%v err=%v", ready, err)
		}
		publicOffers, err := postgres.ListCatalogOffers(ctx, db, "store_catalog_v1", true)
		if err != nil || len(publicOffers) != 1 || publicOffers[0].VariantID != variantID || publicOffers[0].Product.ID != product.ID {
			t.Fatalf("customer-visible offer readback failed: %+v err=%v", publicOffers, err)
		}
	})
}

func withFreshDatabase(t *testing.T, rootDB *sql.DB, databaseURL string, test func(context.Context, *sql.DB, []postgres.MigrationRecord, []string)) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	databaseName := fmt.Sprintf("dsh_catalog_test_%d", time.Now().UnixNano())
	if _, err := rootDB.ExecContext(ctx, "CREATE DATABASE "+databaseName); err != nil {
		t.Fatalf("create isolated DSH database: %v", err)
	}
	t.Cleanup(func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cleanupCancel()
		if _, err := rootDB.ExecContext(cleanupCtx, "DROP DATABASE IF EXISTS "+databaseName+" WITH (FORCE)"); err != nil {
			t.Errorf("drop isolated DSH database: %v", err)
		}
	})
	parsedURL, err := url.Parse(databaseURL)
	if err != nil {
		t.Fatalf("parse DSH database URL: %v", err)
	}
	parsedURL.Path = "/" + databaseName
	testDB, err := sql.Open("postgres", parsedURL.String())
	if err != nil {
		t.Fatalf("open isolated DSH database: %v", err)
	}
	t.Cleanup(func() { _ = testDB.Close() })
	if err := testDB.PingContext(ctx); err != nil {
		t.Fatalf("isolated DSH database is not reachable: %v", err)
	}
	migrationDirectory := filepath.Join("..", "..", "..", "..", "database", "migrations")
	records, migrationSQL, err := postgres.LoadMigrations(migrationDirectory)
	if err != nil {
		t.Fatalf("load DSH canonical migrations from %s: %v", migrationDirectory, err)
	}
	test(ctx, testDB, records, migrationSQL)
}
