package postgres

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"
)

// Database startup must fail if someone weakens or removes the canonical Store
// relationship checks; checking constraint names alone is insufficient.
func verifyStoreRelationConstraints(ctx context.Context, db *sql.DB) error {
	var nullable, defaultValue string
	if err := db.QueryRowContext(ctx, `SELECT is_nullable, column_default
		FROM information_schema.columns
		WHERE table_schema='dsh' AND table_name='stores' AND column_name='relation_model'`).Scan(&nullable, &defaultValue); err != nil {
		return fmt.Errorf("read Store relation column: %w", err)
	}
	if nullable != "NO" || !strings.Contains(defaultValue, "BTHWANI_PARTNER") {
		return errors.New("DSH Store relation column default/nullability is invalid")
	}
	for _, requirement := range []struct {
		name   string
		tokens []string
	}{
		{"stores_relation_model_chk", []string{"CHECK", "relation_model", "BTHWANI_PARTNER", "INDEPENDENT_STORE"}},
		{"stores_independent_market_publication_chk", []string{"CHECK", "relation_model", "BTHWANI_PARTNER", "publication_state", "published", " OR ", "<>"}},
	} {
		var definition string
		var validated bool
		if err := db.QueryRowContext(ctx, `SELECT pg_get_constraintdef(oid), convalidated
			FROM pg_constraint
			WHERE conrelid='dsh.stores'::regclass AND conname=$1 AND contype='c'`, requirement.name).Scan(&definition, &validated); err != nil {
			return fmt.Errorf("read DSH Store constraint %s: %w", requirement.name, err)
		}
		if !validated {
			return fmt.Errorf("DSH Store constraint %s has not been validated", requirement.name)
		}
		for _, token := range requirement.tokens {
			if !strings.Contains(definition, token) {
				return fmt.Errorf("DSH Store constraint %s has an unexpected definition", requirement.name)
			}
		}
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
		if version != record.Version || name != record.Name || (digest != record.SHA256 && !acceptHistoricalV130Migration(ctx, db, record, digest)) {
			return fmt.Errorf("DSH migration history does not match canonical v%d", record.Version)
		}
	}
	for _, relation := range requiredTables {
		if err := verifySchemaRelation(ctx, db, relation.name, relation.columns, relation.forbiddenColumns, relation.constraints, relation.indexes); err != nil {
			return err
		}
	}
	for _, relation := range journeyRefoundationRelations {
		if err := verifySchemaRelation(ctx, db, relation.name, relation.columns, relation.forbiddenColumns, relation.constraints, relation.indexes); err != nil {
			return err
		}
	}
	if err := verifyStoreRelationConstraints(ctx, db); err != nil {
		return err
	}
	// Merchant-direct orders have one canonical DSH Order owner. The
	// unadmitted parallel storage retired in migration 176 must not return.
	for _, retired := range []string{
		"dsh.independent_direct_orders",
		"dsh.independent_direct_order_lines",
		"dsh.independent_direct_order_idempotency",
		"dsh.independent_direct_order_audit",
	} {
		var stillPresent bool
		if err := db.QueryRowContext(ctx, "SELECT to_regclass($1) IS NOT NULL", retired).Scan(&stillPresent); err != nil {
			return fmt.Errorf("verify retired direct Order storage %s: %w", retired, err)
		}
		if stillPresent {
			return fmt.Errorf("retired parallel direct Order storage still exists: %s", retired)
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

// VerifyOperationalReadiness is a bounded ongoing probe. The owning migrate
// one-shot proves every migration checksum and schema relation before API startup;
// repeating that full catalog audit on each Docker healthcheck is unnecessary.
func VerifyOperationalReadiness(ctx context.Context, db *sql.DB, records []MigrationRecord) error {
	if db == nil || len(records) != SchemaVersion {
		return errors.New("invalid DSH operational readiness input")
	}
	if err := db.PingContext(ctx); err != nil {
		return fmt.Errorf("DSH readiness database ping: %w", err)
	}
	var count, latest int
	if err := db.QueryRowContext(ctx, "SELECT COUNT(*), COALESCE(MAX(version),0) FROM dsh.schema_migrations").Scan(&count, &latest); err != nil {
		return fmt.Errorf("DSH readiness migration history: %w", err)
	}
	if count != SchemaVersion || latest != SchemaVersion {
		return fmt.Errorf("DSH readiness migration versions: count=%d latest=%d expected=%d", count, latest, SchemaVersion)
	}
	last := records[len(records)-1]
	var name, digest string
	if err := db.QueryRowContext(ctx, "SELECT name, sha256 FROM dsh.schema_migrations WHERE version=$1", last.Version).Scan(&name, &digest); err != nil {
		return fmt.Errorf("DSH readiness latest migration: %w", err)
	}
	if name != last.Name || digest != last.SHA256 {
		return errors.New("DSH readiness latest migration checksum mismatch")
	}
	return nil
}

func VerifyDeliveryProofKeyring(ctx context.Context, db *sql.DB, keys *DeliveryProofKeyring) error {
	if db == nil || keys == nil {
		return errors.New("DSH delivery proof keyring is unavailable")
	}
	rows, err := db.QueryContext(ctx, `SELECT code_key_id FROM dsh.commerce_order_delivery_proofs WHERE state='PENDING'
		UNION SELECT split_part(request_hash,'.',2) FROM dsh.commerce_order_transition_idempotency WHERE request_hash LIKE 'v1.%'
		UNION SELECT split_part(request_hash,'.',2) FROM dsh.captain_operation_idempotency WHERE operation='complete' AND request_hash LIKE 'v1.%'`)
	if err != nil {
		return fmt.Errorf("read DSH delivery proof key references: %w", err)
	}
	defer func() { _ = rows.Close() }()
	for rows.Next() {
		var keyID string
		if err := rows.Scan(&keyID); err != nil {
			return fmt.Errorf("scan DSH delivery proof key reference: %w", err)
		}
		if !keys.HasKey(keyID) {
			return fmt.Errorf("DSH delivery proof keyring is missing referenced key %q", keyID)
		}
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("read DSH delivery proof key references: %w", err)
	}
	return nil
}
