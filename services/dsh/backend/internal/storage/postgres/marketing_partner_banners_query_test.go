package postgres

import (
	"strings"
	"testing"
)

// Canonical scan columns and destination eligibility must remain identical
// after switching the public banner queries to compile-time SQL literals.
func TestPartnerStoreBannerStaticQueriesMatchCanonicalReadbacks(t *testing.T) {
	for name, query := range map[string]string{
		"page":      partnerBannerPageSQL,
		"published": publishedStoreBannerSQL,
		"owned":     partnerBannerOwnedReadSQL,
	} {
		if !strings.HasPrefix(query, "SELECT "+discoveryContentSelect) {
			t.Errorf("%s query projection drifted from scanDiscoveryContent", name)
		}
	}
	// This is still the one canonical Discovery Content banner reader, not
	// a parallel banner registry. Marketplace and independent website channels
	// must remain disjoint, and independent banners may link only to that Store.
	for _, required := range []string{
		"$3='' AND store.publication_state='published'",
		"store.relation_model='BTHWANI_PARTNER'",
		"$3<>'' AND store.relation_model='INDEPENDENT_STORE'",
		"content.target_type='STORE' AND content.target_id=content.source_store_id",
		"content.partner_enabled=true",
		"content.state='PUBLISHED'",
		"asset.rights_attested_at IS NOT NULL",
	} {
		if !strings.Contains(publishedStoreBannerSQL, required) {
			t.Errorf("missing Store banner channel/publication gate: %s", required)
		}
	}
	if !strings.Contains(publishedStoreBannerSQL, "ORDER BY content.ordinal") {
		t.Fatal("Store banner ordering changed")
	}
}
