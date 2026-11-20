package main

import (
	"net/http"
	"testing"
)

func TestMerchantStandingRejectsNonIsolatedOrUntrustedConfiguration(t *testing.T) {
	t.Setenv("DSH_ENABLE_ISOLATED_MERCHANT_STANDING", "true")
	t.Setenv("BTHWANI_ISOLATED_TEST_MODE", "true")
	t.Setenv("BTHWANI_ISOLATED_CONTAINER_MODE", "true")
	t.Setenv("DSH_IDENTITY_VERIFIER_URL", isolatedMerchantVerifier)
	fallback := http.NotFoundHandler()
	for _, tc := range []struct{ schema, listen, container, origin string }{
		{"dsh", "0.0.0.0:8080", "true", isolatedMerchantVerifier},
		{"dsh_test_abc", ":8080", "true", isolatedMerchantVerifier},
		{"dsh_test_abc", "0.0.0.0:8080", "", isolatedMerchantVerifier},
		{"dsh_test_abc", "0.0.0.0:8080", "true", "http://identity:3302"},
	} {
		t.Setenv("BTHWANI_ISOLATED_CONTAINER_MODE", tc.container)
		t.Setenv("DSH_IDENTITY_VERIFIER_URL", tc.origin)
		if _, err := isolatedMerchantStandingHandler(nil, tc.schema, tc.listen, fallback); err == nil {
			t.Fatalf("accepted invalid Merchant standing configuration: %+v", tc)
		}
	}
}
