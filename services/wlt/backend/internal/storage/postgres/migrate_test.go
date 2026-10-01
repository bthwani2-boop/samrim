package postgres

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestCanonicalMigrationGraphRegistersEveryMigrationFile(t *testing.T) {
	directory := filepath.Join("..", "..", "..", "..", "database", "migrations")
	entries, err := os.ReadDir(directory)
	if err != nil {
		t.Fatalf("read canonical WLT migrations: %v", err)
	}
	files := make([]string, 0, len(entries))
	for _, entry := range entries {
		if !entry.IsDir() && strings.HasSuffix(entry.Name(), ".sql") {
			files = append(files, entry.Name())
		}
	}
	records, migrationSQL, err := LoadMigrations(directory)
	if err != nil {
		t.Fatalf("load canonical WLT migrations: %v", err)
	}
	if len(records) != SchemaVersion || len(migrationSQL) != SchemaVersion || len(records) != len(files) {
		t.Fatalf("WLT migration graph is incomplete: records=%d SQL=%d files=%d schema=%d", len(records), len(migrationSQL), len(files), SchemaVersion)
	}
	for index, file := range files {
		if records[index].Name != file || records[index].Version != index+1 {
			t.Fatalf("WLT migration graph entry %d = v%d %q; want v%d %q", index, records[index].Version, records[index].Name, index+1, file)
		}
	}
}

func TestStoreTypeCommissionCutoverArchivesOldRatesBeforeDroppingOwners(t *testing.T) {
	directory := filepath.Join("..", "..", "..", "..", "database", "migrations")
	data, err := os.ReadFile(filepath.Join(directory, "034_store_type_commission_owns_rate.sql"))
	if err != nil {
		t.Fatalf("read store type commission cutover: %v", err)
	}
	sql := string(data)
	archive := strings.Index(sql, "CREATE TABLE wlt.partner_commission_rate_history")
	profileCopy := strings.Index(sql, "FROM wlt.partner_financial_profiles")
	eventCopy := strings.Index(sql, "FROM wlt.partner_financial_profile_events")
	policyCopy := strings.Index(sql, "FROM wlt.partner_financial_terms_policies")
	drop := strings.Index(sql, "DROP COLUMN commission_rate_bps")
	if archive < 0 || profileCopy < archive || eventCopy < profileCopy || policyCopy < eventCopy || drop < policyCopy {
		t.Fatal("commission rates must be copied to inactive history before live profile and terms owners are removed")
	}
}
