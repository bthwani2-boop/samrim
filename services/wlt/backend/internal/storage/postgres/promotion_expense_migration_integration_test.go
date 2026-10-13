package postgres

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/bthwani2-boop/samrim/services/wlt/backend/internal/opsafety"
	"github.com/lib/pq"
)

func TestPromotionExpenseV47UpgradePreservesExistingLedger(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("WLT_MIGRATION_TEST_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("isolated migration database not configured")
	}
	if os.Getenv("BTHWANI_ENV") != "test" {
		t.Fatal("refuse WLT migration proof outside test environment")
	}
	if _, err := opsafety.RequireExpectedDatabaseTarget(databaseURL, os.Getenv); err != nil {
		t.Fatal(err)
	}
	db, err := Open(databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(4)
	t.Cleanup(func() { _ = db.Close() })
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	t.Cleanup(cancel)
	var pristine bool
	if err := db.QueryRowContext(ctx,
		"SELECT to_regclass('wlt.schema_migrations') IS NULL AND to_regclass('wlt.payment_intents') IS NULL").Scan(&pristine); err != nil || !pristine {
		t.Fatalf("refuse reused migration database: pristine=%t err=%v", pristine, err)
	}
	dir := filepath.Join("..", "..", "..", "..", "database", "migrations")
	records, statements, err := LoadMigrations(dir)
	if err != nil {
		t.Fatal(err)
	}
	if err := applyWLTMigrationPrefix(ctx, db, records, statements, 46); err != nil {
		t.Fatalf("install canonical adopted v46 schema: %v", err)
	}
	const txID = "promotion-migration-ledger"
	_, err = db.ExecContext(ctx, `INSERT INTO wlt.ledger_transactions
		(id,transaction_type,source_type,source_id,currency,idempotency_key,request_hash,correlation_id)
		VALUES($1,'PARTNER_ORDER_EARNING_POSTED','ORDER_DELIVERED',$1,'YER',$1,'proof','promotion-migration-correlation')`, txID)
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.ExecContext(ctx, `INSERT INTO wlt.ledger_entries
		(transaction_id,line_sequence,account_class,account_code,direction,amount_minor,currency)
		VALUES($1,1,'asset','CAPTAIN_CASH_RECEIVABLE','DEBIT',100,'YER')`, txID)
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.ExecContext(ctx, `INSERT INTO wlt.ledger_entries
		(transaction_id,line_sequence,account_class,account_code,direction,amount_minor,currency)
		VALUES($1,2,'expense','BTHWANI_PROMOTION_EXPENSE','DEBIT',100,'YER')`, txID)
	var pgErr *pq.Error
	if !errors.As(err, &pgErr) || pgErr.Code != "23514" || pgErr.Constraint != "ledger_entries_code_chk" {
		t.Fatalf("v46 should reject platform subsidy expense code: %v", err)
	}
	if err := Migrate(ctx, db, records, statements); err != nil {
		t.Fatalf("v46 to v47 upgrade failed: %v", err)
	}
	if err := VerifySchema(ctx, db, records); err != nil {
		t.Fatal(err)
	}
	var existingCount int
	if err := db.QueryRowContext(ctx, `SELECT COUNT(*) FROM wlt.ledger_entries
		WHERE transaction_id=$1 AND account_code='CAPTAIN_CASH_RECEIVABLE' AND amount_minor=100`, txID).Scan(&existingCount); err != nil || existingCount != 1 {
		t.Fatalf("v46 ledger entry lost: count=%d err=%v", existingCount, err)
	}
	_, err = db.ExecContext(ctx, `INSERT INTO wlt.ledger_entries
		(transaction_id,line_sequence,account_class,account_code,direction,amount_minor,currency)
		VALUES($1,2,'expense','BTHWANI_PROMOTION_EXPENSE','DEBIT',100,'YER')`, txID)
	if err != nil {
		t.Fatalf("v47 must admit platform subsidy expense: %v", err)
	}
	var version, expenseCount int
	if err := db.QueryRowContext(ctx, "SELECT MAX(version) FROM wlt.schema_migrations").Scan(&version); err != nil || version != 47 {
		t.Fatalf("unexpected upgraded schema version=%d err=%v", version, err)
	}
	if err := db.QueryRowContext(ctx, `SELECT COUNT(*) FROM wlt.ledger_entries
		WHERE transaction_id=$1 AND account_code='BTHWANI_PROMOTION_EXPENSE'`, txID).Scan(&expenseCount); err != nil || expenseCount != 1 {
		t.Fatalf("upgraded subsidy expense not persisted: count=%d err=%v", expenseCount, err)
	}
}
