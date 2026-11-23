package main

import (
	"context"
	"database/sql"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/discovery"
)

func TestStoreAvailabilityContainerTransportRequiresExplicitVerifiedBoundary(t *testing.T) {
	good := map[string]string{
		"BTHWANI_ISOLATED_CONTAINER_MODE": "true",
		"DSH_IDENTITY_VERIFIER_URL":       isolatedDSHVerifierURL,
		"DSH_DB_HOST":                     "postgres",
		"REF_POSTGRES_DB":                 "bthwani_refoundation",
	}
	get := func(name string) string { return good[name] }
	if !isolatedAvailabilityTransport("0.0.0.0:8080", get) {
		t.Fatal("admitted container transport refused")
	}
	for _, addr := range []string{":8080", "0.0.0.0:9090", "192.168.1.10:8080", "[::]:8080", ""} {
		if isolatedAvailabilityTransport(addr, get) {
			t.Fatalf("unsafe listener %q admitted", addr)
		}
	}
	for _, key := range []string{"BTHWANI_ISOLATED_CONTAINER_MODE", "DSH_IDENTITY_VERIFIER_URL", "DSH_DB_HOST", "REF_POSTGRES_DB"} {
		saved := good[key]
		good[key] = "untrusted"
		if isolatedAvailabilityTransport("0.0.0.0:8080", get) {
			t.Fatalf("untrusted %s admitted", key)
		}
		good[key] = saved
	}
	if !isolatedAvailabilityTransport("127.0.0.1:8080", func(string) string { return "" }) {
		t.Fatal("existing loopback mode regressed")
	}
	for k, v := range good {
		t.Setenv(k, v)
	}
	t.Setenv("BTHWANI_ISOLATED_TEST_MODE", "true")
	t.Setenv("DSH_ENABLE_ISOLATED_STORE_AVAILABILITY", "true")
	t.Setenv("DSH_LISTEN_ADDR", "0.0.0.0:8080")
	public := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(204) })
	if _, err := isolatedStoreAvailabilityHandler(nil, "dsh_test_availability", public, nil); err == nil {
		t.Fatal("unverified owner database admitted")
	}
	t.Setenv("DSH_ENABLE_ISOLATED_STORE_AVAILABILITY", "false")
	h, err := isolatedStoreAvailabilityHandler(nil, "dsh", public, nil)
	if err != nil {
		t.Fatal(err)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", "/v1/stores/store-a/availability", nil))
	if w.Code != 204 {
		t.Fatal("disabled path unexpectedly mounted")
	}
}

// The fixture runs in a network-disabled, no-volume PostgreSQL container.
// No shared or retained database may be used for this test.
func TestStoreAvailabilityContainerOwnerRealPostgres(t *testing.T) {
	raw := os.Getenv("BTHWANI_DSH_AVAILABILITY_TEST_DATABASE_URL")
	if raw == "" {
		t.Skip("NOT_RUN: isolated availability container PostgreSQL not configured")
	}
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "postgres" || u.Host != "127.0.0.1:5432" || u.User == nil ||
		u.User.Username() != "bthwani_ci" || u.Path != "/bthwani_refoundation" || u.RawQuery != "sslmode=disable" ||
		u.Fragment != "" || u.Opaque != "" || u.RawPath != "" || os.Getenv("PGHOSTADDR") != "" ||
		os.Getenv("BTHWANI_DSH_AVAILABILITY_TEST_CONTAINER") != "bthwani-availability-container-proof" ||
		os.Getenv("BTHWANI_ISOLATED_TEST_MODE") != "true" {
		t.Fatal("refusing non-isolated fixture")
	}
	db, err := sql.Open("postgres", raw)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	var name, role string
	if err = db.QueryRowContext(ctx, "SELECT current_database(),current_user").Scan(&name, &role); err != nil || name != "bthwani_refoundation" || role != "bthwani_ci" {
		t.Fatal("fixture identity mismatch")
	}
	schema := fmt.Sprintf("dsh_test_avail_%x", time.Now().UnixNano())
	if err = verifyAvailabilityContainerDatabase(ctx, db, schema); err == nil {
		t.Fatal("absent namespace admitted")
	}
	owner, err := discovery.New(db, schema)
	if err != nil {
		t.Fatal(err)
	}
	if err = owner.BootstrapFresh(ctx, filepath.Join("..", "..", "..", "database", "schema")); err != nil {
		t.Fatal(err)
	}
	defer db.ExecContext(context.Background(), "DROP SCHEMA IF EXISTS "+schema+" CASCADE")
	if err = verifyAvailabilityContainerDatabase(ctx, db, schema); err != nil {
		t.Fatal(err)
	}
	if err = verifyAvailabilityContainerDatabase(ctx, db, "public"); err == nil {
		t.Fatal("unscoped database admitted")
	}
	t.Setenv("BTHWANI_ISOLATED_CONTAINER_MODE", "true")
	t.Setenv("DSH_IDENTITY_VERIFIER_URL", isolatedDSHVerifierURL)
	t.Setenv("DSH_DB_HOST", "postgres")
	t.Setenv("REF_POSTGRES_DB", "bthwani_refoundation")
	t.Setenv("DSH_ENABLE_ISOLATED_STORE_AVAILABILITY", "true")
	t.Setenv("DSH_LISTEN_ADDR", "0.0.0.0:8080")
	h, err := isolatedStoreAvailabilityHandler(db, schema, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(204) }), nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{"/v1/stores/store-a/availability", "/v1/operators/cities/sanaa/store-availability-policy", "/v1/operators/cities/sanaa/store-availability-policy/history"} {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest("GET", path, nil))
		if w.Code != 401 || w.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("protected route %s status=%d", path, w.Code)
		}
	}
	// Remove only a synthetic fixture table to prove fail-closed on incomplete owner schema.
	if _, err = db.ExecContext(ctx, "DROP TABLE "+schema+".store_operational_limits_audit CASCADE"); err != nil {
		t.Fatal(err)
	}
	if err = verifyAvailabilityContainerDatabase(ctx, db, schema); err == nil {
		t.Fatal("incomplete owner schema admitted")
	}
}
