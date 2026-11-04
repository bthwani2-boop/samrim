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
	predicate := discoveryContentTargetEligibilityPredicate("content", "$2", "statement_timestamp()")
	if predicate == "FALSE" || !strings.Contains(publishedStoreBannerSQL, "AND "+predicate+" ORDER BY") {
		t.Fatal("published Store banner target eligibility drifted from canonical policy")
	}
}
