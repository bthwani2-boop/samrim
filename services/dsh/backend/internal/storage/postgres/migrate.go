package postgres

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"embed"
	"encoding/hex"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"strconv"
	"strings"
	"time"

	_ "github.com/lib/pq"
)

const SchemaVersion = 182

type MigrationRecord struct {
	Version int
	Name    string
	SHA256  string
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

// The canonical migration SQL is embedded in the binary so the executed
// migration graph is exactly the compiled source of truth and no runtime
// filesystem path can redirect the migration reader.
//
//go:embed migrations/*.sql
var embeddedMigrations embed.FS

func LoadMigrations() ([]MigrationRecord, []string, error) {
	entries, err := fs.ReadDir(embeddedMigrations, "migrations")
	if err != nil {
		return nil, nil, fmt.Errorf("read DSH migration directory: %w", err)
	}
	records := make([]MigrationRecord, 0, len(entries))
	sqls := make([]string, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() {
			return nil, nil, fmt.Errorf("unexpected DSH migration directory: %s", entry.Name())
		}
		name := entry.Name()
		if len(name) < 9 || name[3] != '_' || !strings.HasSuffix(name, ".sql") {
			return nil, nil, fmt.Errorf("invalid DSH migration filename: %s", name)
		}
		version, err := strconv.Atoi(name[:3])
		if err != nil || version != len(records)+1 {
			return nil, nil, fmt.Errorf("non-contiguous DSH migration sequence at %s", name)
		}
		raw, err := fs.ReadFile(embeddedMigrations, "migrations/"+name)
		if err != nil {
			return nil, nil, fmt.Errorf("read DSH migration %s: %w", name, err)
		}
		if len(raw) == 0 {
			return nil, nil, fmt.Errorf("DSH migration %s is empty", name)
		}
		digest := sha256.Sum256(raw)
		records = append(records, MigrationRecord{Version: version, Name: name, SHA256: hex.EncodeToString(digest[:])})
		sqls = append(sqls, string(raw))
	}
	if len(records) != SchemaVersion {
		return nil, nil, fmt.Errorf("DSH migration graph size is %d; want %d", len(records), SchemaVersion)
	}
	return records, sqls, nil
}
func Migrate(ctx context.Context, db *sql.DB, records []MigrationRecord, migrationSQL []string, proofKeys *DeliveryProofKeyring) error {
	if db == nil || len(records) != SchemaVersion || len(migrationSQL) != len(records) {
		return errors.New("invalid DSH migration input")
	}
	if proofKeys == nil {
		return errors.New("DSH delivery proof keyring is required for schema migration")
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
	if _, err := tx.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS dsh.schema_migrations (version integer PRIMARY KEY, name text NOT NULL, sha256 text NOT NULL, applied_at timestamptz NOT NULL DEFAULT clock_timestamp())`); err != nil {
		return fmt.Errorf("create DSH migration history: %w", err)
	}
	var current int
	if err := tx.QueryRowContext(ctx, "SELECT COALESCE(MAX(version), 0) FROM dsh.schema_migrations").Scan(&current); err != nil {
		return fmt.Errorf("read DSH migration history: %w", err)
	}
	if current > SchemaVersion {
		return fmt.Errorf("DSH schema is newer than this binary: %d", current)
	}
	for _, record := range records {
		if record.Version > current {
			break
		}
		var name, digest string
		if err := tx.QueryRowContext(ctx, "SELECT name, sha256 FROM dsh.schema_migrations WHERE version=$1", record.Version).Scan(&name, &digest); err != nil {
			return fmt.Errorf("read DSH migration v%d: %w", record.Version, err)
		}
		if name != record.Name || (digest != record.SHA256 && !acceptHistoricalV130Migration(ctx, tx, record, digest)) {
			return fmt.Errorf("DSH migration checksum mismatch at v%d", record.Version)
		}
	}
	for index := current; index < SchemaVersion; index++ {
		record := records[index]
		if record.Version != current+1 {
			return fmt.Errorf("DSH migration v%d cannot follow schema v%d", record.Version, current)
		}
		applySQL := true
		if record.Version == 170 {
			applySQL, err = prepareCustomerCatalogNameIndex(ctx, tx)
			if err != nil {
				return fmt.Errorf("prepare DSH canonical migration v170: %w", err)
			}
		}
		if applySQL {
			if _, err := tx.ExecContext(ctx, migrationSQL[index]); err != nil {
				return fmt.Errorf("apply DSH canonical migration v%d: %w", record.Version, err)
			}
		}
		if _, err := tx.ExecContext(ctx, "INSERT INTO dsh.schema_migrations(version, name, sha256) VALUES($1,$2,$3)", record.Version, record.Name, record.SHA256); err != nil {
			return fmt.Errorf("record DSH migration v%d: %w", record.Version, err)
		}
		current++
		if record.Version == 170 && current < SchemaVersion {
			// Release the catalog lock before v171 changes Studio tables.
			// The next transaction re-acquires the migration advisory lock and
			// validates the committed v170 checksum before proceeding.
			if err := tx.Commit(); err != nil {
				return fmt.Errorf("commit DSH migration v170: %w", err)
			}
			return Migrate(ctx, db, records, migrationSQL, proofKeys)
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit DSH migrations through v%d: %w", SchemaVersion, err)
	}
	// v172 creates checks without scanning existing Stores while holding the
	// migration transaction's stronger DDL lock. Validate after it commits,
	// with a bounded lock wait; a failed validation remains retryable.
	if err := validateStoreRelationConstraints(ctx, db); err != nil {
		return fmt.Errorf("validate Store relation constraints: %w", err)
	}
	if err := MigrateDeliveryProofCryptography(ctx, db, proofKeys); err != nil {
		return fmt.Errorf("migrate DSH delivery proof material: %w", err)
	}
	return nil
}

// Store relation CHECKs are added as NOT VALID so the DDL transaction avoids
// scanning every existing Store under its stronger lock. Validation happens in
// a separate, bounded transaction after that migration commits. If interrupted,
// the recorded migration can be retried without rewriting schema history.
func validateStoreRelationConstraints(ctx context.Context, db *sql.DB) error {
	for _, name := range []string{"stores_relation_model_chk", "stores_independent_market_publication_chk"} {
		var validated bool
		if err := db.QueryRowContext(ctx, `SELECT convalidated FROM pg_constraint
			WHERE conrelid='dsh.stores'::regclass AND conname=$1 AND contype='c'`, name).Scan(&validated); err != nil {
			return fmt.Errorf("read Store constraint %s validation state: %w", name, err)
		}
		if validated {
			continue
		}
		validationCtx, cancel := context.WithTimeout(ctx, 60*time.Second)
		tx, err := db.BeginTx(validationCtx, nil)
		if err != nil {
			cancel()
			return fmt.Errorf("start Store constraint validation for %s: %w", name, err)
		}
		_, err = tx.ExecContext(validationCtx, "SET LOCAL lock_timeout = '5s'")
		if err == nil {
			_, err = tx.ExecContext(validationCtx, "SET LOCAL statement_timeout = '45s'")
		}
		if err == nil {
			// PostgreSQL identifiers cannot be query parameters: use exact SQL
			// literals for the two known constraints, never interpolated SQL.
			if name == "stores_relation_model_chk" {
				_, err = tx.ExecContext(validationCtx, "ALTER TABLE dsh.stores VALIDATE CONSTRAINT stores_relation_model_chk")
			} else {
				_, err = tx.ExecContext(validationCtx, "ALTER TABLE dsh.stores VALIDATE CONSTRAINT stores_independent_market_publication_chk")
			}
		}
		if err == nil {
			err = tx.Commit()
		} else {
			_ = tx.Rollback()
		}
		cancel()
		if err != nil {
			return fmt.Errorf("validate Store constraint %s after migration commit: %w", name, err)
		}
	}
	return nil
}

// historicalV130Querier is deliberately limited to the read needed for
// verifying an already-applied historical migration; it does not mutate history.
type historicalV130Querier interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

// v130 was applied to some durable local databases before its SQL was corrected
// for fresh bootstrap. Recognize only that exact audited old checksum, only in
// development, and only when its stricter delivery-proof constraint exists.
// Keep the recorded historical hash; never silently rewrite schema_migrations.
func acceptHistoricalV130Migration(ctx context.Context, db historicalV130Querier, record MigrationRecord, storedDigest string) bool {
	if os.Getenv("BTHWANI_ENV") != "development" ||
		record.Version != 130 ||
		record.Name != "130_captain_delivery_confirmation.sql" ||
		record.SHA256 != "79e0ea24d4a7b56d4934ae25805957f106f5d83b2ae168224d81b410ff9933b1" ||
		storedDigest != "da7c2732bf7412af8e3cb24af40cb39afeefe03d938a6c48f3a1bc68059ca02c" {
		return false
	}
	var compatible bool
	err := db.QueryRowContext(ctx, `SELECT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conrelid='dsh.commerce_order_delivery_proofs'::regclass
        AND conname='commerce_order_delivery_proof_material_chk'
        AND pg_get_constraintdef(oid) LIKE '%code_ciphertext%'
        AND pg_get_constraintdef(oid) LIKE '%code_verifier%'
        AND pg_get_constraintdef(oid) LIKE '%code_key_id%'
    )`).Scan(&compatible)
	return err == nil && compatible
}
