package postgres

import (
	"fmt"
	"os"
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

func TestLoadMigrationsRejectsGapsAndExtraSQL(t *testing.T) {
	directory := t.TempDir()
	for version := 1; version <= SchemaVersion; version++ {
		name := fmt.Sprintf("%03d_sample.sql", version)
		if err := os.WriteFile(filepath.Join(directory, name), []byte("SELECT 1;\n"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	if _, _, err := LoadMigrations(directory); err != nil {
		t.Fatalf("complete migration sequence was rejected: %v", err)
	}
	if err := os.Rename(filepath.Join(directory, "003_sample.sql"), filepath.Join(directory, "002_duplicate.sql")); err != nil {
		t.Fatal(err)
	}
	if _, _, err := LoadMigrations(directory); err == nil {
		t.Fatal("migration loader accepted a duplicate v002 and missing v003")
	}
	if err := os.Rename(filepath.Join(directory, "002_duplicate.sql"), filepath.Join(directory, "003_sample.sql")); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(directory, "064_extra.sql"), []byte("SELECT 1;\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, _, err := LoadMigrations(directory); err == nil {
		t.Fatal("migration loader accepted an unregistered extra SQL migration")
	}
}
