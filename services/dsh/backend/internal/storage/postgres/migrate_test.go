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

func assertRequiredMigrationOrder(t *testing.T, records []postgres.MigrationRecord, required ...string) {
	t.Helper()
	lastIndex := -1
	for _, name := range required {
		foundIndex := -1
		for index, record := range records {
			if record.Name == name {
				foundIndex = index
				break
			}
		}
		if foundIndex <= lastIndex {
			t.Fatalf("required DSH migration is missing or out of order: %s", name)
		}
		lastIndex = foundIndex
	}
}

func TestCanonicalMigrationGraphMatchesSchemaVersion(t *testing.T) {
	migrationDirectory := filepath.Join("..", "..", "..", "..", "database", "migrations")
	records, migrationSQL, err := postgres.LoadMigrations(migrationDirectory)
	if err != nil {
		t.Fatalf("load DSH canonical migrations: %v", err)
	}
	if len(records) != postgres.SchemaVersion || len(migrationSQL) != postgres.SchemaVersion {
		t.Fatalf("unexpected DSH migration graph size: records=%d sql=%d schema=%d", len(records), len(migrationSQL), postgres.SchemaVersion)
	}
	last := records[len(records)-1]
	if last.Version != postgres.SchemaVersion || last.Name != "065_marketing_operational_registries.sql" {
		t.Fatalf("last DSH migration = v%d %q; want v%d 065_marketing_operational_registries.sql", last.Version, last.Name, postgres.SchemaVersion)
	}
	if !strings.Contains(migrationSQL[len(migrationSQL)-2], "fulfillment_mode IN ('PARTNER_CAPTAIN', 'CUSTOMER_PICKUP') AND payment_method = 'CASH_AT_STORE'") {
		t.Fatal("DSH migration 064 does not bind partner-captain fulfillment to cash at store")
	}
	if !strings.Contains(migrationSQL[len(migrationSQL)-1], "commerce_promotions_starts_registry_idx") || !strings.Contains(migrationSQL[len(migrationSQL)-1], "discovery_content_created_registry_idx") {
		t.Fatal("latest DSH migration is missing marketing registry indexes")
	}
}

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
		assertRequiredMigrationOrder(t, records,
			"018_remove_unjustified_captain_terminated_state.sql",
			"019_captain_delivery_recovery.sql",
			"020_field_standing_admission_and_joining_scope.sql",
		)
		if err := postgres.Migrate(ctx, db, records, migrationSQL, testDeliveryProofKeyring(t)); err != nil {
			t.Fatalf("apply fresh DSH migrations: %v", err)
		}
		if err := postgres.VerifySchema(ctx, db, records); err != nil {
			t.Fatalf("verify fresh DSH schema: %v", err)
		}
		if err := postgres.Migrate(ctx, db, records, migrationSQL, testDeliveryProofKeyring(t)); err != nil {
			t.Fatalf("rerun DSH migrations with matching checksums: %v", err)
		}
		for _, table := range []string{"central_products", "central_product_mutation_idempotency", "central_product_audit", "store_assortments", "store_assortment_mutation_idempotency", "store_assortment_audit"} {
			var absent bool
			if err := db.QueryRowContext(ctx, "SELECT to_regclass($1) IS NULL", "dsh."+table).Scan(&absent); err != nil || !absent {
				t.Fatalf("legacy catalog relation remains after cutover: %s err=%v", table, err)
			}
		}

		createdCity, err := postgres.CreateServiceCity(ctx, db, "صنعاء", true, "idem-city-catalog-v1", postgres.HashServiceCityCreateRequest("صنعاء", true), testOperatorActorID, "corr-city-catalog-v1")
		if err != nil {
			t.Fatalf("create service city: %v", err)
		}
		vertical := postgres.CommerceVerticalRecord{NameAr: "بقالة", NameEn: "Grocery", Active: true}
		verticalAudit := postgres.CatalogRegistryAuditInput{ActingActorID: testOperatorActorID, CorrelationID: "corr-vertical-v1", Reason: "Initial catalog vertical"}
		createdVertical, err := postgres.CreateCommerceVertical(ctx, db, vertical, "idem-vertical-v1", postgres.HashCatalogVerticalCreateRequest(vertical, verticalAudit.Reason), verticalAudit)
		if err != nil || !strings.HasPrefix(createdVertical.Vertical.ID, "vertical_") || createdVertical.Vertical.Version != 1 {
			t.Fatalf("create commerce vertical: %+v err=%v", createdVertical, err)
		}
		vertical.ID = createdVertical.Vertical.ID
		category := postgres.CatalogCategoryRecord{VerticalID: vertical.ID, NameAr: "قهوة", NameEn: "Coffee", Active: true}
		categoryAudit := postgres.CatalogRegistryAuditInput{ActingActorID: testOperatorActorID, CorrelationID: "corr-category-v1", Reason: "Initial catalog category"}
		createdCategory, err := postgres.CreateCatalogCategory(ctx, db, category, "idem-category-v1", postgres.HashCatalogCategoryCreateRequest(category, categoryAudit.Reason), categoryAudit)
		if err != nil || !strings.HasPrefix(createdCategory.ID, "category_") {
			t.Fatalf("create catalog category: %v", err)
		}
		category.ID = createdCategory.ID
		childCategory := postgres.CatalogCategoryRecord{VerticalID: vertical.ID, ParentCategoryID: category.ID, NameAr: "قهوة مختصة", NameEn: "Specialty Coffee", Active: true}
		childAudit := postgres.CatalogRegistryAuditInput{ActingActorID: testOperatorActorID, CorrelationID: "corr-category-child-v1", Reason: "Add specialty coffee child category"}
		createdChild, err := postgres.CreateCatalogCategory(ctx, db, childCategory, "idem-category-child-v1", postgres.HashCatalogCategoryCreateRequest(childCategory, childAudit.Reason), childAudit)
		if err != nil {
			t.Fatalf("create child catalog category: %v", err)
		}
		cycleUpdate := postgres.UpdateCatalogCategoryInput{ParentCategoryID: createdChild.ID, NameAr: category.NameAr, NameEn: category.NameEn, Active: category.Active, ExpectedVersion: category.Version}
		cycleReason := "Reject category cycle"
		cycleAudit := postgres.CatalogRegistryAuditInput{ActingActorID: testOperatorActorID, CorrelationID: "corr-category-cycle-v1", Reason: cycleReason}
		if _, _, err := postgres.UpdateCatalogCategory(ctx, db, category.ID, cycleUpdate, "idem-category-cycle-v1", postgres.HashCatalogCategoryUpdateRequest(category.ID, cycleUpdate, cycleReason), cycleAudit); !errors.Is(err, postgres.ErrCatalogCategoryCycle) {
			t.Fatalf("expected category cycle rejection, got %v", err)
		}
		attributeInput := postgres.CatalogAttributeDefinitionInput{ID: "coffee_origin", VerticalID: vertical.ID, Code: "origin", NameAr: "بلد المنشأ", ValueKind: "TEXT", Active: true}
		if _, _, err := postgres.CreateCatalogAttributeDefinition(ctx, db, attributeInput, "idem-attribute-origin-v1", postgres.HashCatalogAttributeDefinitionRequest(attributeInput)); err != nil {
			t.Fatalf("create catalog attribute definition: %v", err)
		}
		rule := postgres.CatalogAttributeRuleRecord{CategoryID: category.ID, AttributeID: attributeInput.ID}
		ruleAudit := postgres.CatalogRegistryAuditInput{ActingActorID: testOperatorActorID, CorrelationID: "corr-rule-origin-v1", Reason: "Establish origin attribute rule"}
		ruleHash := postgres.HashCatalogCategoryAttributeRuleRequest(rule, 0, ruleAudit.Reason)
		if err := postgres.UpsertCatalogCategoryAttributeRule(ctx, db, rule, 0, "idem-rule-origin-v1", ruleHash, ruleAudit); err != nil {
			t.Fatalf("create category attribute rule: %v", err)
		}
		if err := postgres.UpsertCatalogCategoryAttributeRule(ctx, db, postgres.CatalogAttributeRuleRecord{CategoryID: category.ID, AttributeID: attributeInput.ID, Required: true}, 0, "idem-rule-origin-stale-v1", postgres.HashCatalogCategoryAttributeRuleRequest(postgres.CatalogAttributeRuleRecord{CategoryID: category.ID, AttributeID: attributeInput.ID, Required: true}, 0, "Stale rule update"), postgres.CatalogRegistryAuditInput{ActingActorID: testOperatorActorID, CorrelationID: "corr-rule-origin-stale-v1", Reason: "Stale rule update"}); !errors.Is(err, postgres.ErrCatalogVersionConflict) {
			t.Fatalf("expected stale category attribute rule rejection, got %v", err)
		}
		var auditCount int
		if err := db.QueryRowContext(ctx, "SELECT count(*) FROM dsh.catalog_registry_audit_events WHERE entity_type IN ('vertical','category','attribute_rule') AND acting_actor_id=$1", testOperatorActorID).Scan(&auditCount); err != nil || auditCount != 4 {
			t.Fatalf("catalog registry audit readback count=%d err=%v", auditCount, err)
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

		if _, err := db.ExecContext(ctx, `INSERT INTO dsh.stores(id,partner_actor_id,name,service_city_id,primary_vertical_id,publication_state,publication_changed_at) VALUES('store_catalog_v1',$1,'متجر القهوة',$2,$3,'published',clock_timestamp())`, testPartnerActorID, createdCity.City.ID, vertical.ID); err != nil {
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
