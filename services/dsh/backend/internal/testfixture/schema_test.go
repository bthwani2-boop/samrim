package testfixture

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// Run the public fatal-on-error helper in a separate test process. A nil
// database is deliberate: no invalid source may reach a database operation.
func TestFreshRejectsMalformedSourceBeforeDatabase(t *testing.T) {
	if os.Getenv("BTHWANI_FIXTURE_PREFLIGHT_CHILD") == "true" {
		t.Setenv("BTHWANI_ISOLATED_TEST_MODE", "true")
		dir := filepath.Join(t.TempDir(), "services", "dsh", "database", "schema")
		if err := os.MkdirAll(dir, 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, "00_marketplace.sql"), []byte("SELECT '__SCHEMA__';"), 0600); err != nil {
			t.Fatal(err)
		}
		Fresh(t, context.Background(), nil, "dsh", "dsh_test_preflight", dir)
		t.Fatal("malformed fixture admitted")
	}
	cmd := exec.Command(os.Args[0], "-test.run=^TestFreshRejectsMalformedSourceBeforeDatabase$")
	cmd.Env = append(os.Environ(), "BTHWANI_FIXTURE_PREFLIGHT_CHILD=true")
	out, err := cmd.CombinedOutput()
	if err == nil || !strings.Contains(string(out), "fixture baseline must create exactly one fresh namespace") || strings.Contains(string(out), "panic:") {
		t.Fatalf("malformed source reached database or wrong rejection: %v\n%s", err, out)
	}
}

func TestPrepareFixtureReadsBothCanonicalOwners(t *testing.T) {
	for _, tc := range []struct {
		owner, path string
		count       int
	}{
		{"dsh", "../../../database/schema", 8},
		{"identity", "../../../../identity/database/schema", 5},
	} {
		t.Run(tc.owner, func(t *testing.T) {
			schema := tc.owner + "_test_fixture"
			files, err := prepareFixture(tc.owner, schema, tc.path)
			if err != nil {
				t.Fatal(err)
			}
			if len(files) != tc.count {
				t.Fatalf("unexpected baseline length %d", len(files))
			}
			if !strings.Contains(files[0].sql, "CREATE SCHEMA "+schema+";") {
				t.Fatal("missing strict namespace creation")
			}
			for _, file := range files {
				if strings.Contains(file.sql, "__SCHEMA__") || strings.Contains(file.sql, "CREATE SCHEMA IF NOT EXISTS") {
					t.Fatalf("unscoped or overlay source %s", file.name)
				}
			}
		})
	}
}

func TestPrepareFixtureDeniesUnsafeSource(t *testing.T) {
	for _, tc := range []struct {
		name  string
		data  []byte
		extra bool
	}{
		{"missing-schema-marker", []byte("SELECT 1;"), false},
		{"no-creation", []byte("SELECT '__SCHEMA__';"), false},
		{"double-create", []byte("CREATE SCHEMA __SCHEMA__; CREATE SCHEMA __SCHEMA__;"), false},
		{"extra-entry", []byte("CREATE SCHEMA __SCHEMA__;"), true},
		{"oversized", []byte("CREATE SCHEMA __SCHEMA__;" + strings.Repeat(" ", maxFixtureSQL)), false},
		{"invalid-utf8", append([]byte("CREATE SCHEMA __SCHEMA__;"), 0xff), false},
		{"nul", append([]byte("CREATE SCHEMA __SCHEMA__;"), 0), false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			dir := filepath.Join(t.TempDir(), "services", "dsh", "database", "schema")
			if err := os.MkdirAll(dir, 0700); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(dir, "00_marketplace.sql"), tc.data, 0600); err != nil {
				t.Fatal(err)
			}
			if tc.extra {
				if err := os.WriteFile(filepath.Join(dir, "extra.txt"), []byte("x"), 0600); err != nil {
					t.Fatal(err)
				}
			}
			if _, err := prepareFixture("dsh", "dsh_test_fixture", dir); err == nil {
				t.Fatal("unsafe source accepted")
			}
		})
	}
	for _, schema := range []string{"dsh_test_", "dsh", "identity_test_fixture", "dsh_test_a;drop"} {
		if _, err := prepareFixture("dsh", schema, "../../../database/schema"); err == nil {
			t.Fatalf("unsafe namespace %s", schema)
		}
	}
}

func TestPrepareFixtureDeniesRedirectedSource(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "services", "dsh", "database", "schema")
	if err := os.MkdirAll(filepath.Dir(dir), 0700); err != nil {
		t.Fatal(err)
	}
	other := t.TempDir()
	if err := os.WriteFile(filepath.Join(other, "00_marketplace.sql"), []byte("CREATE SCHEMA __SCHEMA__;"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(other, dir); err != nil {
		t.Skip("symlink creation not available on this host")
	}
	if _, err := prepareFixture("dsh", "dsh_test_fixture", dir); err == nil {
		t.Fatal("redirected directory accepted")
	}
}
