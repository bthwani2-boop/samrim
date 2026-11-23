// Package testfixture initializes only dedicated, disposable owner test schemas.
// Production bootstrap remains owned by discovery.
package testfixture

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

var schemaName = regexp.MustCompile("^[a-z][a-z0-9_]{0,62}$")
var domainFile = regexp.MustCompile("^[0-9]{2}_[a-z][a-z0-9_]*[.]sql$")

func Fresh(t testing.TB, ctx context.Context, db *sql.DB, owner, schema, directory string) {
	t.Helper()
	if os.Getenv("BTHWANI_ISOLATED_TEST_MODE") != "true" {
		t.Fatal("isolated fixture opt-in required")
	}
	allowed := map[string]string{"orderability_agent02": "bthwani_agent02", "merchant_agent01": "bthwani_session01", "refoundation_captain_agent02": "bt_cap_s02"}
	if !schemaName.MatchString(schema) || (owner != "dsh" && owner != "identity") || !strings.HasPrefix(schema, owner+"_test_") {
		t.Fatal("unsafe owner fixture schema")
	}
	dir, err := filepath.Abs(directory)
	if err != nil || !strings.HasSuffix(filepath.ToSlash(dir), "/services/"+owner+"/database/schema") {
		t.Fatal("canonical owner schema directory required")
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	var database, user string
	if err = tx.QueryRowContext(ctx, "SELECT current_database(), current_user").Scan(&database, &user); err != nil || allowed[database] == "" || allowed[database] != user {
		t.Fatal("fixture database and role not admitted")
	}
	var exists bool
	if err = tx.QueryRowContext(ctx, "SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname=$1)", schema).Scan(&exists); err != nil || exists {
		t.Fatal("fresh fixture requires an absent schema")
	}
	entries, err := os.ReadDir(dir)
	if err != nil || len(entries) == 0 {
		t.Fatal("owner baseline unavailable")
	}
	for _, entry := range entries {
		if !entry.Type().IsRegular() || !domainFile.MatchString(entry.Name()) {
			t.Fatalf("unexpected baseline entry %s", entry.Name())
		}
		data, err := os.ReadFile(filepath.Join(dir, entry.Name()))
		if err != nil || !strings.Contains(string(data), "__SCHEMA__") {
			t.Fatalf("invalid baseline %s: %v", entry.Name(), err)
		}
		source := strings.Replace(string(data), "CREATE SCHEMA IF NOT EXISTS __SCHEMA__;", "CREATE SCHEMA __SCHEMA__;", 1)
		if _, err = tx.ExecContext(ctx, strings.ReplaceAll(source, "__SCHEMA__", schema)); err != nil {
			t.Fatal(fmt.Errorf("owner baseline %s: %w", entry.Name(), err))
		}
	}
	if err = tx.Commit(); err != nil {
		t.Fatal(err)
	}
}
