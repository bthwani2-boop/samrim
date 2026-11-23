package discovery

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSchemaIdentifierRejectsSQLInjectionAndCrossSchemaLookup(t *testing.T) {
	valid := []string{"dsh_test_agent01", "a", "dsh_test_20261114"}
	for _, schema := range valid {
		owner, err := New(nil, schema)
		if err != nil || owner.Schema != schema {
			t.Errorf("valid schema %q rejected: %v", schema, err)
		}
	}
	invalid := []string{
		"", "0schema", "_schema", "public.stores", "a-b", "a b",
		"public; DROP TABLE stores", "foo'bar", "foo\"bar", "foo\nSET ROLE other",
		"FOO", strings.Repeat("a", 64),
	}
	for _, schema := range invalid {
		if _, err := New(nil, schema); err == nil {
			t.Errorf("unsafe schema %q accepted", schema)
		}
	}
}

func TestBootstrapDeniedOutsideIsolatedDSHOwner(t *testing.T) {
	// A public Go entrypoint must not rely solely on cmd/dsh flags for isolation.
	db, err := sql.Open("postgres", "host=127.0.0.1 port=1 user=unused dbname=unused sslmode=disable connect_timeout=1")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	for _, tc := range []struct {
		schema, enabled string
	}{
		{"public", "true"},
		{"dsh", "true"},
		{"identity_test_fixture", "true"},
		{"dsh_test_", "true"},
		{"dsh_test_fixture", "false"},
	} {
		t.Run(tc.schema+"_"+tc.enabled, func(t *testing.T) {
			t.Setenv("BTHWANI_ISOLATED_TEST_MODE", tc.enabled)
			owner, err := New(db, tc.schema)
			if err != nil {
				t.Fatal(err)
			}
			if err := owner.BootstrapFresh(context.Background(), filepath.Join("..", "..", "..", "database", "schema")); err == nil || !strings.Contains(err.Error(), "isolated owner") {
				t.Fatalf("unauthorized bootstrap must fail before SQL execution, got %v", err)
			}
			if err := owner.ImportSynthetic(context.Background()); err == nil || !strings.Contains(err.Error(), "isolated DSH test schema") {
				t.Fatalf("unauthorized synthetic import must fail before SQL execution, got %v", err)
			}
		})
	}
}

func TestPublicStoreIdentifierRejectsRouteInjection(t *testing.T) {
	for _, id := range []string{"market-sanaa", "a1", "store-27"} {
		if !validID(id) {
			t.Errorf("safe public Store identifier %q rejected", id)
		}
	}
	for _, id := range []string{
		"", "owner/secret", "../private", "s?admin=1", "a&b", "a b",
		"UPPERCASE", strings.Repeat("a", 65), "s%2Fadmin",
	} {
		if validID(id) {
			t.Errorf("unsafe public Store identifier %q accepted", id)
		}
	}
}

func TestPublicCursorPreventsCrossStoreReuseAndStalePages(t *testing.T) {
	safe := makeCursor(pageCursor{Kind: "offers", Scope: "market-sanaa", After: "of-flour", Revision: 14})
	after, err := parseCursor(safe, "offers", "market-sanaa", 14)
	if err != nil || after != "of-flour" {
		t.Fatalf("safe cursor failed: %q, %v", after, err)
	}
	if _, err = parseCursor(safe, "offers", "market-aden", 14); !errors.Is(err, errInvalid) {
		t.Fatalf("cross-Store cursor must be invalid, got %v", err)
	}
	if _, err = parseCursor(safe, "stores", "market-sanaa", 14); !errors.Is(err, errInvalid) {
		t.Fatalf("cross-resource cursor must be invalid, got %v", err)
	}
	if _, err = parseCursor(safe, "offers", "market-sanaa", 15); !errors.Is(err, errStale) {
		t.Fatalf("stale cursor must conflict, got %v", err)
	}
	for _, cursor := range []string{"!", strings.Repeat("a", 513),
		makeCursor(pageCursor{Kind: "offers", Scope: "market-sanaa", After: "../private", Revision: 14}),
		makeCursor(pageCursor{Kind: "offers", Scope: "market-sanaa", After: "of-flour", Revision: -1}),
	} {
		if _, err := parseCursor(cursor, "offers", "market-sanaa", 14); !errors.Is(err, errInvalid) {
			t.Errorf("malformed cursor must be rejected: %v", err)
		}
	}
}

func TestDatabaseNameRequiresExactIsolatedRefoundation(t *testing.T) {
	for _, name := range []string{
		"", "postgres", "bthwani", "samrim", "production", "bthwani_production",
		"refoundation", "bthwani_refoundation_backup", "bthwani_refoundation_prod",
		"bthwani_refoundation;DROP SCHEMA public", "BTHWANI_REFOUNDATION",
	} {
		if isRefoundationDatabase(name) {
			t.Errorf("unsafe development write database %q accepted", name)
		}
	}
	if !isRefoundationDatabase("bthwani_refoundation") {
		t.Fatal("dedicated isolated refoundation database should be accepted")
	}
}

func TestReviewedBaselineSourcesOnly(t *testing.T) {
	for name, digest := range reviewedFreshBaseline {
		source, err := os.ReadFile(filepath.Join("..", "..", "..", "database", "schema", name))
		if err != nil {
			t.Fatal(err)
		}
		if fmt.Sprintf("%x", sha256.Sum256(source)) != digest {
			t.Fatalf("reviewed baseline digest mismatch: %s", name)
		}
	}
}
