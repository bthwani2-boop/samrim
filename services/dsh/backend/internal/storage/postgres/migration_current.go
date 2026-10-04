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
)

// CanonicalSchemaVersion is the exact DSH schema version owned by the current source tree.
const CanonicalSchemaVersion = 95

var canonicalMigrationTail = []string{
	"085_store_operational_availability.sql",
	"086_store_scoped_access_delegation.sql",
	"087_order_recipient_and_adjustments.sql",
	"088_store_access_invitation_reuse.sql",
	"089_store_access_permission_updates.sql",
	"090_order_store_orderability_snapshot.sql",
	"091_order_adjustment_financial_handoff.sql",
	"092_joining_case_store_intake_details.sql",
	"093_catalog_mixed_scope_and_store_skus.sql",
	"094_store_go_live_notifications.sql",
	"095_wallet_provider_intent.sql",
}

type schemaRelationExpectation struct {
	name             string
	columns          []string
	forbiddenColumns []string
	constraints      []string
	indexes          []string
}

var journeyRefoundationRelations = []schemaRelationExpectation{
	{
		name:        "dsh.stores",
		columns:     []string{"address_text", "business_working_hours"},
		constraints: []string{"stores_address_text_chk", "stores_business_working_hours_chk"},
	},
	{
		name:        "dsh.joining_cases",
		columns:     []string{"owner_full_name", "first_store_address", "first_store_working_hours", "first_store_proof_type", "first_store_notes"},
		constraints: []string{"joining_cases_owner_full_name_chk", "joining_cases_first_store_address_chk", "joining_cases_first_store_working_hours_chk", "joining_cases_first_store_proof_type_chk", "joining_cases_first_store_notes_chk"},
	},
	{
		name:        "dsh.store_operational_availability",
		columns:     []string{"store_id", "schedule_mode", "schedule_timezone", "weekly_schedule", "paused", "pause_reason", "pause_until", "preparation_minutes", "unavailable_fulfillment_modes", "version", "updated_by_actor_id", "updated_at"},
		constraints: []string{"store_operational_availability_pkey", "store_operational_availability_store_id_fkey", "store_operational_availability_schedule_mode_chk", "store_operational_availability_timezone_chk", "store_operational_availability_schedule_chk", "store_operational_availability_pause_chk", "store_operational_availability_preparation_chk", "store_operational_availability_modes_chk", "store_operational_availability_version_chk", "store_operational_availability_actor_chk"},
		indexes:     []string{"store_operational_availability_updated_idx"},
	},
	{
		name:        "dsh.store_operational_availability_idempotency",
		columns:     []string{"idempotency_key", "request_hash", "store_id", "acting_actor_id", "result_version", "created_at"},
		constraints: []string{"store_operational_availability_idempotency_pkey", "store_operational_availability_idempotency_store_id_fkey", "store_operational_availability_idem_key_chk", "store_operational_availability_idem_hash_chk", "store_operational_availability_idem_actor_chk", "store_operational_availability_idem_version_chk"},
	},
	{
		name:        "dsh.store_operational_availability_audit",
		columns:     []string{"id", "store_id", "event_type", "idempotency_key", "correlation_id", "acting_actor_id", "authority_source", "expected_version", "result_version", "request_hash", "created_at"},
		constraints: []string{"store_operational_availability_audit_pkey", "store_operational_availability_audit_store_id_fkey", "store_operational_availability_audit_idempotency_key_key", "store_operational_availability_audit_idempotency_key_fkey", "store_operational_availability_audit_event_chk", "store_operational_availability_audit_correlation_chk", "store_operational_availability_audit_actor_chk", "store_operational_availability_audit_authority_chk", "store_operational_availability_audit_version_chk", "store_operational_availability_audit_hash_chk"},
	},
	{
		name:        "dsh.store_access_grants",
		columns:     []string{"id", "store_id", "owner_partner_actor_id", "delegate_actor_id", "permissions", "state", "version", "expires_at", "accepted_at", "declined_at", "revoked_at", "created_at", "updated_at"},
		constraints: []string{"store_access_grants_pkey", "store_access_grants_id_chk", "store_access_grants_owner_delegate_chk", "store_access_grants_permissions_chk", "store_access_grants_state_chk", "store_access_grants_version_chk", "store_access_grants_time_chk", "store_access_grants_state_facts_chk", "store_access_grants_store_owner_fk"},
		indexes:     []string{"store_access_grants_current_delegate_uq", "store_access_grants_owner_idx", "store_access_grants_delegate_idx", "store_access_grants_store_delegate_idx"},
	},
	{
		name:        "dsh.store_access_grant_idempotency",
		columns:     []string{"idempotency_key", "request_hash", "operation", "grant_id", "acting_actor_id", "result_state", "result_version", "created_at"},
		constraints: []string{"store_access_grant_idempotency_pkey", "store_access_grant_idempotency_grant_id_fkey", "store_access_grant_idem_key_chk", "store_access_grant_idem_hash_chk", "store_access_grant_idem_operation_chk", "store_access_grant_idem_state_chk", "store_access_grant_idem_version_chk"},
	},
	{
		name:        "dsh.store_access_grant_audit",
		columns:     []string{"id", "event_type", "idempotency_key", "correlation_id", "acting_actor_id", "owner_partner_actor_id", "delegate_actor_id", "store_id", "grant_id", "from_state", "to_state", "expected_version", "result_version", "request_hash", "created_at"},
		constraints: []string{"store_access_grant_audit_pkey", "store_access_grant_audit_idempotency_key_key", "store_access_grant_audit_idempotency_key_fkey", "store_access_grant_audit_grant_id_fkey", "store_access_grant_audit_event_chk", "store_access_grant_audit_correlation_chk", "store_access_grant_audit_state_chk", "store_access_grant_audit_version_chk", "store_access_grant_audit_hash_chk", "store_access_grant_audit_store_owner_fk"},
		indexes:     []string{"store_access_grant_audit_store_idx"},
	},
	{
		name:        "dsh.commerce_orders",
		columns:     []string{"recipient_mode", "recipient_name", "recipient_phone_e164", "recipient_instructions"},
		constraints: []string{"commerce_orders_recipient_mode_chk", "commerce_orders_recipient_facts_chk"},
	},
	{
		name:        "dsh.commerce_order_store_orderability_snapshots",
		columns:     []string{"order_id", "availability_version", "orderability_state", "evaluated_at"},
		constraints: []string{"commerce_order_store_orderability_snapshots_pkey", "commerce_order_store_orderability_snapshots_order_id_fkey", "commerce_order_store_orderability_version_chk", "commerce_order_store_orderability_state_chk"},
	},
	{
		name:    "dsh.commerce_order_adjustments",
		columns: []string{"id", "order_id", "order_line_id", "kind", "state", "replacement_store_offer_id", "replacement_variant_id", "actual_quantity_base_units", "customer_decision_required", "requested_by_actor_id", "requested_by_role", "customer_actor_id", "customer_decided_at", "applied_at", "version", "created_at", "updated_at"},
		constraints: []string{
			"commerce_order_adjustments_pkey", "commerce_order_adjustments_order_id_fkey", "commerce_order_adjustments_order_line_id_fkey", "commerce_order_adjustments_replacement_store_offer_id_fkey", "commerce_order_adjustments_replacement_variant_id_fkey",
			"commerce_order_adjustments_id_chk", "commerce_order_adjustments_kind_chk", "commerce_order_adjustments_state_chk", "commerce_order_adjustments_role_chk", "commerce_order_adjustments_requester_chk", "commerce_order_adjustments_customer_actor_chk", "commerce_order_adjustments_version_chk", "commerce_order_adjustments_kind_facts_chk", "commerce_order_adjustments_decision_chk", "commerce_order_adjustments_decision_evidence_chk", "commerce_order_adjustments_terminal_facts_chk",
		},
		indexes: []string{"commerce_order_adjustments_open_line_uq", "commerce_order_adjustments_order_idx"},
	},
	{
		name:        "dsh.commerce_order_adjustment_idempotency",
		columns:     []string{"idempotency_key", "request_hash", "operation", "adjustment_id", "acting_actor_id", "result_state", "result_version", "created_at"},
		constraints: []string{"commerce_order_adjustment_idempotency_pkey", "commerce_order_adjustment_idempotency_adjustment_id_fkey", "commerce_order_adjustment_idem_key_chk", "commerce_order_adjustment_idem_hash_chk", "commerce_order_adjustment_idem_operation_chk", "commerce_order_adjustment_idem_state_chk", "commerce_order_adjustment_idem_version_chk"},
	},
	{
		name:        "dsh.commerce_order_adjustment_audit",
		columns:     []string{"id", "event_type", "idempotency_key", "correlation_id", "acting_actor_id", "order_id", "adjustment_id", "from_state", "to_state", "expected_version", "result_version", "request_hash", "created_at"},
		constraints: []string{"commerce_order_adjustment_audit_pkey", "commerce_order_adjustment_audit_idempotency_key_key", "commerce_order_adjustment_audit_idempotency_key_fkey", "commerce_order_adjustment_audit_order_id_fkey", "commerce_order_adjustment_audit_adjustment_id_fkey", "commerce_order_adjustment_audit_event_chk", "commerce_order_adjustment_audit_correlation_chk", "commerce_order_adjustment_audit_actor_chk", "commerce_order_adjustment_audit_state_chk", "commerce_order_adjustment_audit_version_chk", "commerce_order_adjustment_audit_hash_chk"},
		indexes:     []string{"commerce_order_adjustment_audit_order_idx"},
	},
	{
		name:        "dsh.joining_case_private_evidence",
		columns:     []string{"joining_case_id", "proof_number_key_id", "proof_number_ciphertext", "proof_image_key_id", "proof_image_ciphertext", "proof_image_content_type", "proof_image_ciphertext_sha256", "proof_image_byte_size", "proof_image_uploaded_at", "created_at", "updated_at"},
		constraints: []string{"joining_case_private_evidence_pkey", "joining_case_private_evidence_case_fk", "joining_case_private_evidence_key_id_chk", "joining_case_private_evidence_image_key_id_chk", "joining_case_private_evidence_image_content_type_chk", "joining_case_private_evidence_image_ciphertext_sha_chk", "joining_case_private_evidence_image_size_chk", "joining_case_private_evidence_image_pair_chk"},
	},
	{
		name:        "dsh.joining_case_private_evidence_audit",
		columns:     []string{"id", "joining_case_id", "event_type", "idempotency_key", "correlation_id", "acting_actor_id", "authority_source", "expected_version", "result_version", "request_hash", "created_at"},
		constraints: []string{"joining_case_private_evidence_audit_pkey", "joining_case_private_evidence_audit_case_fk", "joining_case_private_evidence_audit_event_chk", "joining_case_private_evidence_audit_authority_chk", "joining_case_private_evidence_audit_expected_version_chk", "joining_case_private_evidence_audit_result_version_chk", "joining_case_private_evidence_audit_idempotency_chk", "joining_case_private_evidence_audit_request_hash_chk", "joining_case_private_evidence_audit_correlation_chk", "joining_case_private_evidence_audit_actor_chk"},
		indexes:     []string{"joining_case_private_evidence_upload_idempotency_uq", "joining_case_private_evidence_audit_case_idx"},
	},
}

func LoadCanonicalMigrations(directory string) ([]MigrationRecord, []string, error) {
	baseRecords, baseSQL, err := LoadMigrations(directory)
	if err != nil {
		return nil, nil, err
	}
	if len(baseRecords) != SchemaVersion || len(baseSQL) != SchemaVersion {
		return nil, nil, fmt.Errorf("legacy DSH migration graph is not canonical through v%d", SchemaVersion)
	}
	records := append([]MigrationRecord(nil), baseRecords...)
	sqls := append([]string(nil), baseSQL...)
	for offset, name := range canonicalMigrationTail {
		raw, err := os.ReadFile(filepath.Join(directory, name))
		if err != nil {
			return nil, nil, fmt.Errorf("read DSH migration %s: %w", name, err)
		}
		if len(raw) == 0 {
			return nil, nil, fmt.Errorf("DSH migration %s is empty", name)
		}
		digest := sha256.Sum256(raw)
		records = append(records, MigrationRecord{Version: SchemaVersion + offset + 1, Name: name, SHA256: hex.EncodeToString(digest[:])})
		sqls = append(sqls, string(raw))
	}
	if len(records) != CanonicalSchemaVersion || len(sqls) != CanonicalSchemaVersion {
		return nil, nil, fmt.Errorf("canonical DSH migration graph size is %d; want %d", len(records), CanonicalSchemaVersion)
	}
	return records, sqls, nil
}

func MigrateCanonical(ctx context.Context, db *sql.DB, records []MigrationRecord, migrationSQL []string, proofKeys *DeliveryProofKeyring) error {
	if db == nil || len(records) != CanonicalSchemaVersion || len(migrationSQL) != len(records) {
		return errors.New("invalid canonical DSH migration input")
	}
	if proofKeys == nil {
		return errors.New("DSH delivery proof keyring is required for schema migration")
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("DSH canonical migration transaction: %w", err)
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
	if current > CanonicalSchemaVersion {
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
	for index := current; index < CanonicalSchemaVersion; index++ {
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
		return fmt.Errorf("commit DSH migrations through v%d: %w", CanonicalSchemaVersion, err)
	}
	if err := MigrateDeliveryProofCryptography(ctx, db, proofKeys); err != nil {
		return fmt.Errorf("migrate DSH delivery proof material: %w", err)
	}
	return nil
}

func VerifyCanonicalSchema(ctx context.Context, db *sql.DB, records []MigrationRecord) error {
	if db == nil {
		return errors.New("DSH database is nil")
	}
	if len(records) != CanonicalSchemaVersion {
		return errors.New("invalid canonical DSH migration records")
	}
	if err := db.PingContext(ctx); err != nil {
		return fmt.Errorf("DSH database ping: %w", err)
	}
	var count int
	if err := db.QueryRowContext(ctx, "SELECT COUNT(*) FROM dsh.schema_migrations").Scan(&count); err != nil {
		return fmt.Errorf("DSH migration history count: %w", err)
	}
	if count != CanonicalSchemaVersion {
		return fmt.Errorf("DSH migration history count mismatch: got %d want %d", count, CanonicalSchemaVersion)
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

func verifySchemaRelation(ctx context.Context, db *sql.DB, name string, columns, forbiddenColumns, constraints, indexes []string) error {
	var exists bool
	if err := db.QueryRowContext(ctx, "SELECT to_regclass($1) IS NOT NULL", name).Scan(&exists); err != nil {
		return fmt.Errorf("DSH relation check %s: %w", name, err)
	}
	if !exists {
		return fmt.Errorf("DSH required relation missing: %s", name)
	}
	parts := strings.SplitN(name, ".", 2)
	if len(parts) != 2 {
		return fmt.Errorf("invalid DSH relation name: %s", name)
	}
	rows, err := db.QueryContext(ctx, "SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2", parts[0], parts[1])
	if err != nil {
		return fmt.Errorf("DSH columns %s: %w", name, err)
	}
	found := map[string]bool{}
	for rows.Next() {
		var column string
		if err := rows.Scan(&column); err != nil {
			_ = rows.Close()
			return fmt.Errorf("DSH column scan %s: %w", name, err)
		}
		found[column] = true
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return fmt.Errorf("DSH column rows %s: %w", name, err)
	}
	if err := rows.Close(); err != nil {
		return fmt.Errorf("DSH column close %s: %w", name, err)
	}
	for _, column := range columns {
		if !found[column] {
			return fmt.Errorf("DSH required column missing: %s.%s", name, column)
		}
	}
	for _, column := range forbiddenColumns {
		if found[column] {
			return fmt.Errorf("DSH forbidden legacy column remains: %s.%s", name, column)
		}
	}
	for _, constraint := range constraints {
		var present bool
		if err := db.QueryRowContext(ctx, "SELECT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid=$1::regclass AND conname=$2)", name, constraint).Scan(&present); err != nil {
			return fmt.Errorf("DSH constraint check %s.%s: %w", name, constraint, err)
		}
		if !present {
			return fmt.Errorf("DSH required constraint missing: %s.%s", name, constraint)
		}
	}
	for _, index := range indexes {
		var present bool
		if err := db.QueryRowContext(ctx, "SELECT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname=$1 AND tablename=$2 AND indexname=$3)", parts[0], parts[1], index).Scan(&present); err != nil {
			return fmt.Errorf("DSH index check %s.%s: %w", name, index, err)
		}
		if !present {
			return fmt.Errorf("DSH required index missing: %s.%s", name, index)
		}
	}
	return nil
}
