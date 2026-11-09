package postgres

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
)

// Regression for the old three-query public Store projection: publication,
// owner-reviewed terms and media may change between independent SQL snapshots.
// The public response must obtain both rights-attested images in its one
// publication query, rather than re-reading media after eligibility checking.
// Full SQL execution is verified separately by guarded isolated PostgreSQL QA.
func TestIndependentPublishedStoreMediaSingleSnapshotGuard(t *testing.T) {
	source, err := os.ReadFile("independent_storefront.go")
	if err != nil {
		t.Fatal(err)
	}
	all := string(source)
	start := strings.Index(all, "func ReadPublishedIndependentStore(")
	end := strings.Index(all, "// ListPublishedIndependentOffers")
	if start < 0 || end <= start {
		t.Fatal("independent published Store reader could not be located")
	}
	reader := all[start:end]
	if strings.Count(reader, "JOIN LATERAL (") != 2 {
		t.Fatal("published Store must select profile and cover media in the same SQL snapshot")
	}
	if strings.Count(reader, "db.QueryRowContext(") != 1 ||
		strings.Contains(reader, "ReadStoreProfileMedia(") ||
		strings.Contains(reader, "ReadStoreCoverMedia(") {
		t.Fatal("published Store reader must not fetch media in separate SQL statements")
	}
	for _, required := range []string{
		"asset.media_role='primary'",
		"asset.media_role='cover'",
		"asset.store_id=s.id",
		"asset.state='active'",
		"asset.rights_attested_at IS NOT NULL",
		"profile_media.uri,cover_media.uri",
		"&result.ProfileImageURI, &result.CoverImageURI",
	} {
		if !strings.Contains(reader, required) {
			t.Errorf("published Store could leak absent/private media without %q", required)
		}
	}
}

// Website publication and purchase acceptance are different DSH capabilities.
// A reviewed Store with an empty Catalog is a valid read-only public website.
func TestIndependentPublicWebsitePublicationDoesNotRequireCheckoutOrProducts(t *testing.T) {
	source, err := os.ReadFile("independent_storefront.go")
	if err != nil {
		t.Fatal(err)
	}
	all := string(source)
	start := strings.Index(all, "func readPublishedIndependentStoreWithQueryer(")
	endOffset := strings.Index(all[start:], "func independentCatalogCursorScope(")
	end := start + endOffset
	if start < 0 || end <= start {
		t.Fatal("public Store gate bounds changed")
	}
	reader := all[start:end]
	for _, required := range []string{
		"p.state='PUBLISHED_INDEPENDENT'",
		"p.review_state='PASSED'",
		"p.terms_accepted_at IS NOT NULL",
		"cp.review_state='PASSED'",
		"cp.published_at IS NOT NULL",
		"store_profile_media_assets",
		"store_public_contacts",
	} {
		if !strings.Contains(reader, required) {
			t.Errorf("missing legal/publication/media boundary: %s", required)
		}
	}
	for _, forbidden := range []string{
		"'CUSTOMER_PICKUP'=ANY",
		"catalog_store_offers",
		"catalog_publishable_offers",
		"independentWebOfferPresentationSQL",
	} {
		if strings.Contains(reader, forbidden) {
			t.Errorf("public website is incorrectly gated on Checkout/Catalog readiness: %s", forbidden)
		}
	}
}

func TestIndependentStoreMediaEligibilityIsCheckedOncePerPublicationSnapshot(t *testing.T) {
	storeBytes, err := os.ReadFile("independent_storefront.go")
	if err != nil {
		t.Fatal(err)
	}
	storeSource := string(storeBytes)
	storeReaderStart := strings.Index(storeSource, "func ReadPublishedIndependentStore(")
	catalogStart := strings.Index(storeSource, "func listPublishedIndependentOffersInternal(")
	catalogEnd := strings.Index(storeSource, "// IndependentPublicOffer")
	if storeReaderStart < 0 || catalogStart <= storeReaderStart || catalogEnd <= catalogStart {
		t.Fatal("independent public Store and Catalog source boundaries changed")
	}
	publicStoreSQL := storeSource[storeReaderStart:catalogStart]
	publicCatalogSQL := storeSource[catalogStart:catalogEnd]
	const mediaNotBlank = "NULLIF(btrim(asset.uri),'') IS NOT NULL"
	if got := strings.Count(publicStoreSQL, mediaNotBlank); got != 2 {
		t.Errorf("public Store should require nonblank profile and cover URIs: %d guards", got)
	}
	if !strings.Contains(publicCatalogSQL, "readPublishedIndependentStoreWithQueryer(ctx, tx, storeID, approvedLegalTermsVersion)") ||
		!strings.Contains(publicCatalogSQL, "WHERE o.store_id=$1") ||
		!strings.Contains(publicCatalogSQL, "independentWebOfferPresentationSQL") {
		t.Fatal("Catalog must use a Store-authorized, Store-scoped product query within one snapshot")
	}
	if strings.Contains(publicCatalogSQL, "JOIN dsh.independent_store_publications") ||
		strings.Contains(publicCatalogSQL, "store_profile_media_assets") ||
		strings.Contains(publicCatalogSQL, "independent_store_customer_policies") {
		t.Fatal("Catalog query must not recreate DSH publication, media or legal gate machinery")
	}
}

func TestIndependentPublicCatalogUsesOneReadOnlyRepeatableSnapshot(t *testing.T) {
	b, err := os.ReadFile("independent_storefront.go")
	if err != nil {
		t.Fatal(err)
	}
	source := string(b)
	start := strings.Index(source, "func listPublishedIndependentOffersInternal(")
	end := strings.Index(source, "// IndependentPublicOffer")
	if start < 0 || end <= start {
		t.Fatal("cannot locate independent public Catalog reader")
	}
	reader := source[start:end]
	for _, required := range []string{
		"db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})",
		"readPublishedIndependentStoreWithQueryer(ctx, tx, storeID, approvedLegalTermsVersion)",
		"store.ServiceCityID != expectedCityID",
		"tx.QueryContext(ctx, query, args...)",
		"hydrateCatalogOfferPage(ctx, tx, page.Offers)",
		"tx.Commit()",
	} {
		if !strings.Contains(reader, required) {
			t.Errorf("public Catalog no longer reads one consistent read-only snapshot: missing %q", required)
		}
	}
	if strings.Contains(reader, "ReadPublishedIndependentStore(ctx, db") ||
		strings.Contains(reader, "hydrateCatalogOfferPage(ctx, db") {
		t.Fatal("public Catalog must not bypass its read-only snapshot for authorization or media")
	}
}

func TestIndependentCatalogNeverReferencesNonexistentOfferDeletedAt(t *testing.T) {
	storeBytes, err := os.ReadFile("independent_storefront.go")
	if err != nil {
		t.Fatal(err)
	}
	storeSource := string(storeBytes)
	// A real isolated PostgreSQL execution caught this historical alias error:
	// dsh.catalog_store_offers has no deleted_at; dsh.catalog_products does.
	// Keep both query builders aligned to the canonical Catalog schema.
	if strings.Contains(storeSource, "o.deleted_at") ||
		!strings.Contains(storeSource, "dsh.catalog_publishable_offers") {
		t.Fatal("independent public Catalog must reuse the canonical publishable-offer view for product soft-deletion and never refer to an Offer deleted_at")
	}
	catalogSchema, err := os.ReadFile("migrations/010_central_catalog_refoundation.sql")
	if err != nil {
		t.Fatal(err)
	}
	begin := strings.Index(string(catalogSchema), "CREATE TABLE dsh.catalog_store_offers (")
	end := strings.Index(string(catalogSchema), "CREATE INDEX catalog_store_offers_store_idx")
	if begin < 0 || end <= begin {
		t.Fatal("canonical Store Offer table schema cannot be located")
	}
	if strings.Contains(string(catalogSchema)[begin:end], "deleted_at") {
		t.Fatal("canonical Store Offer schema changed: review eligibility SQL against migrations")
	}
	trashMigration, err := os.ReadFile("migrations/111_catalog_product_recycle_bin.sql")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(trashMigration), "ALTER TABLE dsh.catalog_products") ||
		!strings.Contains(string(trashMigration), "ADD COLUMN deleted_at") {
		t.Fatal("canonical Catalog Product soft-deletion authority moved")
	}
}

func TestIndependentPublicCatalogReusesCanonicalPublishableOfferVisibility(t *testing.T) {
	// The catalog/view owner controls activity, quantity, price and inventory
	// admission. Website presentation adds only unsupported visual constraints.
	for _, required := range []string{
		"dsh.catalog_publishable_offers",
		"o.currency='YER'",
	} {
		if !strings.Contains(independentWebOfferPresentationSQL, required) {
			t.Errorf("independent public reader must reuse the canonical Catalog and its narrow presentation rules: %q", required)
		}
	}
	for _, duplicate := range []string{
		"o.publication_state='published'",
		"o.availability=true",
		"o.price_minor > 0",
		"o.inventory_policy='AVAILABILITY_ONLY'",
		"o.quantity_min_base_units > 0",
		"o.pricing_basis='PER_UNIT'",
		"o.quantity_max_base_units >= o.quantity_min_base_units",
		"p.deleted_at IS NULL",
	} {
		if strings.Contains(independentWebOfferPresentationSQL, duplicate) {
			t.Errorf("duplicate Catalog ownership in independent website SQL: %q", duplicate)
		}
	}
	source, err := os.ReadFile("independent_storefront.go")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(source), "BaseUnit: offer.Variant.BaseUnit") ||
		!strings.Contains(string(source), "PricingUnitBaseUnits: offer.PricingUnitBaseUnits") {
		t.Fatal("independent public offers must expose canonical price units, not invent their own")
	}
	if strings.Contains(independentWebOfferPresentationSQL, "catalog_store_offer_modifier_groups") {
		t.Fatal("published Store must not suppress offers merely for having modifiers")
	}
	for _, tc := range []struct {
		price, quantity int64
		allowed         bool
	}{
		{600, 5, true},
		{0, 1, false},
		{9223372036854775807, 2, false},
	} {
		_, err := CalculateCatalogLineAmount(tc.price, tc.quantity, "PER_UNIT", 1)
		if (err == nil) != tc.allowed {
			t.Errorf("canonical price calculation changed: price=%d quantity=%d err=%v", tc.price, tc.quantity, err)
		}
	}
}

func TestIndependentPublishedProjectionStripsPrivateCategoryAndUnavailableOptions(t *testing.T) {
	minimum, maximum, step := int64(1), int64(5), int64(1)
	page := CatalogStoreOfferPage{
		Categories: []CatalogCategoryRecord{
			{ID: "category-1", NameAr: "Public", Active: true, Version: 91, ImageURI: "private-object-key"},
			{ID: "category-2", NameAr: "Draft", Active: false},
		},
		Offers: []CatalogStoreOfferRecord{{
			ID: "offer-1", Product: CatalogProductRecord{ID: "product-1", CanonicalName: "Product"},
			VariantID: "variant-1", Variant: CatalogVariantRecord{Title: "Unit", BaseUnit: "COUNT"},
			PriceMinor: 1500, Currency: "YER", PricingBasis: "PER_UNIT", PricingUnitBaseUnits: 1,
			QuantityMinBaseUnits: &minimum, QuantityMaxBaseUnits: &maximum, QuantityStepBaseUnits: &step,
			ModifierGroups: []CatalogModifierGroupRecord{{
				ID: "group-1", NameAr: "Options", Active: true, MaxSelections: 1,
				Options: []CatalogModifierOptionRecord{
					{ID: "option-1", NameAr: "Visible", PriceDeltaMinor: 100, Availability: true},
					{ID: "option-2", NameAr: "Hidden", PriceDeltaMinor: 500, Availability: false},
				},
			}, {ID: "group-draft", NameAr: "Internal", Active: false}},
		}},
	}
	result, err := projectIndependentPublicOffers(page)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Categories) != 1 || result.Categories[0].ID != "category-1" ||
		len(result.Offers) != 1 || len(result.Offers[0].ModifierGroups) != 1 ||
		len(result.Offers[0].ModifierGroups[0].Options) != 1 ||
		result.Offers[0].ModifierGroups[0].Options[0].ID != "option-1" {
		t.Fatalf("public-only category/modifier projection failed: %+v", result)
	}
	encoded, err := json.Marshal(result)
	if err != nil {
		t.Fatal(err)
	}
	for _, private := range []string{"private-object-key", "Hidden", "Internal", "Draft", "inventoryOnHand", "version", "partnerActorId"} {
		if strings.Contains(string(encoded), private) {
			t.Fatalf("public projection leaked private fact %q", private)
		}
	}
}
