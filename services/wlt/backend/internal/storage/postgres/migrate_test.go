package postgres_test

import (
	"path/filepath"
	"testing"

	"github.com/bthwani2-boop/samrim/services/wlt/backend/internal/storage/postgres"
)

func TestCanonicalMigrationGraphMatchesSchemaVersion(t *testing.T) {
	migrationDirectory := filepath.Join("..", "..", "..", "..", "database", "migrations")
	records, migrationSQL, err := postgres.LoadMigrations(migrationDirectory)
	if err != nil {
		t.Fatalf("load WLT canonical migrations: %v", err)
	}
	if len(records) != postgres.SchemaVersion || len(migrationSQL) != postgres.SchemaVersion {
		t.Fatalf("unexpected WLT migration graph size: records=%d sql=%d schema=%d", len(records), len(migrationSQL), postgres.SchemaVersion)
	}
	last := records[len(records)-1]
	if last.Version != postgres.SchemaVersion || last.Name != "025_customer_withdrawal_registry_search.sql" {
		t.Fatalf("last WLT migration = v%d %q; want v%d 025_customer_withdrawal_registry_search.sql", last.Version, last.Name, postgres.SchemaVersion)
	}
}
