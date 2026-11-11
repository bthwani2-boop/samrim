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
	entries, err := os.ReadDir(directory)
	if err != nil {
		return nil, nil, fmt.Errorf("read WLT migration directory: %w", err)
	}
	// The sequential files are the single authored migration catalog.
	// Reject gaps, extras and nonregular SQL paths rather than silently skipping them.
	names := make([]string, 0, len(entries))
	for _, entry := range entries {
		if !strings.HasSuffix(entry.Name(), ".sql") {
			continue
		}
		if !entry.Type().IsRegular() {
			return nil, nil, fmt.Errorf("WLT migration %q is not a regular file", entry.Name())
		}
		names = append(names, entry.Name())
	}
	if len(names) == 0 {
		return nil, nil, errors.New("WLT migration directory has no SQL files")
	}
	for version, name := range names {
		if !strings.HasPrefix(name, fmt.Sprintf("%03d_", version+1)) {
			return nil, nil, fmt.Errorf("invalid WLT migration order at v%d: %q", version+1, name)
		}
	}
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
	if db == nil || len(records) == 0 || len(records) != len(migrationSQL) {
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
	if current > len(records) {
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
	for index := current; index < len(records); index++ {
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
	if db == nil || len(records) == 0 {
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
	for _, relation := range []string{"wlt.payment_intents", "wlt.payment_intent_events", "wlt.cash_remittances", "wlt.cash_remittance_events", "wlt.partner_financial_profiles", "wlt.partner_financial_profile_events", "wlt.partner_financial_terms_policies", "wlt.partner_financial_terms_policy_events", "wlt.partner_commission_rate_history", "wlt.customer_payment_allocations", "wlt.customer_payment_allocation_events", "wlt.partner_store_commission_policies_legacy", "wlt.partner_store_commission_policy_initializations_legacy", "wlt.partner_store_commission_policy_events_legacy", "wlt.commercial_store_type_commission_defaults", "wlt.commercial_store_type_commission_default_events", "wlt.store_relation_commercial_model_defaults", "wlt.store_relation_commercial_model_default_events", "wlt.store_commercial_agreements", "wlt.store_commercial_agreement_rates", "wlt.store_commercial_agreement_events", "wlt.delivery_fee_policies", "wlt.delivery_fee_policy_events", "wlt.ledger_transactions", "wlt.ledger_entries", "wlt.partner_order_earnings", "wlt.partner_store_cash_commissions", "wlt.partner_commission_remittances", "wlt.official_wallet_destinations", "wlt.official_wallet_destination_transitions", "wlt.payout_requests", "wlt.beneficiary_settlement_intakes", "wlt.payout_holds", "wlt.field_acquisition_reward_policies", "wlt.field_acquisition_entitlements", "wlt.approved_payout_snapshots", "wlt.settlement_batches", "wlt.settlement_batch_items", "wlt.manual_transfer_executions", "wlt.payout_audit_events", "wlt.finance_evidence_documents", "wlt.finance_transfer_receipt_claims", "wlt.settlement_statements", "wlt.settlement_statement_rows", "wlt.settlement_batch_exports", "wlt.captain_minimum_balance_policies", "wlt.captain_wallet_funding", "wlt.captain_cod_reservations", "wlt.captain_cod_reservation_events", "wlt.captain_cod_legacy_recovery_reviews", "wlt.cash_in_funding_intents", "wlt.cash_in_funding_intent_events", "wlt.customer_manual_withdrawal_intakes", "wlt.customer_manual_withdrawal_events", "wlt.order_adjustment_reconciliation_cases", "wlt.customer_wallet_compensations", "wlt.store_payout_recipient_assignments", "wlt.store_payout_recipient_events"} {
		var exists bool
		if err := db.QueryRowContext(ctx, "SELECT to_regclass($1) IS NOT NULL", relation).Scan(&exists); err != nil {
			return fmt.Errorf("WLT relation check %s: %w", relation, err)
		}
		if !exists {
			return fmt.Errorf("WLT required relation missing: %s", relation)
		}
	}
	for _, column := range []string{"finance_decision_by_actor_id", "finance_decision_at", "finance_decision_reason", "commercial_model", "recurring_amount_minor", "billing_period", "billing_timezone", "invoice_due_days", "grace_days", "renewal_policy", "termination_terms", "adjustment_terms"} {
		var exists bool
		if err := db.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='wlt' AND table_name='store_commercial_agreements' AND column_name=$1)`, column).Scan(&exists); err != nil {
			return fmt.Errorf("WLT Store agreement column check %s: %w", column, err)
		}
		if !exists {
			return fmt.Errorf("WLT required column missing: wlt.store_commercial_agreements.%s", column)
		}
	}
	for _, column := range []string{"wlt.partner_order_earnings.store_id"} {
		var exists bool
		if err := db.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 AND column_name=$3)`, "wlt", "partner_order_earnings", "store_id").Scan(&exists); err != nil {
			return fmt.Errorf("WLT partner earnings column check: %w", err)
		}
		if !exists {
			return fmt.Errorf("WLT required column missing: %s", column)
		}
	}
	return nil
}
