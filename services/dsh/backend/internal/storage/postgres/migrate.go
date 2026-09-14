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

const SchemaVersion = 7

type MigrationRecord struct {
	Version int
	Name    string
	SHA256  string
}

var requiredTables = []struct {
	name        string
	columns     []string
	constraints []string
	indexes     []string
}{
	{name: "dsh.schema_migrations", columns: []string{"version", "name", "sha256", "applied_at"}, constraints: []string{"schema_migrations_pkey"}},
	{
		name:        "dsh.stores",
		columns:     []string{"id", "partner_actor_id", "name", "version", "created_at", "updated_at", "publication_state", "publication_changed_at", "delivery_origin_latitude", "delivery_origin_longitude"},
		constraints: []string{"stores_pkey", "stores_id_partner_actor_uq", "stores_name_length_chk", "stores_version_positive_chk", "stores_publication_state_chk", "stores_delivery_origin_pair_chk", "stores_delivery_origin_latitude_chk", "stores_delivery_origin_longitude_chk"},
		indexes:     []string{"stores_partner_actor_idx", "stores_publication_state_idx"},
	},
	{
		name:        "dsh.joining_cases",
		columns:     []string{"id", "contact_phone_e164", "business_name", "first_store_name", "partner_actor_id", "state", "correction_reason", "reviewed_by", "store_id", "version", "created_at", "updated_at"},
		constraints: []string{"joining_cases_pkey", "joining_cases_phone_length_chk", "joining_cases_business_name_chk", "joining_cases_store_name_chk", "joining_cases_state_chk", "joining_cases_version_positive_chk", "joining_cases_store_fk"},
		indexes:     []string{"joining_cases_active_phone_uq", "joining_cases_partner_actor_uq", "joining_cases_state_idx"},
	},
	{
		name:        "dsh.joining_case_mutation_idempotency",
		columns:     []string{"idempotency_key", "request_hash", "case_id", "operation", "result_version", "result_state", "result_partner_actor_id", "result_store_id", "result_correction_reason", "created_at"},
		constraints: []string{"joining_case_mutation_idempotency_pkey", "joining_case_idempotency_facts_uq", "joining_case_idempotency_operation_chk", "joining_case_idempotency_state_chk", "joining_case_idempotency_version_chk", "joining_case_idempotency_case_fk"},
		indexes:     []string{"joining_case_idempotency_case_idx"},
	},
	{
		name:        "dsh.joining_case_audit",
		columns:     []string{"id", "event_type", "idempotency_key", "correlation_id", "acting_actor_id", "case_id", "from_state", "to_state", "result_version", "request_hash", "partner_actor_id", "store_id", "correction_reason", "created_at"},
		constraints: []string{"joining_case_audit_pkey", "joining_case_audit_event_type_chk", "joining_case_audit_event_idempotency_uq", "joining_case_audit_case_fk", "joining_case_audit_version_chk"},
		indexes:     []string{"joining_case_audit_case_idx"},
	},
	{
		name:        "dsh.central_products",
		columns:     []string{"id", "canonical_name", "brand", "barcode", "canonical_image_url", "sell_unit", "active", "version", "created_at", "updated_at"},
		constraints: []string{"central_products_pkey", "central_products_name_chk", "central_products_sell_unit_chk", "central_products_version_chk"},
		indexes:     []string{"central_products_barcode_uq", "central_products_active_idx", "central_products_name_prefix_idx"},
	},
	{
		name:        "dsh.central_product_mutation_idempotency",
		columns:     []string{"idempotency_key", "request_hash", "product_id", "operation", "result_version", "created_at"},
		constraints: []string{"central_product_mutation_idempotency_pkey", "central_product_idempotency_facts_uq", "central_product_idempotency_operation_chk", "central_product_idempotency_version_chk", "central_product_idempotency_product_fk"},
		indexes:     []string{"central_product_idempotency_product_idx"},
	},
	{
		name:        "dsh.central_product_audit",
		columns:     []string{"id", "event_type", "idempotency_key", "correlation_id", "acting_actor_id", "product_id", "from_version", "result_version", "request_hash", "canonical_name", "brand", "barcode", "canonical_image_url", "sell_unit", "active", "created_at"},
		constraints: []string{"central_product_audit_pkey", "central_product_audit_event_type_chk", "central_product_audit_event_idempotency_uq", "central_product_audit_product_fk", "central_product_audit_version_chk"},
		indexes:     []string{"central_product_audit_product_idx"},
	},
	{
		name:        "dsh.store_assortments",
		columns:     []string{"store_id", "product_id", "price_minor", "currency", "availability", "publication_state", "version", "created_at", "updated_at"},
		constraints: []string{"store_assortments_pkey", "store_assortments_store_fk", "store_assortments_product_fk", "store_assortments_price_chk", "store_assortments_currency_chk", "store_assortments_state_chk", "store_assortments_version_chk"},
		indexes:     []string{"store_assortments_store_idx", "store_assortments_public_idx"},
	},
	{
		name:        "dsh.store_assortment_mutation_idempotency",
		columns:     []string{"idempotency_key", "request_hash", "store_id", "product_id", "operation", "result_version", "created_at"},
		constraints: []string{"store_assortment_mutation_idempotency_pkey", "store_assortment_idempotency_facts_uq", "store_assortment_idempotency_operation_chk", "store_assortment_idempotency_version_chk", "store_assortment_idempotency_store_fk", "store_assortment_idempotency_product_fk"},
		indexes:     []string{"store_assortment_idempotency_store_idx"},
	},
	{
		name:        "dsh.store_assortment_audit",
		columns:     []string{"id", "event_type", "idempotency_key", "correlation_id", "acting_actor_id", "store_id", "product_id", "from_state", "to_state", "expected_version", "result_version", "request_hash", "price_minor", "currency", "availability", "created_at"},
		constraints: []string{"store_assortment_audit_pkey", "store_assortment_audit_event_type_chk", "store_assortment_audit_event_idempotency_uq", "store_assortment_audit_store_fk", "store_assortment_audit_product_fk", "store_assortment_audit_price_chk", "store_assortment_audit_currency_chk", "store_assortment_audit_version_chk"},
		indexes:     []string{"store_assortment_audit_store_idx"},
	},
	{
		name:        "dsh.store_publication_idempotency",
		columns:     []string{"idempotency_key", "request_hash", "store_id", "requested_state", "expected_version", "result_version", "result_state", "result_publication_changed_at", "result_updated_at", "created_at"},
		constraints: []string{"store_publication_idempotency_pkey", "store_publication_idempotency_facts_uq", "store_publication_idempotency_state_chk", "store_publication_idempotency_store_fk"},
		indexes:     []string{"store_publication_idempotency_store_idx"},
	},
	{
		name:        "dsh.store_publication_audit",
		columns:     []string{"id", "event_type", "idempotency_key", "correlation_id", "acting_actor_id", "store_id", "from_state", "to_state", "expected_version", "result_version", "request_hash", "requested_state", "created_at"},
		constraints: []string{"store_publication_audit_pkey", "store_publication_audit_event_type_chk", "store_publication_audit_event_idempotency_uq", "store_publication_audit_idempotency_fk"},
		indexes:     []string{"store_publication_audit_store_idx"},
	},
	{
		name:        "dsh.delivery_addresses",
		columns:     []string{"id", "client_actor_id", "address_text", "latitude", "longitude", "version", "created_at", "updated_at"},
		constraints: []string{"delivery_addresses_pkey", "delivery_addresses_text_chk", "delivery_addresses_latitude_chk", "delivery_addresses_longitude_chk", "delivery_addresses_version_chk"},
		indexes:     []string{"delivery_addresses_client_idx"},
	},
	{
		name:        "dsh.delivery_address_mutation_idempotency",
		columns:     []string{"idempotency_key", "request_hash", "address_id", "client_actor_id", "operation", "expected_version", "result_version", "created_at"},
		constraints: []string{"delivery_address_mutation_idempotency_pkey", "delivery_address_idempotency_facts_uq", "delivery_address_idempotency_operation_chk", "delivery_address_idempotency_expected_version_chk", "delivery_address_idempotency_result_version_chk", "delivery_address_idempotency_address_fk"},
		indexes:     []string{"delivery_address_idempotency_client_idx"},
	},
	{
		name:        "dsh.delivery_address_audit",
		columns:     []string{"id", "event_type", "idempotency_key", "correlation_id", "acting_actor_id", "client_actor_id", "address_id", "expected_version", "result_version", "request_hash", "address_text", "latitude", "longitude", "created_at"},
		constraints: []string{"delivery_address_audit_pkey", "delivery_address_audit_event_type_chk", "delivery_address_audit_event_idempotency_uq", "delivery_address_audit_address_fk", "delivery_address_audit_expected_version_chk", "delivery_address_audit_result_version_chk", "delivery_address_audit_text_chk", "delivery_address_audit_latitude_chk", "delivery_address_audit_longitude_chk"},
		indexes:     []string{"delivery_address_audit_client_idx"},
	},
	{
		name:        "dsh.store_origin_mutation_idempotency",
		columns:     []string{"idempotency_key", "request_hash", "store_id", "partner_actor_id", "expected_version", "result_version", "result_latitude", "result_longitude", "result_updated_at", "created_at"},
		constraints: []string{"store_origin_mutation_idempotency_pkey", "store_origin_idempotency_facts_uq", "store_origin_idempotency_expected_version_chk", "store_origin_idempotency_result_version_chk", "store_origin_idempotency_latitude_chk", "store_origin_idempotency_longitude_chk", "store_origin_idempotency_store_partner_fk"},
		indexes:     []string{"store_origin_idempotency_partner_idx"},
	},
	{
		name:        "dsh.store_origin_audit",
		columns:     []string{"id", "event_type", "idempotency_key", "correlation_id", "acting_actor_id", "partner_actor_id", "store_id", "expected_version", "result_version", "request_hash", "latitude", "longitude", "created_at"},
		constraints: []string{"store_origin_audit_pkey", "store_origin_audit_event_type_chk", "store_origin_audit_event_idempotency_uq", "store_origin_audit_store_partner_fk", "store_origin_audit_expected_version_chk", "store_origin_audit_result_version_chk", "store_origin_audit_latitude_chk", "store_origin_audit_longitude_chk"},
		indexes:     []string{"store_origin_audit_partner_idx"},
	},
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

func LoadMigrations(directory string) ([]MigrationRecord, []string, error) {
	if strings.TrimSpace(directory) == "" {
		return nil, nil, errors.New("DSH_MIGRATION_DIR is required")
	}
	names := []string{"001_partner_store_baseline.sql", "002_store_publication.sql", "003_joining_cases_and_catalog.sql", "004_central_product_store_assortment_cutover.sql", "005_joining_case_partner_correction.sql", "006_joining_case_correct_and_resubmit.sql", "007_location_core.sql"}
	records := make([]MigrationRecord, 0, len(names))
	sqls := make([]string, 0, len(names))
	for version, name := range names {
		raw, err := os.ReadFile(filepath.Join(directory, name))
		if err != nil {
			return nil, nil, fmt.Errorf("read DSH migration %s: %w", name, err)
		}
		if len(raw) == 0 {
			return nil, nil, fmt.Errorf("DSH migration %s is empty", name)
		}
		digest := sha256.Sum256(raw)
		records = append(records, MigrationRecord{Version: version + 1, Name: name, SHA256: hex.EncodeToString(digest[:])})
		sqls = append(sqls, string(raw))
	}
	return records, sqls, nil
}

func Migrate(ctx context.Context, db *sql.DB, records []MigrationRecord, migrationSQL []string) error {
	if db == nil || len(records) != SchemaVersion || len(migrationSQL) != len(records) {
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
	for _, record := range records {
		if record.Version > current {
			break
		}
		var name, digest string
		if err := tx.QueryRowContext(ctx, "SELECT name, sha256 FROM dsh.schema_migrations WHERE version=$1", record.Version).Scan(&name, &digest); err != nil {
			return fmt.Errorf("read DSH migration v%d: %w", record.Version, err)
		}
		if name != record.Name || digest != record.SHA256 {
			return fmt.Errorf("DSH migration checksum mismatch at v%d", record.Version)
		}
	}
	for index := current; index < SchemaVersion; index++ {
		record := records[index]
		if record.Version != current+1 {
			return fmt.Errorf("DSH migration v%d cannot follow schema v%d", record.Version, current)
		}
		if _, err := tx.ExecContext(ctx, migrationSQL[index]); err != nil {
			return fmt.Errorf("apply DSH canonical migration v%d: %w", record.Version, err)
		}
		if _, err := tx.ExecContext(ctx, "INSERT INTO dsh.schema_migrations(version, name, sha256) VALUES($1,$2,$3)", record.Version, record.Name, record.SHA256); err != nil {
			return fmt.Errorf("record DSH migration v%d: %w", record.Version, err)
		}
		current++
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit DSH migrations through v%d: %w", SchemaVersion, err)
	}
	return nil
}

func VerifySchema(ctx context.Context, db *sql.DB, records []MigrationRecord) error {
	if db == nil {
		return errors.New("DSH database is nil")
	}
	if len(records) != SchemaVersion {
		return errors.New("invalid DSH migration records")
	}
	if err := db.PingContext(ctx); err != nil {
		return fmt.Errorf("DSH database ping: %w", err)
	}
	var count int
	if err := db.QueryRowContext(ctx, "SELECT COUNT(*) FROM dsh.schema_migrations").Scan(&count); err != nil {
		return fmt.Errorf("DSH migration history count: %w", err)
	}
	if count != len(records) {
		return fmt.Errorf("DSH migration history count mismatch: got %d want %d", count, len(records))
	}
	for _, record := range records {
		var version int
		var name, digest string
		if err := db.QueryRowContext(ctx, "SELECT version, name, sha256 FROM dsh.schema_migrations WHERE version=$1", record.Version).Scan(&version, &name, &digest); err != nil {
			return fmt.Errorf("DSH migration readback v%d: %w", record.Version, err)
		}
		if version != record.Version || name != record.Name || digest != record.SHA256 {
			return fmt.Errorf("DSH migration history does not match canonical v%d", record.Version)
		}
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
		for _, constraint := range table.constraints {
			var exists bool
			if err := db.QueryRowContext(ctx, "SELECT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid=$1::regclass AND conname=$2)", table.name, constraint).Scan(&exists); err != nil {
				return fmt.Errorf("DSH constraint check %s.%s: %w", table.name, constraint, err)
			}
			if !exists {
				return fmt.Errorf("DSH required constraint missing: %s.%s", table.name, constraint)
			}
		}
		for _, index := range table.indexes {
			var exists bool
			if err := db.QueryRowContext(ctx, "SELECT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname=$1 AND tablename=$2 AND indexname=$3)", parts[0], parts[1], index).Scan(&exists); err != nil {
				return fmt.Errorf("DSH index check %s.%s: %w", table.name, index, err)
			}
			if !exists {
				return fmt.Errorf("DSH required index missing: %s.%s", table.name, index)
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
