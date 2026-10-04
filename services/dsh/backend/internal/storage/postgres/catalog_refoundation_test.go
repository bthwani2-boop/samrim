package postgres_test

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	_ "github.com/lib/pq"
)

type catalogRefoundationScenario struct {
	t            *testing.T
	ctx          context.Context
	db           *sql.DB
	cityID       string
	verticalID   string
	categoryID   string
	productID    string
	variantID    string
	offerID      string
	productInput postgres.CatalogProductInput
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

	withFreshCanonicalDatabase(t, rootDB, databaseURL, func(ctx context.Context, db *sql.DB, records []postgres.MigrationRecord, migrationSQL []string) {
		scenario := catalogRefoundationScenario{t: t, ctx: ctx, db: db}
		scenario.verifyFreshSchema(records, migrationSQL)
		scenario.createRegistryFixtures()
		scenario.verifySharedProducts()
		scenario.verifyStoreScopedProducts()
		scenario.publishFirstStoreOffer()
		scenario.publishSecondStoreOffer()
		scenario.verifyPublicStoreDiscovery()
		scenario.verifyFavorites()
		scenario.verifyProposalPagination()
		scenario.verifyAdmissionPagination()
	})
}

func (s *catalogRefoundationScenario) verifyFreshSchema(records []postgres.MigrationRecord, migrationSQL []string) {
	s.t.Helper()
	if len(records) != postgres.CanonicalSchemaVersion || len(migrationSQL) != postgres.CanonicalSchemaVersion {
		s.t.Fatalf("unexpected DSH migration graph size: records=%d sql=%d", len(records), len(migrationSQL))
	}
	assertRequiredMigrationOrder(s.t, records,
		"018_remove_unjustified_captain_terminated_state.sql",
		"019_captain_delivery_recovery.sql",
		"020_field_standing_admission_and_joining_scope.sql",
		"093_catalog_mixed_scope_and_store_skus.sql",
		"095_wallet_provider_intent.sql",
		"096_catalog_product_proposal_field_ownership.sql",
		"097_store_catalog_import_scope.sql",
	)
	if err := postgres.MigrateCanonical(s.ctx, s.db, records, migrationSQL, testDeliveryProofKeyring(s.t)); err != nil {
		s.t.Fatalf("apply fresh DSH migrations: %v", err)
	}
	if err := postgres.VerifyCanonicalSchema(s.ctx, s.db, records); err != nil {
		s.t.Fatalf("verify fresh DSH schema: %v", err)
	}
	if err := postgres.MigrateCanonical(s.ctx, s.db, records, migrationSQL, testDeliveryProofKeyring(s.t)); err != nil {
		s.t.Fatalf("rerun DSH migrations with matching checksums: %v", err)
	}
	var visibilityViews int
	if err := s.db.QueryRowContext(s.ctx, `SELECT count(*) FROM pg_views WHERE schemaname='dsh' AND viewname IN ('catalog_publishable_offers','catalog_customer_visible_offers')`).Scan(&visibilityViews); err != nil || visibilityViews != 2 {
		s.t.Fatalf("catalog offer visibility views are not installed: count=%d err=%v", visibilityViews, err)
	}
	var publishableViewDefinition, customerVisibleViewDefinition string
	if err := s.db.QueryRowContext(s.ctx, `SELECT pg_get_viewdef('dsh.catalog_publishable_offers'::regclass,true)`).Scan(&publishableViewDefinition); err != nil {
		s.t.Fatalf("read canonical catalog publishable-offer view: %v", err)
	}
	for _, required := range []string{"availability = true", "price_minor > 0", "quantity_policy <> 'VARIABLE_MEASURE'", "inventory_policy", "catalog_category_attribute_rules", "catalog_store_offer_modifier_groups"} {
		if !strings.Contains(publishableViewDefinition, required) {
			s.t.Fatalf("canonical catalog publishable-offer view omits required condition %q", required)
		}
	}
	if strings.Contains(publishableViewDefinition, "catalog_model") {
		s.t.Fatal("canonical catalog publishable-offer view still depends on the removed vertical catalog model")
	}
	if err := s.db.QueryRowContext(s.ctx, `SELECT pg_get_viewdef('dsh.catalog_customer_visible_offers'::regclass,true)`).Scan(&customerVisibleViewDefinition); err != nil {
		s.t.Fatalf("read canonical customer-visible-offer view: %v", err)
	}
	if !strings.Contains(customerVisibleViewDefinition, "publication_state = 'published'") {
		s.t.Fatal("canonical customer-visible-offer view omits published-store state")
	}
	for _, table := range []string{"central_products", "central_product_mutation_idempotency", "central_product_audit", "store_assortments", "store_assortment_mutation_idempotency", "store_assortment_audit"} {
		var absent bool
		if err := s.db.QueryRowContext(s.ctx, "SELECT to_regclass($1) IS NULL", "dsh."+table).Scan(&absent); err != nil || !absent {
			s.t.Fatalf("legacy catalog relation remains after cutover: %s err=%v", table, err)
		}
	}
}

func (s *catalogRefoundationScenario) createRegistryFixtures() {
	s.t.Helper()
	createdCity, err := postgres.CreateServiceCity(s.ctx, s.db, "صنعاء", true, "idem-city-catalog-v1", postgres.HashServiceCityCreateRequest("صنعاء", true), testOperatorActorID, "corr-city-catalog-v1")
	if err != nil {
		s.t.Fatalf("create service city: %v", err)
	}
	s.cityID = createdCity.City.ID
	vertical := postgres.CommerceVerticalRecord{NameAr: "بقالة", NameEn: "Grocery", Active: true}
	verticalAudit := postgres.CatalogRegistryAuditInput{ActingActorID: testOperatorActorID, CorrelationID: "corr-vertical-v1", Reason: "Initial catalog vertical"}
	createdVertical, err := postgres.CreateCommerceVertical(s.ctx, s.db, vertical, "idem-vertical-v1", postgres.HashCatalogVerticalCreateRequest(vertical, verticalAudit.Reason), verticalAudit)
	if err != nil || !strings.HasPrefix(createdVertical.Vertical.ID, "vertical_") || createdVertical.Vertical.Version != 1 {
		s.t.Fatalf("create commerce vertical: %+v err=%v", createdVertical, err)
	}
	vertical.ID = createdVertical.Vertical.ID
	s.verticalID = vertical.ID
	category := postgres.CatalogCategoryRecord{VerticalID: vertical.ID, NameAr: "قهوة", NameEn: "Coffee", Active: true}
	categoryAudit := postgres.CatalogRegistryAuditInput{ActingActorID: testOperatorActorID, CorrelationID: "corr-category-v1", Reason: "Initial catalog category"}
	createdCategory, err := postgres.CreateCatalogCategory(s.ctx, s.db, category, "idem-category-v1", postgres.HashCatalogCategoryCreateRequest(category, categoryAudit.Reason), categoryAudit)
	if err != nil || !strings.HasPrefix(createdCategory.ID, "category_") {
		s.t.Fatalf("create catalog category: %v", err)
	}
	category.ID = createdCategory.ID
	category.Version = createdCategory.Version
	s.categoryID = category.ID
	childCategory := postgres.CatalogCategoryRecord{VerticalID: vertical.ID, ParentCategoryID: category.ID, NameAr: "قهوة مختصة", NameEn: "Specialty Coffee", Active: true}
	childAudit := postgres.CatalogRegistryAuditInput{ActingActorID: testOperatorActorID, CorrelationID: "corr-category-child-v1", Reason: "Add specialty coffee child category"}
	createdChild, err := postgres.CreateCatalogCategory(s.ctx, s.db, childCategory, "idem-category-child-v1", postgres.HashCatalogCategoryCreateRequest(childCategory, childAudit.Reason), childAudit)
	if err != nil {
		s.t.Fatalf("create child catalog category: %v", err)
	}
	cycleUpdate := postgres.UpdateCatalogCategoryInput{ParentCategoryID: createdChild.ID, NameAr: category.NameAr, NameEn: category.NameEn, Active: category.Active, ExpectedVersion: category.Version}
	cycleReason := "Reject category cycle"
	cycleAudit := postgres.CatalogRegistryAuditInput{ActingActorID: testOperatorActorID, CorrelationID: "corr-category-cycle-v1", Reason: cycleReason}
	if _, _, err := postgres.UpdateCatalogCategory(s.ctx, s.db, category.ID, cycleUpdate, "idem-category-cycle-v1", postgres.HashCatalogCategoryUpdateRequest(category.ID, cycleUpdate, cycleReason), cycleAudit); !errors.Is(err, postgres.ErrCatalogCategoryCycle) {
		s.t.Fatalf("expected category cycle rejection, got %v", err)
	}
	rootDisable := postgres.UpdateCatalogCategoryInput{ParentCategoryID: "", NameAr: category.NameAr, NameEn: category.NameEn, Active: false, ExpectedVersion: category.Version}
	if _, _, err := postgres.UpdateCatalogCategory(s.ctx, s.db, category.ID, rootDisable, "idem-category-root-disable-blocked-v1", postgres.HashCatalogCategoryUpdateRequest(category.ID, rootDisable, "Disable parent"), categoryAudit); !errors.Is(err, postgres.ErrCatalogCategoryHasActiveChildren) {
		s.t.Fatalf("expected active descendant rejection, got %v", err)
	}
	childDisable := postgres.UpdateCatalogCategoryInput{ParentCategoryID: category.ID, NameAr: childCategory.NameAr, NameEn: childCategory.NameEn, Active: false, ExpectedVersion: createdChild.Version}
	childDisabled, _, err := postgres.UpdateCatalogCategory(s.ctx, s.db, createdChild.ID, childDisable, "idem-category-child-disable-v1", postgres.HashCatalogCategoryUpdateRequest(createdChild.ID, childDisable, "Disable child"), childAudit)
	if err != nil || childDisabled.Active || childDisabled.Version != createdChild.Version+1 {
		s.t.Fatalf("disable child category: %+v err=%v", childDisabled, err)
	}
	rootDisabled, _, err := postgres.UpdateCatalogCategory(s.ctx, s.db, category.ID, rootDisable, "idem-category-root-disable-v1", postgres.HashCatalogCategoryUpdateRequest(category.ID, rootDisable, "Disable parent"), categoryAudit)
	if err != nil || rootDisabled.Active || rootDisabled.Version != category.Version+1 {
		s.t.Fatalf("disable parent after child: %+v err=%v", rootDisabled, err)
	}
	childReactivate := childDisable
	childReactivate.Active = true
	childReactivate.ExpectedVersion = childDisabled.Version
	if _, _, err := postgres.UpdateCatalogCategory(s.ctx, s.db, createdChild.ID, childReactivate, "idem-category-child-reactivate-blocked-v1", postgres.HashCatalogCategoryUpdateRequest(createdChild.ID, childReactivate, "Reactivate child"), childAudit); !errors.Is(err, postgres.ErrCatalogCategoryParentInactive) {
		s.t.Fatalf("expected inactive parent path rejection, got %v", err)
	}
	newActiveChild := postgres.CatalogCategoryRecord{VerticalID: vertical.ID, ParentCategoryID: category.ID, NameAr: "قهوة موسمية", NameEn: "Seasonal Coffee", Active: true}
	if _, err := postgres.CreateCatalogCategory(s.ctx, s.db, newActiveChild, "idem-category-create-under-inactive-v1", postgres.HashCatalogCategoryCreateRequest(newActiveChild, "Create under inactive parent"), childAudit); !errors.Is(err, postgres.ErrCatalogCategoryParentInactive) {
		s.t.Fatalf("expected active child creation under inactive parent to fail, got %v", err)
	}
	rootReactivate := rootDisable
	rootReactivate.Active = true
	rootReactivate.ExpectedVersion = rootDisabled.Version
	category, _, err = postgres.UpdateCatalogCategory(s.ctx, s.db, category.ID, rootReactivate, "idem-category-root-reactivate-v1", postgres.HashCatalogCategoryUpdateRequest(category.ID, rootReactivate, "Reactivate parent"), categoryAudit)
	if err != nil || !category.Active {
		s.t.Fatalf("reactivate parent category: %+v err=%v", category, err)
	}
	childReactivate.ExpectedVersion = childDisabled.Version
	createdChild, _, err = postgres.UpdateCatalogCategory(s.ctx, s.db, createdChild.ID, childReactivate, "idem-category-child-reactivate-v1", postgres.HashCatalogCategoryUpdateRequest(createdChild.ID, childReactivate, "Reactivate child"), childAudit)
	if err != nil || !createdChild.Active {
		s.t.Fatalf("reactivate child category: %+v err=%v", createdChild, err)
	}
	var activeTreeCategories int
	if err := s.db.QueryRowContext(s.ctx, "SELECT count(*) FROM dsh.catalog_categories WHERE (id=$1 OR id=$2) AND active=true", category.ID, createdChild.ID).Scan(&activeTreeCategories); err != nil || activeTreeCategories != 2 {
		s.t.Fatalf("category tree should be fully restored and active: count=%d err=%v", activeTreeCategories, err)
	}
	attributeInput := postgres.CatalogAttributeDefinitionInput{ID: "coffee_origin", VerticalID: vertical.ID, Code: "origin", NameAr: "بلد المنشأ", ValueKind: "TEXT", Active: true}
	if _, _, err := postgres.CreateCatalogAttributeDefinition(s.ctx, s.db, attributeInput, "idem-attribute-origin-v1", postgres.HashCatalogAttributeDefinitionRequest(attributeInput)); err != nil {
		s.t.Fatalf("create catalog attribute definition: %v", err)
	}
	rule := postgres.CatalogAttributeRuleRecord{CategoryID: category.ID, AttributeID: attributeInput.ID}
	ruleAudit := postgres.CatalogRegistryAuditInput{ActingActorID: testOperatorActorID, CorrelationID: "corr-rule-origin-v1", Reason: "Establish origin attribute rule"}
	ruleHash := postgres.HashCatalogCategoryAttributeRuleRequest(rule, 0, ruleAudit.Reason)
	if err := postgres.UpsertCatalogCategoryAttributeRule(s.ctx, s.db, rule, 0, "idem-rule-origin-v1", ruleHash, ruleAudit); err != nil {
		s.t.Fatalf("create category attribute rule: %v", err)
	}
	staleRule := postgres.CatalogAttributeRuleRecord{CategoryID: category.ID, AttributeID: attributeInput.ID, Required: true}
	staleReason := "Stale rule update"
	staleAudit := postgres.CatalogRegistryAuditInput{ActingActorID: testOperatorActorID, CorrelationID: "corr-rule-origin-stale-v1", Reason: staleReason}
	if err := postgres.UpsertCatalogCategoryAttributeRule(s.ctx, s.db, staleRule, 0, "idem-rule-origin-stale-v1", postgres.HashCatalogCategoryAttributeRuleRequest(staleRule, 0, staleReason), staleAudit); !errors.Is(err, postgres.ErrCatalogVersionConflict) {
		s.t.Fatalf("expected stale category attribute rule rejection, got %v", err)
	}
	var auditCount int
	if err := s.db.QueryRowContext(s.ctx, "SELECT count(*) FROM dsh.catalog_registry_audit_events WHERE entity_type IN ('vertical','category','attribute_rule') AND acting_actor_id=$1", testOperatorActorID).Scan(&auditCount); err != nil || auditCount != 8 {
		s.t.Fatalf("catalog registry audit readback count=%d err=%v", auditCount, err)
	}
}

func (s *catalogRefoundationScenario) verifySharedProducts() {
	s.t.Helper()
	s.productInput = postgres.CatalogProductInput{VerticalID: s.verticalID, Scope: "SHARED", CanonicalName: "قهوة عربية", MeasurementKind: "DISCRETE", BaseUnit: "COUNT", VariantTitle: "عبوة 250 غ", CategoryIDs: []string{s.categoryID}, IdentifierType: "GTIN", IdentifierValue: "6281000000001"}
	createdProduct, err := postgres.CreateCatalogProduct(s.ctx, s.db, s.productInput, "idem-product-v1", postgres.HashCatalogProductCreateRequest(s.productInput), testOperatorActorID, "corr-product-v1")
	if err != nil || createdProduct.Product.ID == "" || createdProduct.Product.Version != 1 {
		s.t.Fatalf("create catalog product: %+v err=%v", createdProduct, err)
	}
	s.productID = createdProduct.Product.ID
	secondProductInput := s.productInput
	secondProductInput.CanonicalName = "قهوة مختصة"
	secondProductInput.IdentifierValue = "6281000000002"
	secondProduct, err := postgres.CreateCatalogProduct(s.ctx, s.db, secondProductInput, "idem-product-second-v1", postgres.HashCatalogProductCreateRequest(secondProductInput), testOperatorActorID, "corr-product-second-v1")
	if err != nil || secondProduct.Product.ID == "" || secondProduct.Product.ID == s.productID {
		s.t.Fatalf("create second catalog product for keyset proof: %+v err=%v", secondProduct, err)
	}
	secondProductRecord, err := postgres.ReadCatalogProduct(s.ctx, s.db, secondProduct.Product.ID)
	if err != nil || len(secondProductRecord.Variants) != 1 {
		s.t.Fatalf("read second catalog product for inactive identifier proof: %+v err=%v", secondProductRecord, err)
	}
	insertCanonicalStoreFixture(s.t, s.ctx, s.db, canonicalStoreFixture{
		ID: "store_catalog_inactive_identifier", PartnerActorID: testPartnerActorID, Name: "متجر اختبار حل المعرّف",
		ServiceCityID: s.cityID, PrimaryVerticalID: s.verticalID,
	})
	variant := secondProductRecord.Variants[0]
	inactiveVariantInput := postgres.CatalogVariantInput{ID: variant.ID, ProductID: variant.ProductID, Title: variant.Title, MeasurementKind: variant.MeasurementKind, BaseUnit: variant.BaseUnit, Active: false}
	inactiveVariant, err := postgres.UpdateCatalogVariant(s.ctx, s.db, variant.ID, inactiveVariantInput, variant.Version, "idem-inactive-variant-v1", postgres.HashCatalogVariantUpdateRequest(variant.ID, inactiveVariantInput, variant.Version), testOperatorActorID, "corr-inactive-variant-v1")
	if err != nil || inactiveVariant.Variant.Active {
		s.t.Fatalf("deactivate catalog variant for identifier proof: %+v err=%v", inactiveVariant, err)
	}
	inactiveVariantResolution, err := postgres.ResolveCatalogIdentifier(s.ctx, s.db, "store_catalog_inactive_identifier", secondProductInput.IdentifierValue)
	if err != nil || inactiveVariantResolution.Outcome != "UNKNOWN_IDENTIFIER" {
		s.t.Fatalf("inactive variant remained resolvable: %+v err=%v", inactiveVariantResolution, err)
	}
	activeVariantInput := inactiveVariantInput
	activeVariantInput.Active = true
	activeVariant, err := postgres.UpdateCatalogVariant(s.ctx, s.db, variant.ID, activeVariantInput, inactiveVariant.Variant.Version, "idem-reactivate-variant-v1", postgres.HashCatalogVariantUpdateRequest(variant.ID, activeVariantInput, inactiveVariant.Variant.Version), testOperatorActorID, "corr-reactivate-variant-v1")
	if err != nil || !activeVariant.Variant.Active {
		s.t.Fatalf("reactivate catalog variant for product proof: %+v err=%v", activeVariant, err)
	}
	inactiveProductInput := postgres.CatalogProductUpdateInput{
		VerticalID: secondProductRecord.VerticalID, Scope: secondProductRecord.Scope, StoreID: secondProductRecord.StoreID,
		CanonicalName: secondProductRecord.CanonicalName, Description: secondProductRecord.Description, Brand: secondProductRecord.Brand, Active: false,
		CategoryIDs: secondProductRecord.CategoryIDs, AttributeValues: []postgres.CatalogAttributeValueInput{},
		VariantAttributeValues: []postgres.CatalogVariantAttributeValueSet{{VariantID: variant.ID, Values: []postgres.CatalogAttributeValueInput{}}},
	}
	inactiveProduct, err := postgres.UpdateCatalogProduct(s.ctx, s.db, secondProductRecord.ID, inactiveProductInput, secondProductRecord.Version, "idem-inactive-product-v1", postgres.HashCatalogProductUpdateRequest(secondProductRecord.ID, inactiveProductInput, secondProductRecord.Version), testOperatorActorID, "corr-inactive-product-v1")
	if err != nil || inactiveProduct.Product.Active {
		s.t.Fatalf("deactivate catalog product for identifier proof: %+v err=%v", inactiveProduct, err)
	}
	inactiveProductResolution, err := postgres.ResolveCatalogIdentifier(s.ctx, s.db, "store_catalog_inactive_identifier", secondProductInput.IdentifierValue)
	if err != nil || inactiveProductResolution.Outcome != "UNKNOWN_IDENTIFIER" {
		s.t.Fatalf("inactive product remained resolvable: %+v err=%v", inactiveProductResolution, err)
	}
	s.verifySharedProductPagination()
}

func (s *catalogRefoundationScenario) verifySharedProductPagination() {
	s.t.Helper()
	registryPage, err := postgres.ListCatalogProductRegistry(s.ctx, s.db, "", s.verticalID, "", "all", "name_asc", 1, "")
	if err != nil || len(registryPage.Products) != 1 || registryPage.NextCursor == "" {
		s.t.Fatalf("catalog product registry first page failed: %+v err=%v", registryPage, err)
	}
	registryNextPage, err := postgres.ListCatalogProductRegistry(s.ctx, s.db, "", s.verticalID, "", "all", "name_asc", 1, registryPage.NextCursor)
	if err != nil || len(registryNextPage.Products) != 1 || registryNextPage.NextCursor != "" || registryNextPage.Products[0].ID == registryPage.Products[0].ID {
		s.t.Fatalf("catalog product registry cursor failed: first=%+v second=%+v err=%v", registryPage, registryNextPage, err)
	}
	sharedProductPage, err := postgres.ListCatalogProducts(s.ctx, s.db, "", s.verticalID, false, 1, "")
	if err != nil || len(sharedProductPage.Products) != 1 || sharedProductPage.NextCursor == "" {
		s.t.Fatalf("shared catalog product first page failed: %+v err=%v", sharedProductPage, err)
	}
	sharedProductNextPage, err := postgres.ListCatalogProducts(s.ctx, s.db, "", s.verticalID, false, 1, sharedProductPage.NextCursor)
	if err != nil || len(sharedProductNextPage.Products) != 1 || sharedProductNextPage.NextCursor != "" || sharedProductNextPage.Products[0].ID == sharedProductPage.Products[0].ID {
		s.t.Fatalf("shared catalog product cursor failed: first=%+v second=%+v err=%v", sharedProductPage, sharedProductNextPage, err)
	}
	partnerProductPage, err := postgres.ListCatalogProductsForPartner(s.ctx, s.db, "", s.verticalID, testPartnerActorID, 1, "")
	if err != nil || len(partnerProductPage.Products) != 1 || partnerProductPage.NextCursor == "" {
		s.t.Fatalf("partner shared catalog product first page failed: %+v err=%v", partnerProductPage, err)
	}
	partnerProductNextPage, err := postgres.ListCatalogProductsForPartner(s.ctx, s.db, "", s.verticalID, testPartnerActorID, 1, partnerProductPage.NextCursor)
	if err != nil || len(partnerProductNextPage.Products) != 1 || partnerProductNextPage.NextCursor != "" || partnerProductNextPage.Products[0].ID == partnerProductPage.Products[0].ID {
		s.t.Fatalf("partner shared catalog product cursor failed: first=%+v second=%+v err=%v", partnerProductPage, partnerProductNextPage, err)
	}
}

func (s *catalogRefoundationScenario) verifyStoreScopedProducts() {
	s.t.Helper()
	localVertical := postgres.CommerceVerticalRecord{NameAr: "مخبوزات محلية", NameEn: "Local Bakery", Active: true}
	localVerticalAudit := postgres.CatalogRegistryAuditInput{ActingActorID: testOperatorActorID, CorrelationID: "corr-local-vertical-v1", Reason: "Initial local catalog vertical"}
	createdLocalVertical, err := postgres.CreateCommerceVertical(s.ctx, s.db, localVertical, "idem-local-vertical-v1", postgres.HashCatalogVerticalCreateRequest(localVertical, localVerticalAudit.Reason), localVerticalAudit)
	if err != nil || createdLocalVertical.Vertical.ID == "" {
		s.t.Fatalf("create local catalog vertical: %+v err=%v", createdLocalVertical, err)
	}
	localStoreID := "store_catalog_local_v1"
	insertCanonicalStoreFixture(s.t, s.ctx, s.db, canonicalStoreFixture{ID: localStoreID, PartnerActorID: testPartnerActorID, Name: "متجر المخبوزات", ServiceCityID: s.cityID, PrimaryVerticalID: createdLocalVertical.Vertical.ID, PublicationState: "published"})
	foreignVerticalMatch, err := postgres.ResolveCatalogIdentifier(s.ctx, s.db, localStoreID, s.productInput.IdentifierValue)
	if err != nil || foreignVerticalMatch.Outcome != "UNKNOWN_IDENTIFIER" {
		s.t.Fatalf("Field identifier lookup matched a shared product from another vertical: %+v err=%v", foreignVerticalMatch, err)
	}
	localProductInput := postgres.CatalogProductInput{VerticalID: createdLocalVertical.Vertical.ID, Scope: "STORE_SCOPED", StoreID: localStoreID, CanonicalName: "خبز محلي", MeasurementKind: "DISCRETE", BaseUnit: "COUNT", VariantTitle: "رغيف"}
	localProduct, err := postgres.CreateCatalogProduct(s.ctx, s.db, localProductInput, "idem-local-product-v1", postgres.HashCatalogProductCreateRequest(localProductInput), testOperatorActorID, "corr-local-product-v1")
	if err != nil || localProduct.Product.ID == "" {
		s.t.Fatalf("create store-scoped catalog product: %+v err=%v", localProduct, err)
	}
	ownedLocalProducts, err := postgres.ListCatalogProductsForPartner(s.ctx, s.db, "", createdLocalVertical.Vertical.ID, testPartnerActorID, 10, "")
	if err != nil || len(ownedLocalProducts.Products) != 1 || ownedLocalProducts.Products[0].ID != localProduct.Product.ID {
		s.t.Fatalf("owning partner cannot read its store-scoped catalog product: %+v err=%v", ownedLocalProducts, err)
	}
	otherPartnerProducts, err := postgres.ListCatalogProductsForPartner(s.ctx, s.db, "", createdLocalVertical.Vertical.ID, "partner_not_the_owner", 10, "")
	if err != nil || len(otherPartnerProducts.Products) != 0 {
		s.t.Fatalf("unrelated partner can read a store-scoped catalog product: %+v err=%v", otherPartnerProducts, err)
	}
	publicLocalProducts, err := postgres.ListCatalogProducts(s.ctx, s.db, "", createdLocalVertical.Vertical.ID, false, 10, "")
	if err != nil || len(publicLocalProducts.Products) != 0 {
		s.t.Fatalf("public catalog list exposed a store-scoped product: %+v err=%v", publicLocalProducts, err)
	}
	product, err := postgres.ReadCatalogProduct(s.ctx, s.db, s.productID)
	if err != nil || len(product.Variants) != 1 || len(product.Variants[0].Identifiers) != 1 || len(product.CategoryIDs) != 1 || len(product.Media) != 0 {
		s.t.Fatalf("catalog product canonical readback incomplete: %+v err=%v", product, err)
	}
	s.variantID = product.Variants[0].ID
	replay, err := postgres.CreateCatalogProduct(s.ctx, s.db, s.productInput, "idem-product-v1", postgres.HashCatalogProductCreateRequest(s.productInput), testOperatorActorID, "corr-product-replay-v1")
	if err != nil || !replay.Replayed || replay.Product.ID != product.ID {
		s.t.Fatalf("catalog product idempotent replay failed: %+v err=%v", replay, err)
	}
	duplicateInput := s.productInput
	duplicateInput.CanonicalName = "شاي"
	if _, err := postgres.CreateCatalogProduct(s.ctx, s.db, duplicateInput, "idem-product-duplicate-v1", postgres.HashCatalogProductCreateRequest(duplicateInput), testOperatorActorID, "corr-product-duplicate-v1"); !errors.Is(err, postgres.ErrCatalogDuplicateIdentifier) {
		s.t.Fatalf("expected duplicate identifier rejection, got %v", err)
	}
}

func (s *catalogRefoundationScenario) publishFirstStoreOffer() {
	s.t.Helper()
	insertCanonicalStoreFixture(s.t, s.ctx, s.db, canonicalStoreFixture{ID: "store_catalog_v1", PartnerActorID: testPartnerActorID, Name: "متجر القهوة", ServiceCityID: s.cityID, PrimaryVerticalID: s.verticalID, PublicationState: "published"})
	s.createStoreTargetDiscoveryContent()
	offerInput := postgres.CatalogOfferInput{StoreID: "store_catalog_v1", VariantID: s.variantID, PriceMinor: 1250, QuantityPolicy: "DISCRETE", QuantityMinBaseUnits: 1, QuantityMaxBaseUnits: 10, QuantityStepBaseUnits: 1, PricingBasis: "PER_UNIT", PricingUnitBaseUnits: 1}
	offer, err := postgres.CreateCatalogOffer(s.ctx, s.db, offerInput, "idem-offer-v1", postgres.HashCatalogOfferCreateRequest(offerInput), testPartnerActorID, "corr-offer-v1")
	if err != nil || offer.Offer.PublicationState != "draft" || offer.Offer.Version != 1 {
		s.t.Fatalf("create store offer: %+v err=%v", offer, err)
	}
	s.offerID = offer.Offer.ID
	if _, err := postgres.CreateCatalogOffer(s.ctx, s.db, offerInput, "idem-offer-v1", postgres.HashCatalogOfferCreateRequest(offerInput), testPartnerActorID, "corr-offer-replay-v1"); err != nil {
		s.t.Fatalf("store offer replay: %v", err)
	}
	offerUpdate := postgres.CatalogOfferUpdateInput{PriceMinor: 1250, Availability: true, PublicationState: "published", QuantityPolicy: "DISCRETE", QuantityMinBaseUnits: 1, QuantityMaxBaseUnits: 10, QuantityStepBaseUnits: 1, PricingBasis: "PER_UNIT", PricingUnitBaseUnits: 1}
	if _, err := postgres.UpdateCatalogOffer(s.ctx, s.db, s.offerID, offerUpdate, 9, "idem-offer-stale-v1", postgres.HashCatalogOfferUpdateRequest(s.offerID, offerUpdate, 9), testPartnerActorID, "corr-offer-stale-v1"); !errors.Is(err, postgres.ErrCatalogVersionConflict) {
		s.t.Fatalf("expected stale offer version rejection, got %v", err)
	}
	quickPriceUpdate := postgres.CatalogOfferUpdateInput{PriceMinor: 1350, Availability: false, PublicationState: "draft", QuantityPolicy: "DISCRETE", QuantityMinBaseUnits: 1, QuantityMaxBaseUnits: 10, QuantityStepBaseUnits: 1, PricingBasis: "PER_UNIT", PricingUnitBaseUnits: 1, InventoryPolicy: "AVAILABILITY_ONLY"}
	quickPriceHash := postgres.HashCatalogQuickPriceUpdateRequest(s.offerID, quickPriceUpdate.PriceMinor, 1)
	quickPriceMutation, err := postgres.UpdateCatalogOfferWithProvenance(s.ctx, s.db, s.offerID, quickPriceUpdate, 1, "idem-offer-quick-price-v1", quickPriceHash, testPartnerActorID, "corr-offer-quick-price-v1", "QUICK_PRICES")
	if err != nil || quickPriceMutation.Offer.Version != 2 || quickPriceMutation.Offer.PriceMinor != quickPriceUpdate.PriceMinor {
		s.t.Fatalf("quick-price update: %+v err=%v", quickPriceMutation, err)
	}
	offerUpdate.PriceMinor = quickPriceUpdate.PriceMinor
	published, err := postgres.UpdateCatalogOffer(s.ctx, s.db, s.offerID, offerUpdate, 2, "idem-offer-publish-v1", postgres.HashCatalogOfferUpdateRequest(s.offerID, offerUpdate, 2), testPartnerActorID, "corr-offer-publish-v1")
	if err != nil || published.Offer.PublicationState != "published" || published.Offer.Version != 3 {
		s.t.Fatalf("publish store offer: %+v err=%v", published, err)
	}
	quickPriceReplay, err := postgres.UpdateCatalogOfferWithProvenance(s.ctx, s.db, s.offerID, quickPriceUpdate, 1, "idem-offer-quick-price-v1", quickPriceHash, testPartnerActorID, "corr-offer-quick-price-replay-v1", "QUICK_PRICES")
	if err != nil || !quickPriceReplay.Replayed || quickPriceReplay.Offer.Version != published.Offer.Version {
		s.t.Fatalf("quick-price same-key replay after later offer update: %+v err=%v", quickPriceReplay, err)
	}
	target, err := postgres.ResolveDiscoveryContentTarget(s.ctx, s.db, "discovery_store_target_no_offer", s.cityID)
	if err != nil || target.TargetType != "STORE" || target.StoreID != "store_catalog_v1" {
		s.t.Fatalf("store-targeted discovery content should resolve after the store gains a visible offer: %+v err=%v", target, err)
	}
	feed, err := postgres.ListDiscoveryContent(s.ctx, s.db, true, s.cityID)
	if err != nil || !hasDiscoveryContent(feed, "discovery_store_target_no_offer") {
		s.t.Fatalf("store-targeted discovery content should enter the public feed with an openable store: feed=%+v err=%v", feed, err)
	}
	ready, err := postgres.HasPublishableCatalog(s.ctx, s.db, "store_catalog_v1")
	if err != nil || !ready {
		s.t.Fatalf("publishable catalog readback failed: ready=%v err=%v", ready, err)
	}
	publicCatalog, err := postgres.ReadPublicCatalog(s.ctx, s.db, "store_catalog_v1", s.cityID, "", "", "", 50, "")
	if err != nil || len(publicCatalog.Offers) != 1 || publicCatalog.Offers[0].VariantID != s.variantID || publicCatalog.Offers[0].Product.ID != s.productID {
		s.t.Fatalf("customer-visible offer readback failed: %+v err=%v", publicCatalog.Offers, err)
	}
	if _, err := s.db.ExecContext(s.ctx, `INSERT INTO dsh.joining_cases(
		id,contact_phone_e164,business_name,first_store_name,first_store_vertical_id,first_store_commercial_type_id,partner_actor_id,state,store_id,origin,financial_profile_state
	) VALUES('joining_store_discovery_v1','+967770001234','مؤسسة القهوة','متجر القهوة',$1,$2,$3,'approved','store_catalog_v1','control_panel','ACTIVE')`, s.verticalID, "store_catalog_v1-type", testPartnerActorID); err != nil {
		s.t.Fatalf("create published store discovery eligibility fixture: %v", err)
	}
}

func (s *catalogRefoundationScenario) createStoreTargetDiscoveryContent() {
	s.t.Helper()
	const assetID = "discovery_store_target_asset"
	if _, err := s.db.ExecContext(s.ctx, `INSERT INTO dsh.discovery_content_media_assets(
		id,idempotency_key,request_hash,object_key,uri,content_sha256,content_type,byte_size,
		state,creator,source_description,rights_statement,rights_attested_by_actor_id
	) VALUES($1,$2,$3,$4,$5,$6,'image/jpeg',128,'active','Fixture Owner','Store discovery fixture image','Licensed for integration test','marketing-fixture-operator')`,
		assetID, "idempotency-"+assetID, postgres.HashMarketingFacts(assetID), "fixture/"+assetID, "asset://"+assetID, strings.Repeat("a", 64)); err != nil {
		s.t.Fatalf("insert store-targeted discovery media: %v", err)
	}
	if _, err := s.db.ExecContext(s.ctx, `INSERT INTO dsh.discovery_content(
		id,kind,title_ar,media_asset_id,target_type,target_id,service_city_id,state,starts_at,created_by_actor_id
	) VALUES('discovery_store_target_no_offer','BANNER','متجر تجريبي',$1,'STORE','store_catalog_v1',$2,'PUBLISHED',clock_timestamp()-interval '1 minute','marketing-fixture-operator')`, assetID, s.cityID); err != nil {
		s.t.Fatalf("insert store-targeted discovery content: %v", err)
	}
	if _, err := postgres.ResolveDiscoveryContentTarget(s.ctx, s.db, "discovery_store_target_no_offer", s.cityID); !errors.Is(err, postgres.ErrDiscoveryContentNotFound) {
		s.t.Fatalf("store-targeted content without a visible offer must not resolve to a dead store: err=%v", err)
	}
	feed, err := postgres.ListDiscoveryContent(s.ctx, s.db, true, s.cityID)
	if err != nil || hasDiscoveryContent(feed, "discovery_store_target_no_offer") {
		s.t.Fatalf("store-targeted content without a visible offer must not be published to the public feed: feed=%+v err=%v", feed, err)
	}
}

func hasDiscoveryContent(items []postgres.DiscoveryContentRecord, id string) bool {
	for _, item := range items {
		if item.ID == id {
			return true
		}
	}
	return false
}

func (s *catalogRefoundationScenario) publishSecondStoreOffer() {
	s.t.Helper()
	insertCanonicalStoreFixture(s.t, s.ctx, s.db, canonicalStoreFixture{ID: "store_catalog_v2", PartnerActorID: testPartnerActorID, Name: "متجر القهوة الثاني", ServiceCityID: s.cityID, PrimaryVerticalID: s.verticalID, PublicationState: "published"})
	offerInput := postgres.CatalogOfferInput{StoreID: "store_catalog_v2", VariantID: s.variantID, PriceMinor: 1300, QuantityPolicy: "DISCRETE", QuantityMinBaseUnits: 1, QuantityMaxBaseUnits: 10, QuantityStepBaseUnits: 1, PricingBasis: "PER_UNIT", PricingUnitBaseUnits: 1}
	offer, err := postgres.CreateCatalogOffer(s.ctx, s.db, offerInput, "idem-offer-second-store-v1", postgres.HashCatalogOfferCreateRequest(offerInput), testPartnerActorID, "corr-offer-second-store-v1")
	if err != nil {
		s.t.Fatalf("create second published store offer: %v", err)
	}
	update := postgres.CatalogOfferUpdateInput{PriceMinor: 1300, Availability: true, PublicationState: "published", QuantityPolicy: "DISCRETE", QuantityMinBaseUnits: 1, QuantityMaxBaseUnits: 10, QuantityStepBaseUnits: 1, PricingBasis: "PER_UNIT", PricingUnitBaseUnits: 1}
	if _, err := postgres.UpdateCatalogOffer(s.ctx, s.db, offer.Offer.ID, update, 1, "idem-offer-second-store-publish-v1", postgres.HashCatalogOfferUpdateRequest(offer.Offer.ID, update, 1), testPartnerActorID, "corr-offer-second-store-publish-v1"); err != nil {
		s.t.Fatalf("publish second store offer: %v", err)
	}
	for index, store := range []string{"store_catalog_v1", "store_catalog_v2"} {
		latitude, longitude := 15.3+float64(index)/100, 44.1+float64(index)/100
		if _, err := postgres.SetStoreDeliveryOrigin(s.ctx, s.db, store, testPartnerActorID, latitude, longitude, 0, "idem-origin-"+store, postgres.HashStoreDeliveryOriginRequest(store, testPartnerActorID, latitude, longitude, 0), "corr-origin-"+store); err != nil {
			s.t.Fatalf("set discovery origin for %s: %v", store, err)
		}
	}
}

func (s *catalogRefoundationScenario) verifyPublicStoreDiscovery() {
	s.t.Helper()
	s.verifyPublishedStorePagination()
	publicStores, err := postgres.ListPublishedStorePage(s.ctx, s.db, postgres.PublicStoreListQuery{ServiceCityID: s.cityID, Sort: "newest", Limit: 10})
	if err != nil || len(publicStores.Stores) != 2 {
		s.t.Fatalf("published store discovery query failed: %+v err=%v", publicStores, err)
	}
	verticalStores, err := postgres.ListPublishedStorePage(s.ctx, s.db, postgres.PublicStoreListQuery{ServiceCityID: s.cityID, VerticalID: s.verticalID, Sort: "newest", Limit: 10})
	if err != nil || len(verticalStores.Stores) != 2 {
		s.t.Fatalf("published store vertical filter failed: %+v err=%v", verticalStores, err)
	}
	missingVerticalStores, err := postgres.ListPublishedStorePage(s.ctx, s.db, postgres.PublicStoreListQuery{ServiceCityID: s.cityID, VerticalID: "unavailable-vertical", Sort: "newest", Limit: 10})
	if err != nil || len(missingVerticalStores.Stores) != 0 {
		s.t.Fatalf("published store filter leaked a different vertical: %+v err=%v", missingVerticalStores, err)
	}
	publishedStore, err := postgres.ReadPublishedStore(s.ctx, s.db, "store_catalog_v1", s.cityID)
	if err != nil || publishedStore.ID != "store_catalog_v1" || len(publishedStore.CategoryIDs) != 1 || publishedStore.CategoryIDs[0] != s.categoryID {
		s.t.Fatalf("published store canonical readback failed: %+v err=%v", publishedStore, err)
	}
	discoveryCategories, err := postgres.ListPublicDiscoveryCategories(s.ctx, s.db, s.cityID)
	if err != nil || len(discoveryCategories) != 1 || discoveryCategories[0].ID != s.categoryID {
		s.t.Fatalf("public discovery categories failed: %+v err=%v", discoveryCategories, err)
	}
	discoveryVerticals, err := postgres.ListPublicDiscoveryVerticals(s.ctx, s.db, s.cityID)
	if err != nil || len(discoveryVerticals) != 1 || discoveryVerticals[0].ID != s.verticalID {
		s.t.Fatalf("public discovery vertical projection leaked internal routing or missed the vertical: %+v err=%v", discoveryVerticals, err)
	}
	publicSearch, err := postgres.SearchPublicCatalog(s.ctx, s.db, s.cityID, s.verticalID, s.categoryID, "قهوة", 10, "")
	if err != nil || len(publicSearch.Offers) != 2 || publicSearch.Offers[0].StoreID == publicSearch.Offers[1].StoreID {
		s.t.Fatalf("public catalog search failed: %+v err=%v", publicSearch, err)
	}
	publicSearchPage, err := postgres.SearchPublicCatalog(s.ctx, s.db, s.cityID, s.verticalID, s.categoryID, "قهوة", 1, "")
	if err != nil || len(publicSearchPage.Offers) != 1 || publicSearchPage.NextCursor == nil {
		s.t.Fatalf("public catalog search cursor setup failed: %+v err=%v", publicSearchPage, err)
	}
	if _, err := postgres.SearchPublicCatalog(s.ctx, s.db, s.cityID, "unavailable-vertical", s.categoryID, "قهوة", 1, *publicSearchPage.NextCursor); err == nil {
		s.t.Fatal("public catalog search cursor was reusable across vertical scopes")
	}
	wrongVerticalSearch, err := postgres.SearchPublicCatalog(s.ctx, s.db, s.cityID, "unavailable-vertical", s.categoryID, "قهوة", 10, "")
	if err != nil || len(wrongVerticalSearch.Offers) != 0 {
		s.t.Fatalf("public catalog search crossed its vertical scope: %+v err=%v", wrongVerticalSearch, err)
	}
}

func (s *catalogRefoundationScenario) verifyPublishedStorePagination() {
	s.t.Helper()
	newestPage, err := postgres.ListPublishedStorePage(s.ctx, s.db, postgres.PublicStoreListQuery{ServiceCityID: s.cityID, Sort: "newest", Limit: 1})
	if err != nil || len(newestPage.Stores) != 1 || newestPage.NextCursor == "" {
		s.t.Fatalf("published store newest first page failed: %+v err=%v", newestPage, err)
	}
	newestNext, err := postgres.ListPublishedStorePage(s.ctx, s.db, postgres.PublicStoreListQuery{ServiceCityID: s.cityID, Sort: "newest", Limit: 1, Cursor: newestPage.NextCursor})
	if err != nil || len(newestNext.Stores) != 1 || newestNext.NextCursor != "" || newestNext.Stores[0].ID == newestPage.Stores[0].ID {
		s.t.Fatalf("published store newest cursor failed: first=%+v second=%+v err=%v", newestPage, newestNext, err)
	}
	latitude, longitude := 15.3, 44.1
	nearestPage, err := postgres.ListPublishedStorePage(s.ctx, s.db, postgres.PublicStoreListQuery{ServiceCityID: s.cityID, Sort: "nearest", Limit: 1, Latitude: &latitude, Longitude: &longitude})
	if err != nil || len(nearestPage.Stores) != 1 || nearestPage.NextCursor == "" {
		s.t.Fatalf("published store nearest first page failed: %+v err=%v", nearestPage, err)
	}
	nearestNext, err := postgres.ListPublishedStorePage(s.ctx, s.db, postgres.PublicStoreListQuery{ServiceCityID: s.cityID, Sort: "nearest", Limit: 1, Cursor: nearestPage.NextCursor, Latitude: &latitude, Longitude: &longitude})
	if err != nil || len(nearestNext.Stores) != 1 || nearestNext.NextCursor != "" || nearestNext.Stores[0].ID == nearestPage.Stores[0].ID {
		s.t.Fatalf("published store nearest cursor failed: first=%+v second=%+v err=%v", nearestPage, nearestNext, err)
	}
}

func (s *catalogRefoundationScenario) verifyFavorites() {
	s.t.Helper()
	const clientID = "client_catalog_favorite_v1"
	favoriteStore, err := postgres.SetClientFavoriteStore(s.ctx, s.db, clientID, "store_catalog_v1", "add", "idem-favorite-store-v1", postgres.HashClientFavoriteStoreMutation("add", "store_catalog_v1"), "corr-favorite-store-v1")
	if err != nil || !favoriteStore.IsFavorite {
		s.t.Fatalf("favorite published store mutation failed: %+v err=%v", favoriteStore, err)
	}
	favoriteOffer, err := postgres.SetClientFavoriteStoreOffer(s.ctx, s.db, clientID, s.offerID, "add", "idem-favorite-offer-v1", postgres.HashClientFavoriteStoreOfferMutation("add", s.offerID), "corr-favorite-offer-v1")
	if err != nil || !favoriteOffer.IsFavorite {
		s.t.Fatalf("favorite customer-visible offer mutation failed: %+v err=%v", favoriteOffer, err)
	}
	favoriteCatalog, err := postgres.ReadPublicFavoriteStoreCatalog(s.ctx, s.db, "store_catalog_v1", s.cityID, clientID, 10, "")
	if err != nil || len(favoriteCatalog.Offers) != 1 || favoriteCatalog.Offers[0].ID != s.offerID {
		s.t.Fatalf("favorite store public catalog failed: %+v err=%v", favoriteCatalog, err)
	}
}

func (s *catalogRefoundationScenario) verifyProposalPagination() {
	s.t.Helper()
	for index, suffix := range []string{"first", "second"} {
		if _, err := s.db.ExecContext(s.ctx, `INSERT INTO dsh.catalog_product_proposals(id,partner_actor_id,submitter_role,submitter_actor_id,vertical_id,category_id,proposed_name,proposed_base_unit,created_at)
			VALUES($1,$2,'PARTNER',$2,$3,$4,$5,'COUNT',clock_timestamp()+($6::int * interval '1 second'))`, "proposal_"+suffix, testPartnerActorID, s.verticalID, s.categoryID, "اقتراح "+suffix, index); err != nil {
			s.t.Fatalf("insert catalog proposal fixture %s: %v", suffix, err)
		}
	}
	proposalPage, err := postgres.ListCatalogProductProposalsForPartner(s.ctx, s.db, testPartnerActorID, "", 1, "")
	if err != nil || len(proposalPage.Proposals) != 1 || proposalPage.NextCursor == "" {
		s.t.Fatalf("catalog proposal first page failed: %+v err=%v", proposalPage, err)
	}
	proposalNext, err := postgres.ListCatalogProductProposalsForPartner(s.ctx, s.db, testPartnerActorID, "", 1, proposalPage.NextCursor)
	if err != nil || len(proposalNext.Proposals) != 1 || proposalNext.NextCursor != "" || proposalNext.Proposals[0].ID == proposalPage.Proposals[0].ID {
		s.t.Fatalf("catalog proposal cursor failed: first=%+v second=%+v err=%v", proposalPage, proposalNext, err)
	}
	fieldProposalInput := postgres.CatalogProductProposalInput{
		ID: "proposal_field_null_owner_review", SubmitterRole: "FIELD", SubmitterActorID: "field-proposal-reviewer",
		JoiningCaseID: "joining_store_discovery_v1", VerticalID: s.verticalID, CategoryID: s.categoryID,
		ProposedName: "منتج مقترح من الميدان", ProposedVariantTitle: "عبوة واحدة", ProposedMeasurementKind: "DISCRETE", ProposedBaseUnit: "COUNT",
		AttributeValues: []postgres.CatalogAttributeValueInput{}, VariantAttributeValues: []postgres.CatalogAttributeValueInput{},
	}
	fieldProposal, err := postgres.CreateCatalogProductProposal(s.ctx, s.db, fieldProposalInput, "idem-field-proposal-v1", postgres.HashCatalogProductProposalCreateRequest(fieldProposalInput), testOperatorActorID, "corr-field-proposal-v1")
	if err != nil || fieldProposal.Proposal.PartnerActorID != "" || fieldProposal.Proposal.State != "draft" {
		s.t.Fatalf("create Field proposal with no Partner owner: %+v err=%v", fieldProposal, err)
	}
	submittedFieldProposal, err := postgres.SubmitCatalogProductProposal(s.ctx, s.db, fieldProposal.Proposal.ID, fieldProposal.Proposal.Version, "idem-field-proposal-submit-v1", postgres.HashCatalogProductProposalTransitionRequest(fieldProposal.Proposal.ID, fieldProposal.Proposal.Version), testOperatorActorID, "corr-field-proposal-submit-v1")
	if err != nil || submittedFieldProposal.Proposal.State != "submitted" {
		s.t.Fatalf("submit Field proposal with no Partner owner: %+v err=%v", submittedFieldProposal, err)
	}
	const reviewReason = "Catalog review rejected the Field proposal"
	reviewedFieldProposal, err := postgres.ReviewCatalogProductProposal(s.ctx, s.db, submittedFieldProposal.Proposal.ID, "rejected", reviewReason, submittedFieldProposal.Proposal.Version, "idem-field-proposal-review-v1", postgres.HashCatalogProductProposalReviewRequest(submittedFieldProposal.Proposal.ID, "rejected", reviewReason, submittedFieldProposal.Proposal.Version), testOperatorActorID, "corr-field-proposal-review-v1")
	if err != nil || reviewedFieldProposal.Proposal.State != "rejected" || reviewedFieldProposal.Proposal.PartnerActorID != "" {
		s.t.Fatalf("review Field proposal with nullable Partner owner: %+v err=%v", reviewedFieldProposal, err)
	}
}

func (s *catalogRefoundationScenario) verifyAdmissionPagination() {
	s.t.Helper()
	for index, suffix := range []string{"first", "second"} {
		phone := fmt.Sprintf("+967770010%03d", index+1)
		createdAt := time.Now().UTC().Add(time.Duration(index) * time.Second)
		if _, err := s.db.ExecContext(s.ctx, `INSERT INTO dsh.captain_admissions(id,contact_phone_e164,full_name_ar,state,created_at)
			VALUES($1,$2,$3,'pending_identity',$4)`, "captain_"+suffix, phone, "كابتن "+suffix, createdAt); err != nil {
			s.t.Fatalf("insert Captain admission fixture %s: %v", suffix, err)
		}
		if _, err := s.db.ExecContext(s.ctx, `INSERT INTO dsh.field_admissions(id,contact_phone_e164,full_name_ar,service_city_id,state,created_at)
			VALUES($1,$2,$3,$4,'pending_identity',$5)`, "field_"+suffix, fmt.Sprintf("+967770011%03d", index+1), "مندوب "+suffix, s.cityID, createdAt); err != nil {
			s.t.Fatalf("insert Field admission fixture %s: %v", suffix, err)
		}
	}
	captainPage, err := postgres.ListCaptainAdmissions(s.ctx, s.db, "", "all", "created_asc", 1, "")
	if err != nil || len(captainPage.Admissions) != 1 || captainPage.NextCursor == "" {
		s.t.Fatalf("Captain admission first page failed: %+v err=%v", captainPage, err)
	}
	captainNext, err := postgres.ListCaptainAdmissions(s.ctx, s.db, "", "all", "created_asc", 1, captainPage.NextCursor)
	if err != nil || len(captainNext.Admissions) != 1 || captainNext.NextCursor != "" || captainNext.Admissions[0].ID == captainPage.Admissions[0].ID {
		s.t.Fatalf("Captain admission cursor failed: first=%+v second=%+v err=%v", captainPage, captainNext, err)
	}
	fieldPage, err := postgres.ListFieldAdmissions(s.ctx, s.db, "", "all", "created_asc", 1, "")
	if err != nil || len(fieldPage.Admissions) != 1 || fieldPage.NextCursor == "" {
		s.t.Fatalf("Field admission first page failed: %+v err=%v", fieldPage, err)
	}
	fieldNext, err := postgres.ListFieldAdmissions(s.ctx, s.db, "", "all", "created_asc", 1, fieldPage.NextCursor)
	if err != nil || len(fieldNext.Admissions) != 1 || fieldNext.NextCursor != "" || fieldNext.Admissions[0].ID == fieldPage.Admissions[0].ID {
		s.t.Fatalf("Field admission cursor failed: first=%+v second=%+v err=%v", fieldPage, fieldNext, err)
	}
}
