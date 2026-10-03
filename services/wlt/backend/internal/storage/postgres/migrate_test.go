package postgres

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestCanonicalMigrationGraphRegistersEveryMigrationFile(t *testing.T) {
	directory := filepath.Join("..", "..", "..", "..", "database", "migrations")
	entries, err := os.ReadDir(directory)
	if err != nil {
		t.Fatalf("read canonical WLT migrations: %v", err)
	}
	files := make([]string, 0, len(entries))
	for _, entry := range entries {
		if !entry.IsDir() && strings.HasSuffix(entry.Name(), ".sql") {
			files = append(files, entry.Name())
		}
	}
	records, migrationSQL, err := LoadMigrations(directory)
	if err != nil {
		t.Fatalf("load canonical WLT migrations: %v", err)
	}
	if len(records) != SchemaVersion || len(migrationSQL) != SchemaVersion || len(records) != len(files) {
		t.Fatalf("WLT migration graph is incomplete: records=%d SQL=%d files=%d schema=%d", len(records), len(migrationSQL), len(files), SchemaVersion)
	}
	for index, file := range files {
		if records[index].Name != file || records[index].Version != index+1 {
			t.Fatalf("WLT migration graph entry %d = v%d %q; want v%d %q", index, records[index].Version, records[index].Name, index+1, file)
		}
	}
}

func TestStoreTypeCommissionCutoverArchivesOldRatesBeforeDroppingOwners(t *testing.T) {
	directory := filepath.Join("..", "..", "..", "..", "database", "migrations")
	data, err := os.ReadFile(filepath.Join(directory, "034_store_type_commission_owns_rate.sql"))
	if err != nil {
		t.Fatalf("read store type commission cutover: %v", err)
	}
	sql := string(data)
	archive := strings.Index(sql, "CREATE TABLE wlt.partner_commission_rate_history")
	profileCopy := strings.Index(sql, "FROM wlt.partner_financial_profiles")
	eventCopy := strings.Index(sql, "FROM wlt.partner_financial_profile_events")
	policyCopy := strings.Index(sql, "FROM wlt.partner_financial_terms_policies")
	drop := strings.Index(sql, "DROP COLUMN commission_rate_bps")
	if archive < 0 || profileCopy < archive || eventCopy < profileCopy || policyCopy < eventCopy || drop < policyCopy {
		t.Fatal("commission rates must be copied to inactive history before live profile and terms owners are removed")
	}
}

func TestCaptainCODRemittanceReopensUnverifiedClosures(t *testing.T) {
	directory := filepath.Join("..", "..", "..", "..", "database", "migrations")
	data, err := os.ReadFile(filepath.Join(directory, "035_captain_cod_remittance_reconciliation.sql"))
	if err != nil {
		t.Fatalf("read COD remittance reconciliation migration: %v", err)
	}
	sql := string(data)
	for _, required := range []string{
		"SET state='SUBMITTED'",
		"state='REMITTED' AND reconciled_by IS NOT NULL",
		"CASH_REMITTANCE_REOPENING",
		"CAPTAIN_CASH_REMITTANCE_REOPENED",
		"CASH_REMITTANCE_RECONCILED",
		"receipt_document_id",
		"CAPTAIN_COD_REMITTANCE_REOPENED",
	} {
		if !strings.Contains(sql, required) {
			t.Fatalf("COD remittance migration is missing %q", required)
		}
	}
	if strings.Index(sql, "CASH_REMITTANCE_REOPENING") > strings.Index(sql, "CREATE INDEX cash_remittances_unreconciled_idx") {
		t.Fatal("unverified COD receipts must be reversed before the new reconciliation queue is enabled")
	}
}

func TestPartnerCommissionRemittanceRequiresLinkedTransferReceipt(t *testing.T) {
	directory := filepath.Join("..", "..", "..", "..", "database", "migrations")
	data, err := os.ReadFile(filepath.Join(directory, "036_partner_commission_remittance_receipts.sql"))
	if err != nil {
		t.Fatalf("read Partner commission receipt migration: %v", err)
	}
	sql := string(data)
	for _, required := range []string{
		"receipt_document_id text",
		"ALTER COLUMN evidence_reference DROP NOT NULL",
		"FOREIGN KEY (receipt_document_id) REFERENCES wlt.finance_evidence_documents(id) ON DELETE RESTRICT",
		"CREATE UNIQUE INDEX partner_commission_remittances_receipt_document_uq",
		"WHERE receipt_document_id IS NOT NULL",
	} {
		if !strings.Contains(sql, required) {
			t.Fatalf("Partner commission receipt migration is missing %q", required)
		}
	}
}

func TestFinanceTransferReceiptClaimsAreGloballyUnique(t *testing.T) {
	directory := filepath.Join("..", "..", "..", "..", "database", "migrations")
	data, err := os.ReadFile(filepath.Join(directory, "037_finance_transfer_receipt_claims.sql"))
	if err != nil {
		t.Fatalf("read finance transfer receipt claims migration: %v", err)
	}
	sql := string(data)
	for _, required := range []string{
		"CREATE TABLE wlt.finance_transfer_receipt_claims",
		"evidence_document_id text PRIMARY KEY",
		"finance_transfer_receipt_claims_transfer_uq UNIQUE (transfer_type,transfer_id)",
		"FROM wlt.cash_remittances",
		"FROM wlt.partner_commission_remittances",
		"FROM wlt.manual_transfer_executions",
		"HAVING COUNT(*) > 1",
		"d.purpose<>'TRANSFER_RECEIPT'",
	} {
		if !strings.Contains(sql, required) {
			t.Fatalf("global transfer receipt claim migration is missing %q", required)
		}
	}
}

func TestOrderAdjustmentReconciliationCasesDoNotMoveMoneyWithoutPolicy(t *testing.T) {
	directory := filepath.Join("..", "..", "..", "..", "database", "migrations")
	data, err := os.ReadFile(filepath.Join(directory, "038_order_adjustment_reconciliation_cases.sql"))
	if err != nil {
		t.Fatalf("read order adjustment reconciliation migration: %v", err)
	}
	sql := string(data)
	for _, required := range []string{
		"CREATE TABLE wlt.order_adjustment_reconciliation_cases",
		"payment_intent_id text NOT NULL REFERENCES wlt.payment_intents(id) ON DELETE RESTRICT",
		"state text NOT NULL DEFAULT 'RECONCILIATION_REQUIRED'",
		"reason_code text NOT NULL DEFAULT 'ORDER_ADJUSTMENT_FINANCIAL_POLICY_REQUIRED'",
		"UNIQUE (order_id, adjustment_id)",
	} {
		if !strings.Contains(sql, required) {
			t.Fatalf("order adjustment reconciliation migration is missing %q", required)
		}
	}
	for _, forbidden := range []string{"amount_minor", "ledger_transaction", "refund_amount"} {
		if strings.Contains(sql, forbidden) {
			t.Fatalf("order adjustment reconciliation migration must not invent financial movement through %q", forbidden)
		}
	}
}
