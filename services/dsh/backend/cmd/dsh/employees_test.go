package main

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/discovery"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/identityaccess"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
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

func TestEmployeeDirectoryMountPostgres(t *testing.T) {
	if os.Getenv("BTHWANI_ISOLATED_TEST_MODE") != "true" || os.Getenv("DSH_EMPLOYEES_TEST") != "true" {
		t.Skip("requires explicitly isolated DSH PostgreSQL")
	}
	if os.Getenv("DSH_DB_HOST") != "127.0.0.1" || os.Getenv("REF_POSTGRES_DB") != "bthwani_refoundation" {
		t.Fatal("requires isolated loopback DSH database")
	}
	db, err := discovery.OpenFromEnvironment()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	suffix := make([]byte, 5)
	if _, err := rand.Read(suffix); err != nil {
		t.Fatal(err)
	}
	schema := "dsh_test_hr_mount_" + hex.EncodeToString(suffix)
	owner, err := discovery.New(db, schema)
	if err != nil {
		t.Fatal(err)
	}
	fallback := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusTeapot) })
	t.Setenv("DSH_ENABLE_ISOLATED_EMPLOYEES", "true")
	t.Setenv("DSH_IDENTITY_VERIFIER_URL", "http://127.0.0.1:3302")
	if _, err := isolatedEmployeeHandler(t.Context(), db, schema, "127.0.0.1:8080", fallback); err == nil || err.Error() != "isolated employee directory migration unavailable" {
		t.Fatalf("missing owner baseline accepted: %v", err)
	}
	if err := owner.BootstrapFresh(t.Context(), filepath.Join("..", "..", "..", "database", "schema")); err != nil {
		t.Fatal(err)
	}
	// A valid loopback listener does not permit an invalid Identity origin.
	t.Setenv("DSH_IDENTITY_VERIFIER_URL", "http://outside.invalid")
	if _, err := isolatedEmployeeHandler(t.Context(), db, schema, "127.0.0.1:8080", fallback); !errors.Is(err, identityaccess.ErrInvalidOrigin) {
		t.Fatalf("invalid Identity origin accepted: %v", err)
	}
	t.Setenv("DSH_IDENTITY_VERIFIER_URL", "http://127.0.0.1:3302")
	h, err := isolatedEmployeeHandler(t.Context(), db, schema, "127.0.0.1:8080", fallback)
	if err != nil {
		t.Fatal(err)
	}
	const id = "00000000-0000-4000-8000-000000000001"
	for _, path := range []string{"/v1/operators/employees", "/v1/operators/employees/" + id, "/v1/operators/employees/" + id + "/registration-audit", "/v1/stores/store-a/employees", "/v1/stores/store-a/employees/" + id, "/v1/stores/store-a/employees/" + id + "/registration-audit"} {
		t.Run(path, func(t *testing.T) {
			w := httptest.NewRecorder()
			h.ServeHTTP(w, httptest.NewRequest(http.MethodGet, path, nil))
			if w.Code != http.StatusUnauthorized || w.Header().Get("Cache-Control") != "no-store" {
				t.Fatalf("unprotected route: %d %v", w.Code, w.Header())
			}
		})
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/v1/public/unrelated", nil))
	if w.Code != http.StatusTeapot {
		t.Fatalf("fallback changed: %d", w.Code)
	}
	var employees, audits int
	if err := db.QueryRowContext(t.Context(), "SELECT (SELECT count(*) FROM "+schema+".employees), (SELECT count(*) FROM "+schema+".employee_registration_audit)").Scan(&employees, &audits); err != nil {
		t.Fatal(err)
	}
	if employees != 0 || audits != 0 {
		t.Fatal("anonymous requests wrote owner data")
	}
}
