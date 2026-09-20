package postgres

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	_ "github.com/lib/pq"
)

const SchemaVersion = 1

type MigrationRecord struct {
	Version int
	Name    string
	SHA256  string
}

func Open(databaseURL string) (*sql.DB, error) {
	if strings.TrimSpace(databaseURL) == "" {
		return nil, errors.New("WLT_DATABASE_URL is required")
	}
	db, err := sql.Open("postgres", databaseURL)
	if err != nil {
		return nil, fmt.Errorf("open WLT database: %w", err)
	}
	db.SetMaxOpenConns(20)
	db.SetMaxIdleConns(10)
	db.SetConnMaxLifetime(30 * time.Minute)
	return db, nil
}

func LoadMigrations(directory string) ([]MigrationRecord, []string, error) {
	directory = strings.TrimSpace(directory)
	if directory == "" {
		return nil, nil, errors.New("WLT_MIGRATION_DIR is required")
	}
	names := []string{"001_payment_intents.sql"}
	records := make([]MigrationRecord, 0, len(names))
	sqls := make([]string, 0, len(names))
	for version, name := range names {
		raw, err := os.ReadFile(filepath.Join(directory, name))
		if err != nil {
			return nil, nil, fmt.Errorf("read WLT migration %s: %w", name, err)
		}
		if len(raw) == 0 {
			return nil, nil, fmt.Errorf("WLT migration %s is empty", name)
		}
		digest := sha256.Sum256(raw)
		records = append(records, MigrationRecord{Version: version + 1, Name: name, SHA256: hex.EncodeToString(digest[:])})
		sqls = append(sqls, string(raw))
	}
	return records, sqls, nil
}

func Migrate(ctx context.Context, db *sql.DB, records []MigrationRecord, migrationSQL []string) error {
	if db == nil || len(records) != SchemaVersion || len(migrationSQL) != SchemaVersion {
		return errors.New("invalid WLT migration input")
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("WLT migration transaction: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended('wlt:migrations', 0))"); err != nil {
		return fmt.Errorf("WLT migration advisory lock: %w", err)
	}
	if _, err := tx.ExecContext(ctx, "CREATE SCHEMA IF NOT EXISTS wlt"); err != nil {
		return fmt.Errorf("create WLT schema: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS wlt.schema_migrations (version integer PRIMARY KEY, name text NOT NULL, sha256 text NOT NULL, applied_at timestamptz NOT NULL DEFAULT clock_timestamp())`); err != nil {
		return fmt.Errorf("create WLT migration history: %w", err)
	}
	var current int
	if err := tx.QueryRowContext(ctx, "SELECT COALESCE(MAX(version), 0) FROM wlt.schema_migrations").Scan(&current); err != nil {
		return fmt.Errorf("read WLT migration history: %w", err)
	}
	if current > SchemaVersion {
		return fmt.Errorf("WLT schema is newer than this binary: %d", current)
	}
	for _, record := range records {
		if record.Version > current {
			break
		}
		var name, digest string
		if err := tx.QueryRowContext(ctx, "SELECT name, sha256 FROM wlt.schema_migrations WHERE version=$1", record.Version).Scan(&name, &digest); err != nil {
			return fmt.Errorf("read WLT migration v%d: %w", record.Version, err)
		}
		if name != record.Name || digest != record.SHA256 {
			return fmt.Errorf("WLT migration checksum mismatch at v%d", record.Version)
		}
	}
	for index := current; index < SchemaVersion; index++ {
		record := records[index]
		if record.Version != current+1 {
			return fmt.Errorf("WLT migration v%d cannot follow schema v%d", record.Version, current)
		}
		if _, err := tx.ExecContext(ctx, migrationSQL[index]); err != nil {
			return fmt.Errorf("apply WLT migration v%d: %w", record.Version, err)
		}
		if _, err := tx.ExecContext(ctx, "INSERT INTO wlt.schema_migrations(version, name, sha256) VALUES($1,$2,$3)", record.Version, record.Name, record.SHA256); err != nil {
			return fmt.Errorf("record WLT migration v%d: %w", record.Version, err)
		}
		current++
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit WLT migrations: %w", err)
	}
	return nil
}

func VerifySchema(ctx context.Context, db *sql.DB, records []MigrationRecord) error {
	if db == nil || len(records) != SchemaVersion {
		return errors.New("invalid WLT schema verification input")
	}
	if err := db.PingContext(ctx); err != nil {
		return fmt.Errorf("WLT database ping: %w", err)
	}
	var count int
	if err := db.QueryRowContext(ctx, "SELECT COUNT(*) FROM wlt.schema_migrations").Scan(&count); err != nil {
		return fmt.Errorf("WLT migration history count: %w", err)
	}
	if count != len(records) {
		return fmt.Errorf("WLT migration history count mismatch: got %d want %d", count, len(records))
	}
	for _, record := range records {
		var name, digest string
		if err := db.QueryRowContext(ctx, "SELECT name, sha256 FROM wlt.schema_migrations WHERE version=$1", record.Version).Scan(&name, &digest); err != nil {
			return fmt.Errorf("WLT migration readback v%d: %w", record.Version, err)
		}
		if name != record.Name || digest != record.SHA256 {
			return fmt.Errorf("WLT migration history does not match canonical v%d", record.Version)
		}
	}
	for _, relation := range []string{"wlt.payment_intents", "wlt.payment_intent_events"} {
		var exists bool
		if err := db.QueryRowContext(ctx, "SELECT to_regclass($1) IS NOT NULL", relation).Scan(&exists); err != nil {
			return fmt.Errorf("WLT relation check %s: %w", relation, err)
		}
		if !exists {
			return fmt.Errorf("WLT required relation missing: %s", relation)
		}
	}
	return nil
}
