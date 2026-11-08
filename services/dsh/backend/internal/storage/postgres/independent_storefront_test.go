package postgres

import (
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

func TestIndependentStoreMediaURIEligibilityMatchesStoreCatalogAndCheckout(t *testing.T) {
	storeBytes, err := os.ReadFile("independent_storefront.go")
	if err != nil {
		t.Fatal(err)
	}
	orderBytes, err := os.ReadFile("independent_direct_order.go")
	if err != nil {
		t.Fatal(err)
	}
	storeSource := string(storeBytes)
	orderSource := string(orderBytes)
	storeReaderStart := strings.Index(storeSource, "func ReadPublishedIndependentStore(")
	catalogStart := strings.Index(storeSource, "func listPublishedIndependentOffersInternal(")
	catalogEnd := strings.Index(storeSource, "// IndependentPublicOffer")
	if storeReaderStart < 0 || catalogStart <= storeReaderStart || catalogEnd <= catalogStart {
		t.Fatal("independent public Store and Catalog source boundaries changed")
	}
	publicStoreSQL := storeSource[storeReaderStart:catalogStart]
	publicCatalogSQL := storeSource[catalogStart:catalogEnd]
	const mediaNotBlank = "NULLIF(btrim(asset.uri),'') IS NOT NULL"
	const eligibleMediaNotBlank = "NULLIF(btrim(a.uri),'') IS NOT NULL"
	if got := strings.Count(publicStoreSQL, mediaNotBlank); got != 2 {
		t.Errorf("public Store should require nonblank profile and cover URIs: %d guards", got)
	}
	if got := strings.Count(publicCatalogSQL, eligibleMediaNotBlank); got != 2 {
		t.Errorf("public Catalog must recheck both Store media URIs: %d guards", got)
	}
	if got := strings.Count(orderSource, eligibleMediaNotBlank); got != 2 {
		t.Errorf("locked Direct Order must independently recheck both Store media URIs: %d guards", got)
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

func TestIndependentCatalogAndCheckoutNeverReferenceNonexistentOfferDeletedAt(t *testing.T) {
	// A real isolated PostgreSQL execution caught this historical alias error:
	// dsh.catalog_store_offers has no deleted_at; dsh.catalog_products does.
	// Keep both query builders aligned to the canonical Catalog schema.
	for _, file := range []string{"independent_storefront.go", "independent_direct_order.go"} {
		source, err := os.ReadFile(file)
		if err != nil {
			t.Fatal(err)
		}
		if strings.Contains(string(source), "o.deleted_at") {
			t.Errorf("%s refers to nonexistent catalog_store_offers.deleted_at", file)
		}
		if !strings.Contains(string(source), "p.deleted_at IS NULL") {
			t.Errorf("%s must retain canonical deleted Product suppression", file)
		}
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

func TestIndependentPublicCatalogNeverAdvertisesUnquoteableAmountRange(t *testing.T) {
	// Independent public Store eligibility and the paginated Catalog share
	// this SQL filter. Direct Order checks prices using int64 arithmetic.
	// A listing must not promise quantities that its server writer rejects.
	for _, predicate := range []string{
		"o.price_minor > 0",
		"o.pricing_unit_base_units=1",
		"o.quantity_min_base_units > 0",
		"o.quantity_max_base_units >= o.quantity_min_base_units",
		"o.price_minor::numeric * o.quantity_max_base_units::numeric <= 9223372036854775807",
	} {
		if !strings.Contains(independentDirectBuyableOfferSQL, predicate) {
			t.Errorf("independent public listing would advertise unquoteable price/quantity without %q", predicate)
		}
	}
	// These are independent checks at the canonical server-quote owner,
	// not assertions about the literal SQL formatting.
	for _, tc := range []struct {
		name     string
		price    int64
		quantity int64
		ok       bool
	}{
		{name: "small payable range", price: 600, quantity: 5, ok: true},
		{name: "zero price unavailable for direct order", price: 0, quantity: 1},
		{name: "max quantity overflows int64 subtotal", price: 9223372036854775807, quantity: 2},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := independentLineAmount(tc.price, tc.quantity, 1)
			if (err == nil) != tc.ok {
				t.Fatalf("server quote price=%d quantity=%d err=%v, want valid=%v", tc.price, tc.quantity, err, tc.ok)
			}
		})
	}
}
