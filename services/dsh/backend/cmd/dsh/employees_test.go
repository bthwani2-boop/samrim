package main

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/dbscope"
)

func TestEmployeeDirectoryExplicitIsolatedTransport(t *testing.T) {
	next := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusTeapot) })
	t.Setenv("DSH_ENABLE_ISOLATED_EMPLOYEES", "false")
	h, err := isolatedEmployeeHandler(t.Context(), nil, "dsh", "0.0.0.0:8080", next)
	if err != nil {
		t.Fatal(err)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/v1/stores/store-a/employees", nil))
	if w.Code != http.StatusTeapot {
		t.Fatalf("disabled route changed fallback: %d", w.Code)
	}

	t.Setenv("DSH_ENABLE_ISOLATED_EMPLOYEES", "true")
	for _, tc := range []struct {
		name, testMode, containerMode, schema, listen, verifier, dbHost, database string
		allowed                                                                   bool
	}{
		{"verified container", "true", "true", "dsh_test_employees", "0.0.0.0:8080", isolatedDSHVerifierURL, "postgres", dbscope.DevelopmentDatabase, true},
		{"verified loopback", "true", "", "dsh_test_employees", "127.0.0.1:8080", "http://127.0.0.1:3302", "", "", true},
		{"IPv6 loopback", "true", "", "dsh_test_employees", "[::1]:8080", "http://127.0.0.1:3302", "", "", true},
		{"missing isolation", "", "true", "dsh_test_employees", "0.0.0.0:8080", isolatedDSHVerifierURL, "postgres", dbscope.DevelopmentDatabase, false},
		{"missing container mode", "true", "", "dsh_test_employees", "0.0.0.0:8080", isolatedDSHVerifierURL, "postgres", dbscope.DevelopmentDatabase, false},
		{"protected schema", "true", "true", "dsh", "0.0.0.0:8080", isolatedDSHVerifierURL, "postgres", dbscope.DevelopmentDatabase, false},
		{"empty isolated schema suffix", "true", "true", "dsh_test_", "0.0.0.0:8080", isolatedDSHVerifierURL, "postgres", dbscope.DevelopmentDatabase, false},
		{"wrong port", "true", "true", "dsh_test_employees", "0.0.0.0:8081", isolatedDSHVerifierURL, "postgres", dbscope.DevelopmentDatabase, false},
		{"wrong verifier", "true", "true", "dsh_test_employees", "0.0.0.0:8080", "https://outside.example", "postgres", dbscope.DevelopmentDatabase, false},
		{"wrong database host", "true", "true", "dsh_test_employees", "0.0.0.0:8080", isolatedDSHVerifierURL, "outside.example", dbscope.DevelopmentDatabase, false},
		{"protected database", "true", "true", "dsh_test_employees", "0.0.0.0:8080", isolatedDSHVerifierURL, "postgres", "production", false},
		{"wildcard shorthand", "true", "true", "dsh_test_employees", ":8080", isolatedDSHVerifierURL, "postgres", dbscope.DevelopmentDatabase, false},
		{"protected loopback schema", "true", "", "dsh", "127.0.0.1:8080", "http://127.0.0.1:3302", "", "", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("BTHWANI_ISOLATED_TEST_MODE", tc.testMode)
			t.Setenv("BTHWANI_ISOLATED_CONTAINER_MODE", tc.containerMode)
			t.Setenv("DSH_IDENTITY_VERIFIER_URL", tc.verifier)
			t.Setenv("DSH_DB_HOST", tc.dbHost)
			t.Setenv("REF_POSTGRES_DB", tc.database)
			// No live database is supplied. An admitted transport must still fail
			// independently at the owner's mandatory database/Identity readiness guard.
			_, err := isolatedEmployeeHandler(t.Context(), nil, tc.schema, tc.listen, next)
			const ownerGuard = "employee directory requires an isolated DSH schema and Identity"
			if err == nil {
				t.Fatal("nil database was admitted")
			}
			if (err.Error() == ownerGuard) != tc.allowed {
				t.Fatalf("unexpected transport admission (allowed=%t): %v", tc.allowed, err)
			}
		})
	}
}
