package session

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// initializeFreshIdentityFixture replaces repeated historical setup loops.
// It is test-only and never overlays an existing Identity namespace.
func initializeFreshIdentityFixture(t testing.TB, ctx context.Context, db *sql.DB, schema string) {
	t.Helper()
	if os.Getenv("BTHWANI_ISOLATED_TEST_MODE") != "true" || !schemaRule.MatchString(schema) || !strings.HasPrefix(schema, "identity_test_") {
		t.Fatal("isolated Identity fixture required")
	}
	dir := filepath.Join("..", "..", "..", "database", "schema")
	names := []string{"00_identity.sql", "10_verification.sql", "20_sessions.sql", "30_operator_permissions.sql", "40_operator_passkeys.sql"}
	entries, err := os.ReadDir(dir)
	if err != nil || len(entries) != len(names) {
		t.Fatalf("incomplete Identity fixture baseline: %v", err)
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	var database string
	if err = tx.QueryRowContext(ctx, "SELECT current_database()").Scan(&database); err != nil || !strings.Contains(strings.ToLower(database), "refoundation") {
		t.Fatal("Identity fixture database not verified")
	}
	var exists bool
	if err = tx.QueryRowContext(ctx, "SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname=$1)", schema).Scan(&exists); err != nil || exists {
		t.Fatal("Identity fixture requires new schema")
	}
	for i, entry := range entries {
		if !entry.Type().IsRegular() || entry.Name() != names[i] {
			t.Fatal("unexpected Identity fixture baseline source")
		}
		raw, e := os.ReadFile(filepath.Join(dir, entry.Name()))
		if e != nil || !strings.Contains(string(raw), "__SCHEMA__") {
			t.Fatalf("invalid Identity fixture %s: %v", entry.Name(), e)
		}
		if _, e = tx.ExecContext(ctx, strings.ReplaceAll(string(raw), "__SCHEMA__", schema)); e != nil {
			t.Fatalf("Identity baseline %s: %v", entry.Name(), e)
		}
	}
	if err = tx.Commit(); err != nil {
		t.Fatal(err)
	}
}
