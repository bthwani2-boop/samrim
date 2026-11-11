package postgres

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"
)

// The canonical SQL files themselves own the migration inventory.
// The loader must reject gaps, duplicates and unexpected SQL paths.
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
	if len(records) != len(files) || len(statements) != len(files) {
		t.Fatalf("migration inventory drift: files=%d records=%d statements=%d", len(files), len(records), len(statements))
	}
	for i, file := range files {
		if records[i].Version != i+1 || records[i].Name != filepath.Base(file) {
			t.Fatalf("unexpected migration %d: file=%q record=%+v", i+1, filepath.Base(file), records[i])
		}
	}
}

func TestLoadMigrationsRejectsGapsAndUnexpectedSQL(t *testing.T) {
	directory := t.TempDir()
	for version := 1; version <= 3; version++ {
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
	if err := os.WriteFile(filepath.Join(directory, "005_unexpected.sql"), []byte("SELECT 1;\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, _, err := LoadMigrations(directory); err == nil {
		t.Fatal("migration loader accepted a noncontiguous new SQL migration")
	}
	if err := os.Rename(filepath.Join(directory, "005_unexpected.sql"), filepath.Join(directory, "004_next.sql")); err != nil {
		t.Fatal(err)
	}
	records, _, err := LoadMigrations(directory)
	if err != nil || len(records) != 4 || records[3].Version != 4 {
		t.Fatalf("migration loader failed to derive the new sequential version: records=%v err=%v", records, err)
	}
}
