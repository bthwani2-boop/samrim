package storeavailability

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestStoreRegistrationPolicyHistoryParamsRejectUnsafeSelectors(t *testing.T) {
	for _, tc := range []struct {
		query  string
		limit  int
		before int64
		ok     bool
	}{
		{"", 20, 0, true},
		{"limit=10&beforeVersion=23", 10, 23, true},
		{"beforeVersion=2", 20, 2, true},
		{"limit=50", 50, 0, true},
		{"limit=0", 0, 0, false},
		{"limit=51", 0, 0, false},
		{"limit=-1", 0, 0, false},
		{"limit=01", 0, 0, false},
		{"beforeVersion=0", 0, 0, false},
		{"beforeVersion=0003", 0, 0, false},
		{"beforeVersion=9223372036854775808", 0, 0, false},
		{"limit=1&limit=2", 0, 0, false},
		{"actorId=other", 0, 0, false},
		{"limit=1&role=owner", 0, 0, false},
		{"beforeVersion=%ZZ", 0, 0, false},
		{"limit=+2", 0, 0, false},
	} {
		t.Run(strings.ReplaceAll(tc.query, "=", "_"), func(t *testing.T) {
			limit, before, ok := storeRegistrationPolicyHistoryParams(tc.query)
			if ok != tc.ok || (ok && (limit != tc.limit || before != tc.before)) {
				t.Fatalf("params(%q) => %d %d %v; expected %d %d %v",
					tc.query, limit, before, ok, tc.limit, tc.before, tc.ok)
			}
		})
	}
}

func TestStoreRegistrationPolicyHistoryReadEnforcesOperatorScope(t *testing.T) {
	path := "/v1/operators/cities/sanaa/store-registration-policy/DIRECT/history"
	for _, tc := range []struct {
		name     string
		identity IdentitySessions
		path     string
		bearer   bool
		status   int
	}{
		{"missing token", fakeIdentity{actor: VerifiedActor{Subject: "operator-a", Role: OperatorRole}}, path, false, 401},
		{"customer", fakeIdentity{actor: VerifiedActor{Subject: "customer-a", Role: "customer"}}, path, true, 403},
		{"merchant", fakeIdentity{actor: VerifiedActor{Subject: "merchant-a", Role: MerchantRole}}, path, true, 403},
		{"missing policy right", fakeIdentity{actor: VerifiedActor{Subject: "operator-a", Role: OperatorRole}, permissionDenied: true}, path, true, 403},
		{"identity down", unavailableIdentitySessionAdapter{}, path, true, 503},
		{"cross-city", fakeIdentity{}, "/v1/operators/cities/INVALID/store-registration-policy/DIRECT/history", true, 400},
		{"invalid relation", fakeIdentity{}, "/v1/operators/cities/sanaa/store-registration-policy/OTHER/history", true, 400},
		{"malformed cursor", fakeIdentity{}, path + "?limit=2&beforeVersion=0", true, 400},
		{"unauthorized extra query", fakeIdentity{}, path + "?limit=2&actorId=other", true, 400},
	} {
		t.Run(tc.name, func(t *testing.T) {
			service := &MerchantStoreRegistrar{identity: tc.identity, grants: &PostgresStoreGrants{}}
			handler, err := NewStoreRegistrationPolicyHandler(service)
			if err != nil {
				t.Fatal(err)
			}
			req := httptest.NewRequest(http.MethodGet, tc.path, nil)
			if tc.bearer {
				req.Header.Set("Authorization", "Bearer synthetic")
			}
			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, req)
			if rec.Code != tc.status {
				t.Fatalf("status %d expected %d: %s", rec.Code, tc.status, rec.Body.String())
			}
			if rec.Header().Get("Cache-Control") != "no-store" && rec.Code != http.StatusMethodNotAllowed {
				t.Fatal("audit response must never be cacheable")
			}
		})
	}
}
