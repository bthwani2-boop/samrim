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
