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

var requiredTables = []struct {
	name    string
	columns []string
}{
	{name: "dsh.schema_migrations", columns: []string{"version", "name", "sha256", "applied_at"}},
	{name: "dsh.partner_organizations", columns: []string{"id", "owner_actor_id", "version", "created_at", "updated_at"}},
	{name: "dsh.stores", columns: []string{"id", "partner_organization_id", "name", "version", "created_at", "updated_at"}},
	{name: "dsh.partner_bootstrap_idempotency", columns: []string{"idempotency_key", "request_hash", "owner_actor_id", "partner_organization_id", "store_id", "created_at"}},
	{name: "dsh.partner_bootstrap_audit", columns: []string{"id", "event_type", "idempotency_key", "correlation_id", "acting_actor_id", "owner_actor_id", "partner_organization_id", "store_id", "request_hash", "created_at"}},
}

func Open(databaseURL string) (*sql.DB, error) {
	databaseURL = strings.TrimSpace(databaseURL)
	if databaseURL == "" {
		return nil, errors.New("DSH_DATABASE_URL is required")
	}
	db, err := sql.Open("postgres", databaseURL)
	if err != nil {
		return nil, fmt.Errorf("open DSH database: %w", err)
	}
	db.SetMaxOpenConns(20)
	db.SetMaxIdleConns(10)
	db.SetConnMaxLifetime(30 * time.Minute)
	return db, nil
}

func LoadMigration(directory string) (MigrationRecord, string, error) {
	if strings.TrimSpace(directory) == "" {
		return MigrationRecord{}, "", errors.New("DSH_MIGRATION_DIR is required")
	}
	const version = 1
	name := "001_partner_bootstrap.sql"
	raw, err := os.ReadFile(filepath.Join(directory, name))
	if err != nil {
		return MigrationRecord{}, "", fmt.Errorf("read DSH migration %s: %w", name, err)
	}
	if len(raw) == 0 {
		return MigrationRecord{}, "", errors.New("DSH migration is empty")
	}
	digest := sha256.Sum256(raw)
	return MigrationRecord{Version: version, Name: name, SHA256: hex.EncodeToString(digest[:])}, string(raw), nil
}

func Migrate(ctx context.Context, db *sql.DB, record MigrationRecord, migrationSQL string) error {
	if db == nil || migrationSQL == "" || record.Version != SchemaVersion {
		return errors.New("invalid DSH migration input")
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("DSH migration transaction: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended('dsh:migrations', 0))"); err != nil {
		return fmt.Errorf("DSH migration advisory lock: %w", err)
	}
	if _, err := tx.ExecContext(ctx, "CREATE SCHEMA IF NOT EXISTS dsh"); err != nil {
		return fmt.Errorf("create DSH schema: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS dsh.schema_migrations (
		version integer PRIMARY KEY,
		name text NOT NULL,
		sha256 text NOT NULL,
		applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
	)`); err != nil {
		return fmt.Errorf("create DSH migration history: %w", err)
	}
	var current int
	if err := tx.QueryRowContext(ctx, "SELECT COALESCE(MAX(version), 0) FROM dsh.schema_migrations").Scan(&current); err != nil {
		return fmt.Errorf("read DSH migration history: %w", err)
	}
	if current > SchemaVersion {
		return fmt.Errorf("DSH schema is newer than this binary: %d", current)
	}
	if current == SchemaVersion {
		var name, digest string
		if err := tx.QueryRowContext(ctx, "SELECT name, sha256 FROM dsh.schema_migrations WHERE version=$1", SchemaVersion).Scan(&name, &digest); err != nil {
			return fmt.Errorf("read DSH migration v%d: %w", SchemaVersion, err)
		}
		if name != record.Name || digest != record.SHA256 {
			return fmt.Errorf("DSH migration checksum mismatch at v%d", SchemaVersion)
		}
		return tx.Commit()
	}
	if current != SchemaVersion-1 {
		return fmt.Errorf("DSH migration v%d cannot follow schema v%d", SchemaVersion, current)
	}
	if _, err := tx.ExecContext(ctx, migrationSQL); err != nil {
		return fmt.Errorf("apply DSH canonical migration v%d: %w", record.Version, err)
	}
	if _, err := tx.ExecContext(ctx, "INSERT INTO dsh.schema_migrations(version, name, sha256) VALUES($1,$2,$3)", record.Version, record.Name, record.SHA256); err != nil {
		return fmt.Errorf("record DSH migration v%d: %w", record.Version, err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit DSH migration v%d: %w", record.Version, err)
	}
	return nil
}

func VerifySchema(ctx context.Context, db *sql.DB, record MigrationRecord) error {
	if db == nil {
		return errors.New("DSH database is nil")
	}
	if err := db.PingContext(ctx); err != nil {
		return fmt.Errorf("DSH database ping: %w", err)
	}
	var version int
	var name, digest string
	if err := db.QueryRowContext(ctx, "SELECT version, name, sha256 FROM dsh.schema_migrations WHERE version=$1", record.Version).Scan(&version, &name, &digest); err != nil {
		return fmt.Errorf("DSH migration readback: %w", err)
	}
	if version != SchemaVersion || name != record.Name || digest != record.SHA256 {
		return fmt.Errorf("DSH migration history does not match canonical v%d", SchemaVersion)
	}
	for _, table := range requiredTables {
		var exists bool
		if err := db.QueryRowContext(ctx, "SELECT to_regclass($1) IS NOT NULL", table.name).Scan(&exists); err != nil {
			return fmt.Errorf("DSH relation check %s: %w", table.name, err)
		}
		if !exists {
			return fmt.Errorf("DSH required relation missing: %s", table.name)
		}
		parts := strings.SplitN(table.name, ".", 2)
		rows, err := db.QueryContext(ctx, "SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2", parts[0], parts[1])
		if err != nil {
			return fmt.Errorf("DSH columns %s: %w", table.name, err)
		}
		found := map[string]bool{}
		for rows.Next() {
			var column string
			if err := rows.Scan(&column); err != nil {
				_ = rows.Close()
				return fmt.Errorf("DSH column scan %s: %w", table.name, err)
			}
			found[column] = true
		}
		if err := rows.Err(); err != nil {
			_ = rows.Close()
			return fmt.Errorf("DSH column rows %s: %w", table.name, err)
		}
		if err := rows.Close(); err != nil {
			return fmt.Errorf("DSH column close %s: %w", table.name, err)
		}
		for _, column := range table.columns {
			if !found[column] {
				return fmt.Errorf("DSH required column missing: %s.%s", table.name, column)
			}
		}
	}
	var databaseNow time.Time
	if err := db.QueryRowContext(ctx, "SELECT clock_timestamp()").Scan(&databaseNow); err != nil {
		return fmt.Errorf("DSH database clock: %w", err)
	}
	drift := time.Since(databaseNow)
	if drift < 0 {
		drift = -drift
	}
	if drift > 30*time.Second {
		return fmt.Errorf("DSH database clock drift exceeds 30s: %s", drift)
	}
	return nil
}
