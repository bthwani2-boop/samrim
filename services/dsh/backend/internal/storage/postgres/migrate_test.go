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
	if last.Version != postgres.SchemaVersion || last.Name != "084_store_type_commission_owns_rate.sql" {
		t.Fatalf("last DSH migration = v%d %q; want v%d 084_store_type_commission_owns_rate.sql", last.Version, last.Name, postgres.SchemaVersion)
	}
	migrationByName := make(map[string]string, len(records))
	for index, record := range records {
		migrationByName[record.Name] = migrationSQL[index]
	}
	if !strings.Contains(migrationByName["064_partner_captain_cash_at_store_payment.sql"], "fulfillment_mode IN ('PARTNER_CAPTAIN', 'CUSTOMER_PICKUP') AND payment_method = 'CASH_AT_STORE'") {
		t.Fatal("DSH migration 064 does not bind partner-captain fulfillment to cash at store")
	}
	if !strings.Contains(migrationByName["065_marketing_operational_registries.sql"], "commerce_promotions_starts_registry_idx") || !strings.Contains(migrationByName["065_marketing_operational_registries.sql"], "discovery_content_created_registry_idx") {
		t.Fatal("DSH migration 065 is missing marketing registry indexes")
	}
	if !strings.Contains(migrationByName["066_catalog_category_media.sql"], "catalog_category_media_assets_active_uq") || !strings.Contains(migrationByName["066_catalog_category_media.sql"], "ADD COLUMN image_uri text") {
		t.Fatal("DSH migration 066 is missing category media ownership schema")
	}
	if !strings.Contains(migrationByName["067_store_profile_media_cleanup.sql"], "ADD COLUMN cleaned_at timestamptz") || !strings.Contains(migrationByName["067_store_profile_media_cleanup.sql"], "store_profile_media_cleaned_at_chk") || !strings.Contains(migrationByName["067_store_profile_media_cleanup.sql"], "cleanup_claimed_at") || !strings.Contains(migrationByName["067_store_profile_media_cleanup.sql"], "last_attempt_at") || !strings.Contains(migrationByName["067_store_profile_media_cleanup.sql"], "last_upload_error") {
		t.Fatal("DSH migration 067 is missing store profile media cleanup state")
	}
	mediaProvenanceMigration := migrationByName["072_store_profile_media_provenance.sql"]
	if !strings.Contains(mediaProvenanceMigration, "rights_attested_by_actor_id") || !strings.Contains(mediaProvenanceMigration, "rights_attested_at") || !strings.Contains(mediaProvenanceMigration, "store_profile_media_provenance_chk") || !strings.Contains(mediaProvenanceMigration, "SET state = 'retired', retired_at = clock_timestamp()") {
		t.Fatal("DSH migration 072 is missing attributed media provenance or retirement of unverified legacy images")
	}
	productMediaReferenceMigration := migrationByName["073_catalog_media_asset_references.sql"]
	for _, required := range []string{"SET media_asset_id = asset.id", "WHERE media_asset_id IS NULL", "state = 'retired'", "DROP COLUMN uri", "FOREIGN KEY (product_id, media_asset_id)", "UNIQUE (product_id, media_asset_id)", "DROP COLUMN proposed_image_uri"} {
		if !strings.Contains(productMediaReferenceMigration, required) {
			t.Fatalf("DSH migration 073 is missing the product media asset cutover step: %s", required)
		}
	}
	catalogMediaProvenanceMigration := migrationByName["074_catalog_media_provenance.sql"]
	for _, required := range []string{"DROP COLUMN image_uri", "TRUNCATE TABLE dsh.catalog_media", "request_hash", "rights_attested_by_actor_id", "rights_attested_at", "catalog_media_assets_provenance_chk", "catalog_category_media_assets_provenance_chk"} {
		if !strings.Contains(catalogMediaProvenanceMigration, required) {
			t.Fatalf("DSH migration 074 is missing catalog media provenance cutover: %s", required)
		}
	}
	discoveryContentMediaMigration := migrationByName["075_discovery_content_media_assets.sql"]
	for _, required := range []string{"DROP COLUMN media_uri", "media_asset_id", "discovery_content_media_assets", "rights_attested_by_actor_id", "discovery_content_published_media_chk", "state = 'PAUSED'"} {
		if !strings.Contains(discoveryContentMediaMigration, required) {
			t.Fatalf("DSH migration 075 is missing discovery content media ownership cutover: %s", required)
		}
	}
	paymentCashSnapshotMigration := migrationByName["076_payment_cash_amount_snapshot.sql"]
	for _, required := range []string{"ADD COLUMN payment_cash_amount_minor bigint", "SET payment_cash_amount_minor = total_amount_minor", "payment_cash_amount_minor <= total_amount_minor"} {
		if !strings.Contains(paymentCashSnapshotMigration, required) {
			t.Fatalf("DSH migration 076 is missing payment cash snapshot behavior: %s", required)
		}
	}
	balanceOnlyHandoffMigration := migrationByName["077_balance_only_financial_handoffs.sql"]
	for _, required := range []string{"PARTNER_CAPTAIN_BALANCE_SETTLEMENT", "effect_type='DELIVERY_SETTLEMENT' AND amount_minor>=0", "effect_type='STORE_PICKUP_COLLECTION' AND amount_minor>=0"} {
		if !strings.Contains(balanceOnlyHandoffMigration, required) {
			t.Fatalf("DSH migration 077 is missing balance-only settlement behavior: %s", required)
		}
	}
	catalogOfferVisibilityMigration := migrationByName["078_catalog_offer_visibility_views.sql"]
	for _, required := range []string{"CREATE OR REPLACE VIEW dsh.catalog_publishable_offers", "o.quantity_policy<>'VARIABLE_MEASURE'", "CREATE OR REPLACE VIEW dsh.catalog_customer_visible_offers", "s.publication_state='published'"} {
		if !strings.Contains(catalogOfferVisibilityMigration, required) {
			t.Fatalf("DSH migration 078 is missing canonical catalog offer visibility: %s", required)
		}
	}
	assertRequiredMigrationOrder(t, records, "072_store_profile_media_provenance.sql", "073_catalog_media_asset_references.sql", "074_catalog_media_provenance.sql", "075_discovery_content_media_assets.sql", "076_payment_cash_amount_snapshot.sql", "077_balance_only_financial_handoffs.sql", "078_catalog_offer_visibility_views.sql")
	if !strings.Contains(migrationByName["068_field_operator_partner_admission.sql"], "admission_requested") || !strings.Contains(migrationByName["068_field_operator_partner_admission.sql"], "joining_case_admission_requested") || !strings.Contains(migrationByName["068_field_operator_partner_admission.sql"], "field-admission-request") {
		t.Fatal("DSH migration 068 is missing the Field submission and Operator admission state")
	}
	if !strings.Contains(migrationByName["069_catalog_store_offer_paging.sql"], "catalog_store_offers_store_created_registry_idx") || !strings.Contains(migrationByName["069_catalog_store_offer_paging.sql"], "ON dsh.catalog_store_offers (store_id, created_at, id)") {
		t.Fatal("DSH migration 069 is missing the StoreOffer keyset paging index")
	}
	if !strings.Contains(migrationByName["070_public_store_discovery_pagination.sql"], "stores_published_city_created_registry_idx") || !strings.Contains(migrationByName["070_public_store_discovery_pagination.sql"], "stores_published_city_name_search_idx") || !strings.Contains(migrationByName["070_public_store_discovery_pagination.sql"], "gin_trgm_ops") {
		t.Fatal("DSH migration 070 is missing Store discovery search and ordering indexes")
	}
	for _, required := range []string{
		"ADD COLUMN requires_profile_review boolean NOT NULL DEFAULT false",
		"WHERE state IN ('eligible','suspended') AND actor_id IS NOT NULL AND full_name_ar IS NULL",
		"field_admissions_profile_review_chk",
		"captain_admissions_profile_review_chk",
		"field_admission_profile_reviewed",
		"captain_admission_profile_reviewed",
	} {
		if !strings.Contains(migrationByName["071_field_captain_profiles_and_review.sql"], required) {
			t.Fatalf("DSH migration 071 is missing the profile review closure: %s", required)
		}
	}
	dsh071 := migrationByName["071_field_captain_profiles_and_review.sql"]
	for _, pair := range [][2]string{
		{"DROP CONSTRAINT field_admission_idempotency_state_chk", "UPDATE dsh.field_admission_idempotency SET result_state='pending_review'"},
		{"DROP CONSTRAINT captain_admission_idempotency_state_chk", "UPDATE dsh.captain_admission_idempotency SET result_state='pending_review'"},
	} {
		if strings.Index(dsh071, pair[0]) < 0 || strings.Index(dsh071, pair[0]) > strings.Index(dsh071, pair[1]) {
			t.Fatalf("DSH migration 071 must widen the idempotency state constraint before backfill: %s", pair[0])
		}
	}
	for _, preserved := range []string{"'correct'", "'correct_and_resubmit'", "'bind-financial-terms'", "'joining_case_corrected'", "'joining_case_corrected_and_resubmitted'", "'joining_case_financial_terms_bound'", "'joining_case_admission_reopened'"} {
		if !strings.Contains(migrationByName["068_field_operator_partner_admission.sql"], preserved) {
			t.Fatalf("DSH migration 068 dropped existing joining-case constraint value %s", preserved)
		}
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
		var visibilityViews int
		if err := db.QueryRowContext(ctx, `SELECT count(*) FROM pg_views WHERE schemaname='dsh' AND viewname IN ('catalog_publishable_offers','catalog_customer_visible_offers')`).Scan(&visibilityViews); err != nil || visibilityViews != 2 {
			t.Fatalf("catalog offer visibility views are not installed: count=%d err=%v", visibilityViews, err)
		}
		var publishableViewDefinition, customerVisibleViewDefinition string
		if err := db.QueryRowContext(ctx, `SELECT pg_get_viewdef('dsh.catalog_publishable_offers'::regclass,true)`).Scan(&publishableViewDefinition); err != nil {
			t.Fatalf("read canonical catalog publishable-offer view: %v", err)
		}
		for _, required := range []string{"availability = true", "price_minor > 0", "quantity_policy <> 'VARIABLE_MEASURE'", "inventory_policy", "catalog_model", "catalog_category_attribute_rules", "catalog_store_offer_modifier_groups"} {
			if !strings.Contains(publishableViewDefinition, required) {
				t.Fatalf("canonical catalog publishable-offer view omits required condition %q", required)
			}
		}
		if err := db.QueryRowContext(ctx, `SELECT pg_get_viewdef('dsh.catalog_customer_visible_offers'::regclass,true)`).Scan(&customerVisibleViewDefinition); err != nil {
			t.Fatalf("read canonical customer-visible-offer view: %v", err)
		}
		if !strings.Contains(customerVisibleViewDefinition, "publication_state = 'published'") {
			t.Fatal("canonical customer-visible-offer view omits published-store state")
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
		vertical := postgres.CommerceVerticalRecord{NameAr: "بقالة", NameEn: "Grocery", CatalogModel: "SHARED_CATALOG", Active: true}
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
		category.Version = createdCategory.Version
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
		productInput := postgres.CatalogProductInput{VerticalID: vertical.ID, Scope: "SHARED", CanonicalName: "قهوة عربية", MeasurementKind: "DISCRETE", BaseUnit: "COUNT", VariantTitle: "عبوة 250 غ", CategoryIDs: []string{category.ID}, IdentifierType: "GTIN", IdentifierValue: "6281000000001"}
		createdProduct, err := postgres.CreateCatalogProduct(ctx, db, productInput, "idem-product-v1", postgres.HashCatalogProductCreateRequest(productInput), testOperatorActorID, "corr-product-v1")
		if err != nil || createdProduct.Product.ID == "" || createdProduct.Product.Version != 1 {
			t.Fatalf("create catalog product: %+v err=%v", createdProduct, err)
		}
		secondProductInput := productInput
		secondProductInput.CanonicalName = "قهوة مختصة"
		secondProductInput.IdentifierValue = "6281000000002"
		secondProduct, err := postgres.CreateCatalogProduct(ctx, db, secondProductInput, "idem-product-second-v1", postgres.HashCatalogProductCreateRequest(secondProductInput), testOperatorActorID, "corr-product-second-v1")
		if err != nil || secondProduct.Product.ID == "" || secondProduct.Product.ID == createdProduct.Product.ID {
			t.Fatalf("create second catalog product for keyset proof: %+v err=%v", secondProduct, err)
		}
		registryPage, err := postgres.ListCatalogProductRegistry(ctx, db, "", vertical.ID, "", "all", "name_asc", 1, "")
		if err != nil || len(registryPage.Products) != 1 || registryPage.NextCursor == "" {
			t.Fatalf("catalog product registry first page failed: %+v err=%v", registryPage, err)
		}
		registryNextPage, err := postgres.ListCatalogProductRegistry(ctx, db, "", vertical.ID, "", "all", "name_asc", 1, registryPage.NextCursor)
		if err != nil || len(registryNextPage.Products) != 1 || registryNextPage.NextCursor != "" || registryNextPage.Products[0].ID == registryPage.Products[0].ID {
			t.Fatalf("catalog product registry cursor failed: first=%+v second=%+v err=%v", registryPage, registryNextPage, err)
		}
		sharedProductPage, err := postgres.ListCatalogProducts(ctx, db, "", vertical.ID, false, 1, "")
		if err != nil || len(sharedProductPage.Products) != 1 || sharedProductPage.NextCursor == "" {
			t.Fatalf("shared catalog product first page failed: %+v err=%v", sharedProductPage, err)
		}
		sharedProductNextPage, err := postgres.ListCatalogProducts(ctx, db, "", vertical.ID, false, 1, sharedProductPage.NextCursor)
		if err != nil || len(sharedProductNextPage.Products) != 1 || sharedProductNextPage.NextCursor != "" || sharedProductNextPage.Products[0].ID == sharedProductPage.Products[0].ID {
			t.Fatalf("shared catalog product cursor failed: first=%+v second=%+v err=%v", sharedProductPage, sharedProductNextPage, err)
		}
		partnerProductPage, err := postgres.ListCatalogProductsForPartner(ctx, db, "", vertical.ID, testPartnerActorID, 1, "")
		if err != nil || len(partnerProductPage.Products) != 1 || partnerProductPage.NextCursor == "" {
			t.Fatalf("partner shared catalog product first page failed: %+v err=%v", partnerProductPage, err)
		}
		partnerProductNextPage, err := postgres.ListCatalogProductsForPartner(ctx, db, "", vertical.ID, testPartnerActorID, 1, partnerProductPage.NextCursor)
		if err != nil || len(partnerProductNextPage.Products) != 1 || partnerProductNextPage.NextCursor != "" || partnerProductNextPage.Products[0].ID == partnerProductPage.Products[0].ID {
			t.Fatalf("partner shared catalog product cursor failed: first=%+v second=%+v err=%v", partnerProductPage, partnerProductNextPage, err)
		}
		localVertical := postgres.CommerceVerticalRecord{NameAr: "مخبوزات محلية", NameEn: "Local Bakery", CatalogModel: "STORE_LOCAL_CATALOG", Active: true}
		localVerticalAudit := postgres.CatalogRegistryAuditInput{ActingActorID: testOperatorActorID, CorrelationID: "corr-local-vertical-v1", Reason: "Initial local catalog vertical"}
		createdLocalVertical, err := postgres.CreateCommerceVertical(ctx, db, localVertical, "idem-local-vertical-v1", postgres.HashCatalogVerticalCreateRequest(localVertical, localVerticalAudit.Reason), localVerticalAudit)
		if err != nil || createdLocalVertical.Vertical.ID == "" {
			t.Fatalf("create local catalog vertical: %+v err=%v", createdLocalVertical, err)
		}
		localStoreID := "store_catalog_local_v1"
		if _, err := db.ExecContext(ctx, `INSERT INTO dsh.stores(id,partner_actor_id,name,service_city_id,primary_vertical_id,publication_state,publication_changed_at) VALUES($1,$2,'متجر المخبوزات',$3,$4,'published',clock_timestamp())`, localStoreID, testPartnerActorID, createdCity.City.ID, createdLocalVertical.Vertical.ID); err != nil {
			t.Fatalf("create store for local catalog ownership proof: %v", err)
		}
		localProductInput := postgres.CatalogProductInput{VerticalID: createdLocalVertical.Vertical.ID, Scope: "STORE_SCOPED", StoreID: localStoreID, CanonicalName: "خبز محلي", MeasurementKind: "DISCRETE", BaseUnit: "COUNT", VariantTitle: "رغيف"}
		localProduct, err := postgres.CreateCatalogProduct(ctx, db, localProductInput, "idem-local-product-v1", postgres.HashCatalogProductCreateRequest(localProductInput), testOperatorActorID, "corr-local-product-v1")
		if err != nil || localProduct.Product.ID == "" {
			t.Fatalf("create store-scoped catalog product: %+v err=%v", localProduct, err)
		}
		ownedLocalProducts, err := postgres.ListCatalogProductsForPartner(ctx, db, "", createdLocalVertical.Vertical.ID, testPartnerActorID, 10, "")
		if err != nil || len(ownedLocalProducts.Products) != 1 || ownedLocalProducts.Products[0].ID != localProduct.Product.ID {
			t.Fatalf("owning partner cannot read its store-scoped catalog product: %+v err=%v", ownedLocalProducts, err)
		}
		otherPartnerProducts, err := postgres.ListCatalogProductsForPartner(ctx, db, "", createdLocalVertical.Vertical.ID, "partner_not_the_owner", 10, "")
		if err != nil || len(otherPartnerProducts.Products) != 0 {
			t.Fatalf("unrelated partner can read a store-scoped catalog product: %+v err=%v", otherPartnerProducts, err)
		}
		publicLocalProducts, err := postgres.ListCatalogProducts(ctx, db, "", createdLocalVertical.Vertical.ID, false, 10, "")
		if err != nil || len(publicLocalProducts.Products) != 0 {
			t.Fatalf("public catalog list exposed a store-scoped product: %+v err=%v", publicLocalProducts, err)
		}
		product, err := postgres.ReadCatalogProduct(ctx, db, createdProduct.Product.ID)
		if err != nil || len(product.Variants) != 1 || len(product.Variants[0].Identifiers) != 1 || len(product.CategoryIDs) != 1 || len(product.Media) != 0 {
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
		publicCatalog, err := postgres.ReadPublicCatalog(ctx, db, "store_catalog_v1", createdCity.City.ID, "", "", "", 50, "")
		if err != nil || len(publicCatalog.Offers) != 1 || publicCatalog.Offers[0].VariantID != variantID || publicCatalog.Offers[0].Product.ID != product.ID {
			t.Fatalf("customer-visible offer readback failed: %+v err=%v", publicCatalog.Offers, err)
		}
		if _, err := db.ExecContext(ctx, `INSERT INTO dsh.joining_cases(id,contact_phone_e164,business_name,first_store_name,partner_actor_id,state,store_id,origin,financial_profile_state)
			VALUES('joining_store_discovery_v1','+967770001234','مؤسسة القهوة','متجر القهوة',$1,'approved','store_catalog_v1','control_panel','ACTIVE')`, testPartnerActorID); err != nil {
			t.Fatalf("create published store discovery eligibility fixture: %v", err)
		}
		if _, err := db.ExecContext(ctx, `INSERT INTO dsh.stores(id,partner_actor_id,name,service_city_id,primary_vertical_id,publication_state,publication_changed_at)
			VALUES('store_catalog_v2',$1,'متجر القهوة الثاني',$2,$3,'published',clock_timestamp())`, testPartnerActorID, createdCity.City.ID, vertical.ID); err != nil {
			t.Fatalf("create second published store fixture: %v", err)
		}
		secondStoreOfferInput := postgres.CatalogOfferInput{StoreID: "store_catalog_v2", VariantID: variantID, PriceMinor: 1300, QuantityPolicy: "DISCRETE", QuantityMinBaseUnits: 1, QuantityMaxBaseUnits: 10, QuantityStepBaseUnits: 1, PricingBasis: "PER_UNIT", PricingUnitBaseUnits: 1}
		secondStoreOffer, err := postgres.CreateCatalogOffer(ctx, db, secondStoreOfferInput, "idem-offer-second-store-v1", postgres.HashCatalogOfferCreateRequest(secondStoreOfferInput), testPartnerActorID, "corr-offer-second-store-v1")
		if err != nil {
			t.Fatalf("create second published store offer: %v", err)
		}
		secondStoreOfferUpdate := postgres.CatalogOfferUpdateInput{PriceMinor: 1300, Availability: true, PublicationState: "published", QuantityPolicy: "DISCRETE", QuantityMinBaseUnits: 1, QuantityMaxBaseUnits: 10, QuantityStepBaseUnits: 1, PricingBasis: "PER_UNIT", PricingUnitBaseUnits: 1}
		if _, err := postgres.UpdateCatalogOffer(ctx, db, secondStoreOffer.Offer.ID, secondStoreOfferUpdate, 1, "idem-offer-second-store-publish-v1", postgres.HashCatalogOfferUpdateRequest(secondStoreOffer.Offer.ID, secondStoreOfferUpdate, 1), testPartnerActorID, "corr-offer-second-store-publish-v1"); err != nil {
			t.Fatalf("publish second store offer: %v", err)
		}
		for index, store := range []string{"store_catalog_v1", "store_catalog_v2"} {
			latitude, longitude := 15.3+float64(index)/100, 44.1+float64(index)/100
			if _, err := postgres.SetStoreDeliveryOrigin(ctx, db, store, testPartnerActorID, latitude, longitude, 0, "idem-origin-"+store, postgres.HashStoreDeliveryOriginRequest(store, testPartnerActorID, latitude, longitude, 0), "corr-origin-"+store); err != nil {
				t.Fatalf("set discovery origin for %s: %v", store, err)
			}
		}
		newestPage, err := postgres.ListPublishedStorePage(ctx, db, postgres.PublicStoreListQuery{ServiceCityID: createdCity.City.ID, Sort: "newest", Limit: 1})
		if err != nil || len(newestPage.Stores) != 1 || newestPage.NextCursor == "" {
			t.Fatalf("published store newest first page failed: %+v err=%v", newestPage, err)
		}
		newestNext, err := postgres.ListPublishedStorePage(ctx, db, postgres.PublicStoreListQuery{ServiceCityID: createdCity.City.ID, Sort: "newest", Limit: 1, Cursor: newestPage.NextCursor})
		if err != nil || len(newestNext.Stores) != 1 || newestNext.NextCursor != "" || newestNext.Stores[0].ID == newestPage.Stores[0].ID {
			t.Fatalf("published store newest cursor failed: first=%+v second=%+v err=%v", newestPage, newestNext, err)
		}
		latitude, longitude := 15.3, 44.1
		nearestPage, err := postgres.ListPublishedStorePage(ctx, db, postgres.PublicStoreListQuery{ServiceCityID: createdCity.City.ID, Sort: "nearest", Limit: 1, Latitude: &latitude, Longitude: &longitude})
		if err != nil || len(nearestPage.Stores) != 1 || nearestPage.NextCursor == "" {
			t.Fatalf("published store nearest first page failed: %+v err=%v", nearestPage, err)
		}
		nearestNext, err := postgres.ListPublishedStorePage(ctx, db, postgres.PublicStoreListQuery{ServiceCityID: createdCity.City.ID, Sort: "nearest", Limit: 1, Cursor: nearestPage.NextCursor, Latitude: &latitude, Longitude: &longitude})
		if err != nil || len(nearestNext.Stores) != 1 || nearestNext.NextCursor != "" || nearestNext.Stores[0].ID == nearestPage.Stores[0].ID {
			t.Fatalf("published store nearest cursor failed: first=%+v second=%+v err=%v", nearestPage, nearestNext, err)
		}
		publicStores, err := postgres.ListPublishedStorePage(ctx, db, postgres.PublicStoreListQuery{ServiceCityID: createdCity.City.ID, Sort: "newest", Limit: 10})
		if err != nil || len(publicStores.Stores) != 2 {
			t.Fatalf("published store discovery query failed: %+v err=%v", publicStores, err)
		}
		publishedStore, err := postgres.ReadPublishedStore(ctx, db, "store_catalog_v1", createdCity.City.ID)
		if err != nil || publishedStore.ID != "store_catalog_v1" || len(publishedStore.CategoryIDs) != 1 || publishedStore.CategoryIDs[0] != category.ID {
			t.Fatalf("published store canonical readback failed: %+v err=%v", publishedStore, err)
		}
		discoveryCategories, err := postgres.ListPublicDiscoveryCategories(ctx, db, createdCity.City.ID)
		if err != nil || len(discoveryCategories) != 1 || discoveryCategories[0].ID != category.ID {
			t.Fatalf("public discovery categories failed: %+v err=%v", discoveryCategories, err)
		}
		publicSearch, err := postgres.SearchPublicCatalog(ctx, db, createdCity.City.ID, category.ID, "قهوة", 10, "")
		if err != nil || len(publicSearch.Offers) != 2 || publicSearch.Offers[0].StoreID == publicSearch.Offers[1].StoreID {
			t.Fatalf("public catalog search failed: %+v err=%v", publicSearch, err)
		}
		const favoriteClientID = "client_catalog_favorite_v1"
		favoriteStore, err := postgres.SetClientFavoriteStore(ctx, db, favoriteClientID, "store_catalog_v1", "add", "idem-favorite-store-v1", postgres.HashClientFavoriteStoreMutation("add", "store_catalog_v1"), "corr-favorite-store-v1")
		if err != nil || !favoriteStore.IsFavorite {
			t.Fatalf("favorite published store mutation failed: %+v err=%v", favoriteStore, err)
		}
		favoriteOffer, err := postgres.SetClientFavoriteStoreOffer(ctx, db, favoriteClientID, offer.Offer.ID, "add", "idem-favorite-offer-v1", postgres.HashClientFavoriteStoreOfferMutation("add", offer.Offer.ID), "corr-favorite-offer-v1")
		if err != nil || !favoriteOffer.IsFavorite {
			t.Fatalf("favorite customer-visible offer mutation failed: %+v err=%v", favoriteOffer, err)
		}
		favoriteCatalog, err := postgres.ReadPublicFavoriteStoreCatalog(ctx, db, "store_catalog_v1", createdCity.City.ID, favoriteClientID, 10, "")
		if err != nil || len(favoriteCatalog.Offers) != 1 || favoriteCatalog.Offers[0].ID != offer.Offer.ID {
			t.Fatalf("favorite store public catalog failed: %+v err=%v", favoriteCatalog, err)
		}

		for index, suffix := range []string{"first", "second"} {
			if _, err := db.ExecContext(ctx, `INSERT INTO dsh.catalog_product_proposals(id,partner_actor_id,vertical_id,category_id,proposed_name,proposed_base_unit,created_at)
				VALUES($1,$2,$3,$4,$5,'COUNT',clock_timestamp()+($6::int * interval '1 second'))`, "proposal_"+suffix, testPartnerActorID, vertical.ID, category.ID, "اقتراح "+suffix, index); err != nil {
				t.Fatalf("insert catalog proposal fixture %s: %v", suffix, err)
			}
		}
		proposalPage, err := postgres.ListCatalogProductProposalsForPartner(ctx, db, testPartnerActorID, "", 1, "")
		if err != nil || len(proposalPage.Proposals) != 1 || proposalPage.NextCursor == "" {
			t.Fatalf("catalog proposal first page failed: %+v err=%v", proposalPage, err)
		}
		proposalNext, err := postgres.ListCatalogProductProposalsForPartner(ctx, db, testPartnerActorID, "", 1, proposalPage.NextCursor)
		if err != nil || len(proposalNext.Proposals) != 1 || proposalNext.NextCursor != "" || proposalNext.Proposals[0].ID == proposalPage.Proposals[0].ID {
			t.Fatalf("catalog proposal cursor failed: first=%+v second=%+v err=%v", proposalPage, proposalNext, err)
		}

		for index, suffix := range []string{"first", "second"} {
			phone := fmt.Sprintf("+967770010%03d", index+1)
			createdAt := time.Now().UTC().Add(time.Duration(index) * time.Second)
			if _, err := db.ExecContext(ctx, `INSERT INTO dsh.captain_admissions(id,contact_phone_e164,full_name_ar,state,created_at)
				VALUES($1,$2,$3,'pending_identity',$4)`, "captain_"+suffix, phone, "كابتن "+suffix, createdAt); err != nil {
				t.Fatalf("insert Captain admission fixture %s: %v", suffix, err)
			}
			if _, err := db.ExecContext(ctx, `INSERT INTO dsh.field_admissions(id,contact_phone_e164,full_name_ar,state,created_at)
				VALUES($1,$2,$3,'pending_identity',$4)`, "field_"+suffix, fmt.Sprintf("+967770011%03d", index+1), "مندوب "+suffix, createdAt); err != nil {
				t.Fatalf("insert Field admission fixture %s: %v", suffix, err)
			}
		}
		captainPage, err := postgres.ListCaptainAdmissions(ctx, db, "", "all", "created_asc", 1, "")
		if err != nil || len(captainPage.Admissions) != 1 || captainPage.NextCursor == "" {
			t.Fatalf("Captain admission first page failed: %+v err=%v", captainPage, err)
		}
		captainNext, err := postgres.ListCaptainAdmissions(ctx, db, "", "all", "created_asc", 1, captainPage.NextCursor)
		if err != nil || len(captainNext.Admissions) != 1 || captainNext.NextCursor != "" || captainNext.Admissions[0].ID == captainPage.Admissions[0].ID {
			t.Fatalf("Captain admission cursor failed: first=%+v second=%+v err=%v", captainPage, captainNext, err)
		}
		fieldPage, err := postgres.ListFieldAdmissions(ctx, db, "", "all", "created_asc", 1, "")
		if err != nil || len(fieldPage.Admissions) != 1 || fieldPage.NextCursor == "" {
			t.Fatalf("Field admission first page failed: %+v err=%v", fieldPage, err)
		}
		fieldNext, err := postgres.ListFieldAdmissions(ctx, db, "", "all", "created_asc", 1, fieldPage.NextCursor)
		if err != nil || len(fieldNext.Admissions) != 1 || fieldNext.NextCursor != "" || fieldNext.Admissions[0].ID == fieldPage.Admissions[0].ID {
			t.Fatalf("Field admission cursor failed: first=%+v second=%+v err=%v", fieldPage, fieldNext, err)
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
