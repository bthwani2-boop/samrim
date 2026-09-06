package runtime

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"

	"github.com/bthwani2-boop/samrim/services/identity/backend/internal/storage/postgres"
)

var migrationFileName = regexp.MustCompile(`^([0-9]{3})_([a-z0-9_]+)\.sql$`)

func loadMigrationRecords(directory string) ([]postgres.MigrationRecord, error) {
	entries, err := os.ReadDir(directory)
	if err != nil {
		return nil, fmt.Errorf("read identity migration directory: %w", err)
	}
	records := make([]postgres.MigrationRecord, 0, len(entries))
	seen := map[int]bool{}
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		match := migrationFileName.FindStringSubmatch(entry.Name())
		if match == nil {
			return nil, fmt.Errorf("unexpected identity migration artifact: %s", entry.Name())
		}
		version, err := strconv.Atoi(match[1])
		if err != nil || version < 1 || version > postgres.SchemaVersion {
			return nil, fmt.Errorf("unsupported identity migration version in %s", entry.Name())
		}
		if seen[version] {
			return nil, fmt.Errorf("duplicate identity migration version %d", version)
		}
		seen[version] = true
		raw, err := os.ReadFile(filepath.Join(directory, entry.Name()))
		if err != nil {
			return nil, fmt.Errorf("read identity migration v%d: %w", version, err)
		}
		digest := sha256.Sum256(raw)
		records = append(records, postgres.MigrationRecord{Version: version, Name: entry.Name(), SHA256: hex.EncodeToString(digest[:])})
	}
	sort.Slice(records, func(i, j int) bool { return records[i].Version < records[j].Version })
	for index, record := range records {
		expected := index + 1
		if record.Version != expected {
			return nil, fmt.Errorf("missing identity migration version %d", expected)
		}
	}
	if len(records) != postgres.SchemaVersion {
		return nil, fmt.Errorf("identity migration count mismatch: got %d want %d", len(records), postgres.SchemaVersion)
	}
	return records, nil
}

func applyMigrations(ctx context.Context, db *sql.DB, directory string, records []postgres.MigrationRecord) error {
	current, err := postgres.CurrentSchemaVersion(ctx, db)
	if err != nil {
		return err
	}
	if current > postgres.SchemaVersion {
		return fmt.Errorf("database schema v%d is newer than runtime v%d", current, postgres.SchemaVersion)
	}
	for _, record := range records {
		if record.Version <= current {
			continue
		}
		raw, err := os.ReadFile(filepath.Join(directory, record.Name))
		if err != nil {
			return fmt.Errorf("read identity migration v%d: %w", record.Version, err)
		}
		if err := postgres.Migrate(ctx, db, record.Version, string(raw)); err != nil {
			return err
		}
	}
	return postgres.SynchronizeMigrationHistory(ctx, db, records)
}
