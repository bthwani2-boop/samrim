package postgres

import (
	"path/filepath"
	"testing"
)

// All SQL migrations must be present in the canonical owner manifest.
// Otherwise the migration CLI can claim exact schema parity while ignoring
// a newly authored migration file.
func TestMigrationInventoryMatchesCanonicalDirectory(t *testing.T) {
	directory := filepath.Join("..", "..", "..", "..", "database", "migrations")
	files, err := filepath.Glob(filepath.Join(directory, "*.sql"))
	if err != nil {
		t.Fatal(err)
	}
	if len(files) == 0 {
		t.Fatal("canonical migration directory is empty")
	}
	records, statements, err := LoadMigrations(directory)
	if err != nil {
		t.Fatal(err)
	}
	if len(files) != SchemaVersion || len(records) != len(files) || len(statements) != len(files) {
		t.Fatalf("migration inventory drift: files=%d schemaVersion=%d records=%d statements=%d", len(files), SchemaVersion, len(records), len(statements))
	}
	for i, file := range files {
		if records[i].Version != i+1 || records[i].Name != filepath.Base(file) {
			t.Fatalf("unexpected migration %d: file=%q record=%+v", i+1, filepath.Base(file), records[i])
		}
	}
}
