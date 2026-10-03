package postgres_test

import (
	"path/filepath"
	"strings"
	"testing"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

func TestCanonicalJourneyMigrationGraphEndsAt87(t *testing.T) {
	migrationDirectory := filepath.Join("..", "..", "..", "..", "database", "migrations")
	records, migrationSQL, err := postgres.LoadCanonicalMigrations(migrationDirectory)
	if err != nil {
		t.Fatalf("load canonical DSH migrations: %v", err)
	}
	if len(records) != postgres.CanonicalSchemaVersion || len(migrationSQL) != postgres.CanonicalSchemaVersion {
		t.Fatalf("canonical DSH migration graph size: records=%d sql=%d schema=%d", len(records), len(migrationSQL), postgres.CanonicalSchemaVersion)
	}
	last := records[len(records)-1]
	if last.Version != postgres.CanonicalSchemaVersion || last.Name != "087_order_recipient_and_adjustments.sql" {
		t.Fatalf("last canonical DSH migration = v%d %q; want v%d 087_order_recipient_and_adjustments.sql", last.Version, last.Name, postgres.CanonicalSchemaVersion)
	}

	migrationByName := make(map[string]string, len(records))
	for index, record := range records {
		migrationByName[record.Name] = migrationSQL[index]
	}
	for _, required := range []string{
		"085_store_operational_availability.sql",
		"086_store_scoped_access_delegation.sql",
		"087_order_recipient_and_adjustments.sql",
	} {
		if _, ok := migrationByName[required]; !ok {
			t.Fatalf("canonical DSH migration missing: %s", required)
		}
	}
	if !strings.Contains(migrationByName["085_store_operational_availability.sql"], "CREATE TABLE dsh.store_operational_availability") || !strings.Contains(migrationByName["085_store_operational_availability.sql"], "schedule_timezone text NOT NULL DEFAULT 'Asia/Aden'") {
		t.Fatal("migration 085 is missing canonical Store orderability state")
	}
	if !strings.Contains(migrationByName["086_store_scoped_access_delegation.sql"], "CREATE TABLE dsh.store_access_grants") || !strings.Contains(migrationByName["086_store_scoped_access_delegation.sql"], "ARRAY['orders','catalog','store_operations']") {
		t.Fatal("migration 086 is missing bounded Store access grants")
	}
	if !strings.Contains(migrationByName["087_order_recipient_and_adjustments.sql"], "ADD COLUMN recipient_mode") || !strings.Contains(migrationByName["087_order_recipient_and_adjustments.sql"], "CREATE TABLE dsh.order_adjustments") {
		t.Fatal("migration 087 is missing recipient snapshot or OrderAdjustment history")
	}
}
