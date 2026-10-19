package postgres

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/bthwani2-boop/samrim/services/wlt/backend/internal/domain"
	"github.com/bthwani2-boop/samrim/services/wlt/backend/internal/opsafety"
)

func TestCaptainCODRemittanceV34UpgradeAndReconciliationJourney(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("WLT_MIGRATION_TEST_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("WLT_MIGRATION_TEST_DATABASE_URL is not configured")
	}
	if _, err := opsafety.RequireOrdinaryCLIEnvironment(os.Getenv("BTHWANI_ENV"), "WLT remittance migration integration test"); err != nil {
		t.Fatalf("refuse unsafe WLT test environment: %v", err)
	}
	if _, err := opsafety.RequireExpectedDatabaseTarget(databaseURL, os.Getenv); err != nil {
		t.Fatalf("refuse non-dedicated WLT migration database: %v", err)
	}

	db, err := Open(databaseURL)
	if err != nil {
		t.Fatalf("open isolated WLT migration database: %v", err)
	}
	db.SetMaxOpenConns(4)
	t.Cleanup(func() {
		if err := db.Close(); err != nil {
			t.Errorf("close isolated WLT migration database: %v", err)
		}
	})

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	t.Cleanup(cancel)
	if err := db.PingContext(ctx); err != nil {
		t.Fatalf("connect isolated WLT migration database: %v", err)
	}
	var pristine bool
	if err := db.QueryRowContext(ctx, `SELECT to_regclass('wlt.schema_migrations') IS NULL AND to_regclass('wlt.payment_intents') IS NULL`).Scan(&pristine); err != nil {
		t.Fatalf("inspect isolated WLT migration database: %v", err)
	}
	if !pristine {
		t.Fatal("WLT migration database must be empty; refusing to rewrite existing schema history")
	}

	directory := filepath.Clean(filepath.Join("..", "..", "..", "..", "database", "migrations"))
	records, statements, err := LoadMigrations(directory)
	if err != nil {
		t.Fatalf("load canonical WLT migrations: %v", err)
	}
	if err := applyWLTMigrationPrefix(ctx, db, records, statements, 34); err != nil {
		t.Fatalf("prepare canonical WLT v34 database: %v", err)
	}
	fixture := newRemittanceMigrationFixture(t)
	if err := fixture.seedV34(ctx, db); err != nil {
		t.Fatalf("seed v34 remittance history: %v", err)
	}
	if err := Migrate(ctx, db, records, statements); err != nil {
		t.Fatalf("upgrade WLT schema from v34 to v37: %v", err)
	}
	if err := VerifySchema(ctx, db, records); err != nil {
		t.Fatalf("verify canonical WLT v37 schema: %v", err)
	}

	fixture.assertMigrationReadback(t, ctx, db)
	fixture.reconcileReopenedRemittance(t, ctx, db)
	cashReceiptID := fixture.submitAndReconcileCurrentRemittance(t, ctx, db)
	fixture.reconcilePartnerCommissionFromStoredReceipt(t, ctx, db, cashReceiptID)
}

func applyWLTMigrationPrefix(ctx context.Context, db *sql.DB, records []MigrationRecord, statements []string, count int) error {
	if count < 1 || count >= len(records) || count > len(statements) {
		return fmt.Errorf("invalid WLT migration prefix length %d", count)
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin WLT v34 fixture migration: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended('wlt:migrations', 0))"); err != nil {
		return fmt.Errorf("lock WLT v34 fixture migration: %w", err)
	}
	if _, err := tx.ExecContext(ctx, "CREATE SCHEMA IF NOT EXISTS wlt"); err != nil {
		return fmt.Errorf("create WLT v34 fixture schema: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `CREATE TABLE wlt.schema_migrations (version integer PRIMARY KEY, name text NOT NULL, sha256 text NOT NULL, applied_at timestamptz NOT NULL DEFAULT clock_timestamp())`); err != nil {
		return fmt.Errorf("create WLT v34 fixture migration history: %w", err)
	}
	for index := 0; index < count; index++ {
		if _, err := tx.ExecContext(ctx, statements[index]); err != nil {
			return fmt.Errorf("apply WLT fixture migration v%d: %w", records[index].Version, err)
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO wlt.schema_migrations(version,name,sha256) VALUES($1,$2,$3)`, records[index].Version, records[index].Name, records[index].SHA256); err != nil {
			return fmt.Errorf("record WLT fixture migration v%d: %w", records[index].Version, err)
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit WLT v34 fixture migrations: %w", err)
	}
	return nil
}

type remittanceMigrationFixture struct {
	suffix            string
	legacyRemittance  string
	legacyPayment     string
	legacyCaptain     string
	legacyReservation string
	untouchedRemit    string
	untouchedPayment  string
	untouchedCaptain  string
	untouchedReserve  string
}

func newRemittanceMigrationFixture(t *testing.T) remittanceMigrationFixture {
	t.Helper()
	suffix := fmt.Sprintf("%d", time.Now().UTC().UnixNano())
	return remittanceMigrationFixture{
		suffix:            suffix,
		legacyRemittance:  "legacy-remittance-" + suffix,
		legacyPayment:     "legacy-payment-" + suffix,
		legacyCaptain:     "legacy-captain-" + suffix,
		legacyReservation: "legacy-reservation-" + suffix,
		untouchedRemit:    "untouched-remittance-" + suffix,
		untouchedPayment:  "untouched-payment-" + suffix,
		untouchedCaptain:  "untouched-captain-" + suffix,
		untouchedReserve:  "untouched-reservation-" + suffix,
	}
}

func (f remittanceMigrationFixture) seedV34(ctx context.Context, db *sql.DB) error {
	for index, item := range []struct {
		paymentID, captainID, remittanceID, reservationID string
		amount                                            int64
		reservationState                                  string
		remittedAt                                        *time.Time
	}{
		{f.legacyPayment, f.legacyCaptain, f.legacyRemittance, f.legacyReservation, 1200, "REMITTED", remittanceTimePointer(time.Now().UTC())},
		{f.untouchedPayment, f.untouchedCaptain, f.untouchedRemit, f.untouchedReserve, 800, "FINALIZED", nil},
	} {
		requestHash := "v34-request-hash-" + fmt.Sprint(index) + "-" + f.suffix
		correlationID := "v34-correlation-" + fmt.Sprint(index) + "-" + f.suffix
		collectionRef := "collection-" + fmt.Sprint(index) + "-" + f.suffix
		if _, err := db.ExecContext(ctx, `INSERT INTO wlt.payment_intents(
			id,external_reference,payer_actor_id,amount_minor,currency,method,state,version,
			idempotency_key,request_hash,collected_amount_minor,collected_by_actor_id,collection_reference,collected_at
		) VALUES($1,$2,$3,$4,'YER','CASH_ON_DELIVERY','COLLECTED',2,$5,$6,$4,$3,$7,clock_timestamp())`, item.paymentID, "external-"+item.paymentID, "payer-"+item.paymentID, item.amount, "create-"+item.paymentID, requestHash, collectionRef); err != nil {
			return fmt.Errorf("insert historical payment intent %s: %w", item.paymentID, err)
		}
		if _, err := db.ExecContext(ctx, `INSERT INTO wlt.cash_remittances(
			id,payment_intent_id,captain_actor_id,amount_minor,currency,remittance_reference,idempotency_key,request_hash,correlation_id,state
		) VALUES($1,$2,$3,$4,'YER',$5,$6,$7,$8,'REMITTED')`, item.remittanceID, item.paymentID, item.captainID, item.amount, "old-transfer-"+item.remittanceID, "old-remit-key-"+item.remittanceID, requestHash, correlationID); err != nil {
			return fmt.Errorf("insert historical cash remittance %s: %w", item.remittanceID, err)
		}
		if _, err := db.ExecContext(ctx, `INSERT INTO wlt.cash_remittance_events(
			remittance_id,payment_intent_id,event_type,idempotency_key,request_hash,correlation_id,captain_actor_id,amount_minor
		) VALUES($1,$2,'CASH_REMITTED',$3,$4,$5,$6,$7)`, item.remittanceID, item.paymentID, "old-remit-event-"+item.remittanceID, requestHash, correlationID, item.captainID, item.amount); err != nil {
			return fmt.Errorf("insert historical remittance event %s: %w", item.remittanceID, err)
		}
		finalizedAt := time.Now().UTC()
		var remittedAt any
		if item.remittedAt != nil {
			remittedAt = item.remittedAt
		}
		if _, err := db.ExecContext(ctx, `INSERT INTO wlt.captain_cod_reservations(
			id,order_id,payment_intent_id,captain_actor_id,amount_minor,currency,state,reserve_idempotency_key,request_hash,correlation_id,finalized_at,remitted_at
		) VALUES($1,$2,$3,$4,$5,'YER',$6,$7,$8,$9,$10,$11)`, item.reservationID, "order-"+item.reservationID, item.paymentID, item.captainID, item.amount, item.reservationState, "reserve-"+item.reservationID, requestHash, correlationID, finalizedAt, remittedAt); err != nil {
			return fmt.Errorf("insert historical COD reservation %s: %w", item.reservationID, err)
		}
		if item.reservationState == "REMITTED" {
			if _, err := db.ExecContext(ctx, `INSERT INTO wlt.captain_cod_reservation_events(id,reservation_id,event_type,idempotency_key,request_hash,correlation_id) VALUES($1,$2,'CAPTAIN_COD_REMITTED',$3,$4,$5)`, "old-reservation-event-"+item.reservationID, item.reservationID, "old-reservation-key-"+item.reservationID, requestHash, correlationID); err != nil {
				return fmt.Errorf("insert historical COD reservation event %s: %w", item.reservationID, err)
			}
		}
		ledgerID := "old-ledger-" + item.remittanceID
		if _, err := db.ExecContext(ctx, `INSERT INTO wlt.ledger_transactions(id,transaction_type,source_type,source_id,currency,idempotency_key,request_hash,correlation_id) VALUES($1,'CAPTAIN_CASH_REMITTED','CASH_REMITTANCE',$2,'YER',$3,$4,$5)`, ledgerID, item.remittanceID, "old-ledger-key-"+ledgerID, requestHash, correlationID); err != nil {
			return fmt.Errorf("insert historical remittance ledger transaction %s: %w", item.remittanceID, err)
		}
		if _, err := db.ExecContext(ctx, `INSERT INTO wlt.ledger_entries(transaction_id,line_sequence,account_class,account_code,direction,amount_minor,currency) VALUES($1,1,'asset','EXTERNAL_SETTLEMENT_CASH','DEBIT',$2,'YER'),($1,2,'asset','CAPTAIN_CASH_RECEIVABLE','CREDIT',$2,'YER')`, ledgerID, item.amount); err != nil {
			return fmt.Errorf("insert historical remittance ledger entries %s: %w", item.remittanceID, err)
		}
	}
	return nil
}

func (f remittanceMigrationFixture) assertMigrationReadback(t *testing.T, ctx context.Context, db *sql.DB) {
	t.Helper()
	var state string
	var reconciledBy, receiptDocumentID sql.NullString
	var reconciledAt sql.NullTime
	if err := db.QueryRowContext(ctx, `SELECT state,reconciled_by,reconciled_at,receipt_document_id FROM wlt.cash_remittances WHERE id=$1`, f.legacyRemittance).Scan(&state, &reconciledBy, &reconciledAt, &receiptDocumentID); err != nil {
		t.Fatalf("read reopened historical remittance: %v", err)
	}
	if state != "SUBMITTED" || reconciledBy.Valid || reconciledAt.Valid || receiptDocumentID.Valid {
		t.Fatalf("historical remittance migration state = %q, reconciled_by=%v reconciled_at=%v receipt=%v", state, reconciledBy, reconciledAt, receiptDocumentID)
	}
	var originalLines, originalDebit, originalCredit int64
	if err := db.QueryRowContext(ctx, `SELECT COUNT(*),COALESCE(SUM(amount_minor) FILTER(WHERE direction='DEBIT'),0),COALESCE(SUM(amount_minor) FILTER(WHERE direction='CREDIT'),0) FROM wlt.ledger_entries WHERE transaction_id=$1`, "old-ledger-"+f.legacyRemittance).Scan(&originalLines, &originalDebit, &originalCredit); err != nil {
		t.Fatalf("read immutable historical remittance posting: %v", err)
	}
	if originalLines != 2 || originalDebit != 1200 || originalCredit != 1200 {
		t.Fatalf("historical ledger posting changed: lines=%d debit=%d credit=%d", originalLines, originalDebit, originalCredit)
	}
	assertRemittanceLedgerPosting(t, ctx, db, "CASH_REMITTANCE_REOPENING", f.legacyRemittance, 1200, "CAPTAIN_CASH_RECEIVABLE", "DEBIT", "EXTERNAL_SETTLEMENT_CASH", "CREDIT")
	var reservationState string
	var remittedAt sql.NullTime
	if err := db.QueryRowContext(ctx, `SELECT state,remitted_at FROM wlt.captain_cod_reservations WHERE id=$1`, f.legacyReservation).Scan(&reservationState, &remittedAt); err != nil {
		t.Fatalf("read reopened COD reservation: %v", err)
	}
	if reservationState != "FINALIZED" || remittedAt.Valid {
		t.Fatalf("historical COD reservation state = %q remitted_at=%v", reservationState, remittedAt)
	}
	var reopenedCount, untouchedCount int
	if err := db.QueryRowContext(ctx, `SELECT COUNT(*) FROM wlt.captain_cod_reservation_events WHERE reservation_id=$1 AND event_type='CAPTAIN_COD_REMITTANCE_REOPENED'`, f.legacyReservation).Scan(&reopenedCount); err != nil {
		t.Fatalf("read reopened COD reservation audit: %v", err)
	}
	if err := db.QueryRowContext(ctx, `SELECT COUNT(*) FROM wlt.captain_cod_reservation_events WHERE reservation_id=$1 AND event_type='CAPTAIN_COD_REMITTANCE_REOPENED'`, f.untouchedReserve).Scan(&untouchedCount); err != nil {
		t.Fatalf("read unchanged COD reservation audit: %v", err)
	}
	if reopenedCount != 1 || untouchedCount != 0 {
		t.Fatalf("COD reopen events = reopened:%d untouched:%d", reopenedCount, untouchedCount)
	}
	var oldReference, reopenedEventReference string
	if err := db.QueryRowContext(ctx, `SELECT e.remittance_reference FROM wlt.cash_remittance_events e WHERE e.remittance_id=$1 AND e.event_type='CASH_REMITTED'`, f.legacyRemittance).Scan(&oldReference); err != nil {
		t.Fatalf("read historical remittance reference backfill: %v", err)
	}
	if err := db.QueryRowContext(ctx, `SELECT remittance_reference FROM wlt.cash_remittance_events WHERE remittance_id=$1 AND event_type='CASH_REMITTANCE_REOPENED'`, f.legacyRemittance).Scan(&reopenedEventReference); err != nil {
		t.Fatalf("read historical remittance reopen event: %v", err)
	}
	if oldReference != "old-transfer-"+f.legacyRemittance || reopenedEventReference != oldReference {
		t.Fatalf("historical remittance reference readback = old:%q reopened:%q", oldReference, reopenedEventReference)
	}
	registry, err := ListCashLiabilityRegistry(ctx, db, "external-", "collected_asc", nil, "", 10)
	if err != nil {
		t.Fatalf("read reopened remittances in Finance registry: %v", err)
	}
	if registry.TotalItems != 2 || registry.TotalAmountMinor != 2000 || len(registry.Items) != 2 {
		t.Fatalf("Finance registry after v35 reopening = %+v", registry)
	}
}

func (f remittanceMigrationFixture) reconcileReopenedRemittance(t *testing.T, ctx context.Context, db *sql.DB) {
	t.Helper()
	cipher, err := NewDestinationCipher("MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=")
	if err != nil {
		t.Fatalf("create test finance evidence cipher: %v", err)
	}
	wrongPurpose, err := SaveFinanceEvidenceDocument(ctx, db, cipher, FinanceEvidenceDocumentInput{
		Purpose: "SETTLEMENT_STATEMENT", Filename: "statement.pdf", ContentType: "application/pdf", Content: []byte("test settlement statement"),
		ActorID: "finance-" + f.suffix, IdempotencyKey: "wrong-purpose-" + f.suffix, CorrelationID: "wrong-purpose-correlation-" + f.suffix,
	})
	if err != nil {
		t.Fatalf("save wrong-purpose finance evidence: %v", err)
	}
	if _, _, err := ReconcileCashRemittance(ctx, db, ReconcileCashRemittanceInput{
		RemittanceID: f.legacyRemittance, EvidenceDocumentID: wrongPurpose.ID, ActorID: "finance-" + f.suffix,
		IdempotencyKey: "reject-wrong-purpose-" + f.suffix, CorrelationID: "reject-purpose-correlation-" + f.suffix,
	}); !errors.Is(err, ErrRemittanceEvidence) {
		t.Fatalf("wrong-purpose reconciliation error = %v", err)
	}
	captainEvidence, err := SaveFinanceEvidenceDocument(ctx, db, cipher, FinanceEvidenceDocumentInput{
		Purpose: "TRANSFER_RECEIPT", Filename: "captain-receipt.pdf", ContentType: "application/pdf", Content: []byte("captain provided receipt"),
		ActorID: f.legacyCaptain, IdempotencyKey: "captain-evidence-" + f.suffix, CorrelationID: "captain-evidence-correlation-" + f.suffix,
	})
	if err != nil {
		t.Fatalf("save Captain-uploaded evidence: %v", err)
	}
	if _, _, err := ReconcileCashRemittance(ctx, db, ReconcileCashRemittanceInput{
		RemittanceID: f.legacyRemittance, EvidenceDocumentID: captainEvidence.ID, ActorID: "finance-" + f.suffix,
		IdempotencyKey: "reject-captain-evidence-" + f.suffix, CorrelationID: "reject-captain-evidence-correlation-" + f.suffix,
	}); !errors.Is(err, ErrRemittanceEvidence) {
		t.Fatalf("Captain-uploaded evidence reconciliation error = %v", err)
	}
	financeActor := "finance-" + f.suffix
	receipt, err := SaveFinanceEvidenceDocument(ctx, db, cipher, FinanceEvidenceDocumentInput{
		Purpose: "TRANSFER_RECEIPT", Filename: "bank-transfer.pdf", ContentType: "application/pdf", Content: []byte("verified transfer receipt"),
		ActorID: financeActor, IdempotencyKey: "finance-receipt-" + f.suffix, CorrelationID: "finance-receipt-correlation-" + f.suffix,
	})
	if err != nil {
		t.Fatalf("save independent Finance receipt: %v", err)
	}
	reconcile := ReconcileCashRemittanceInput{
		RemittanceID: f.legacyRemittance, EvidenceDocumentID: receipt.ID, ActorID: financeActor,
		IdempotencyKey: "reconcile-legacy-" + f.suffix, CorrelationID: "reconcile-legacy-correlation-" + f.suffix,
	}
	if _, _, err := ReconcileCashRemittance(ctx, db, ReconcileCashRemittanceInput{
		RemittanceID: reconcile.RemittanceID, EvidenceDocumentID: receipt.ID, ActorID: f.legacyCaptain,
		IdempotencyKey: "reject-captain-reconcile-" + f.suffix, CorrelationID: "reject-reconcile-correlation-" + f.suffix,
	}); !errors.Is(err, ErrRemittanceSeparation) {
		t.Fatalf("Captain reconciliation error = %v", err)
	}
	item, replayed, err := ReconcileCashRemittance(ctx, db, reconcile)
	if err != nil || replayed || item.State != "REMITTED" || item.ReconciledBy == nil || *item.ReconciledBy != financeActor || item.ReconciledAt == nil || item.ReceiptDocumentID == nil || *item.ReceiptDocumentID != receipt.ID {
		t.Fatalf("reconcile reopened remittance = %+v replayed=%v error=%v", item, replayed, err)
	}
	if replay, replayed, err := ReconcileCashRemittance(ctx, db, reconcile); err != nil || !replayed || replay.State != "REMITTED" {
		t.Fatalf("replay reconciled remittance = %+v replayed=%v error=%v", replay, replayed, err)
	}
	conflictingReplay := reconcile
	conflictingReplay.EvidenceDocumentID = captainEvidence.ID
	if _, _, err := ReconcileCashRemittance(ctx, db, conflictingReplay); !errors.Is(err, ErrRemittanceIdempotency) {
		t.Fatalf("changed reconciliation replay error = %v", err)
	}
	assertRemittanceLedgerPosting(t, ctx, db, "CASH_REMITTANCE_RECONCILIATION", f.legacyRemittance, 1200, "EXTERNAL_SETTLEMENT_CASH", "DEBIT", "CAPTAIN_CASH_RECEIVABLE", "CREDIT")
	var auditActor, auditEvidence string
	if err := db.QueryRowContext(ctx, `SELECT finance_actor_id,evidence_document_id FROM wlt.cash_remittance_events WHERE remittance_id=$1 AND event_type='CASH_REMITTANCE_RECONCILED'`, f.legacyRemittance).Scan(&auditActor, &auditEvidence); err != nil {
		t.Fatalf("read remittance reconciliation audit: %v", err)
	}
	if auditActor != financeActor || auditEvidence != receipt.ID {
		t.Fatalf("reconciliation audit actor/evidence = %q/%q", auditActor, auditEvidence)
	}
	var reservationState string
	var remittedAt sql.NullTime
	if err := db.QueryRowContext(ctx, `SELECT state,remitted_at FROM wlt.captain_cod_reservations WHERE id=$1`, f.legacyReservation).Scan(&reservationState, &remittedAt); err != nil {
		t.Fatalf("read reconciled COD reservation: %v", err)
	}
	if reservationState != "REMITTED" || !remittedAt.Valid {
		t.Fatalf("reconciled COD reservation = %q remitted_at=%v", reservationState, remittedAt)
	}
	registry, err := ListCashLiabilityRegistry(ctx, db, "external-", "collected_asc", nil, "", 10)
	if err != nil {
		t.Fatalf("read Finance registry after reconciliation: %v", err)
	}
	if registry.TotalItems != 1 || registry.TotalAmountMinor != 800 || len(registry.Items) != 1 || registry.Items[0].RemittanceID != f.untouchedRemit {
		t.Fatalf("Finance registry after reconciliation = %+v", registry)
	}
}

func (f remittanceMigrationFixture) submitAndReconcileCurrentRemittance(t *testing.T, ctx context.Context, db *sql.DB) string {
	t.Helper()
	captainID := "current-captain-" + f.suffix
	created, replayed, err := CreatePaymentIntent(ctx, db, CreatePaymentIntentInput{
		ExternalReference: "current-external-" + f.suffix, PayerActorID: "current-payer-" + f.suffix,
		AmountMinor: 560, Currency: "YER", Method: domain.MethodCashOnDelivery,
		IdempotencyKey: "current-payment-" + f.suffix, CorrelationID: "current-payment-correlation-" + f.suffix,
	})
	if err != nil || replayed || created.State != "REQUIRES_COLLECTION" {
		t.Fatalf("create COD payment = %+v replayed=%v error=%v", created, replayed, err)
	}
	collected, replayed, err := CollectPaymentIntent(ctx, db, CollectPaymentIntentInput{
		IntentID: created.ID, CollectedAmountMinor: created.AmountMinor, CollectedByActorID: captainID,
		CollectionReference: "current-collection-" + f.suffix, ExpectedVersion: created.Version,
		IdempotencyKey: "current-collect-" + f.suffix, CorrelationID: "current-collect-correlation-" + f.suffix,
	})
	if err != nil || replayed || collected.State != "COLLECTED" {
		t.Fatalf("collect COD payment = %+v replayed=%v error=%v", collected, replayed, err)
	}
	remitInput := RemitCashInput{
		PaymentIntentID: created.ID, CaptainActorID: captainID, AmountMinor: collected.AmountMinor,
		RemittanceReference: "current-transfer-" + f.suffix, ExpectedPaymentVersion: collected.Version,
		IdempotencyKey: "current-remit-" + f.suffix, CorrelationID: "current-remit-correlation-" + f.suffix,
	}
	submitted, replayed, err := RemitCash(ctx, db, remitInput)
	if err != nil || replayed || submitted.State != "SUBMITTED" || submitted.ReconciledBy != nil || submitted.ReceiptDocumentID != nil {
		t.Fatalf("submit current COD remittance = %+v replayed=%v error=%v", submitted, replayed, err)
	}
	if repeated, replayed, err := RemitCash(ctx, db, remitInput); err != nil || !replayed || repeated.ID != submitted.ID {
		t.Fatalf("replay current COD submission = %+v replayed=%v error=%v", repeated, replayed, err)
	}
	registry, err := ListCashLiabilityRegistry(ctx, db, "current-external-"+f.suffix, "collected_asc", nil, "", 10)
	if err != nil || registry.TotalItems != 1 || len(registry.Items) != 1 || registry.Items[0].RemittanceState != "SUBMITTED" || registry.Items[0].RemittanceID != submitted.ID {
		t.Fatalf("Finance registry before current reconciliation = %+v error=%v", registry, err)
	}
	cipher, err := NewDestinationCipher("MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=")
	if err != nil {
		t.Fatalf("create current Finance evidence cipher: %v", err)
	}
	financeActor := "operator-receipt-" + f.suffix
	receipt, err := SaveFinanceEvidenceDocument(ctx, db, cipher, FinanceEvidenceDocumentInput{
		Purpose: "TRANSFER_RECEIPT", Filename: "current-transfer.pdf", ContentType: "application/pdf", Content: []byte("current transfer evidence"),
		ActorID: financeActor, IdempotencyKey: "current-evidence-" + f.suffix, CorrelationID: "current-evidence-correlation-" + f.suffix,
	})
	if err != nil {
		t.Fatalf("save current Finance evidence: %v", err)
	}
	input := ReconcileCashRemittanceInput{
		RemittanceID: submitted.ID, EvidenceDocumentID: receipt.ID, ActorID: financeActor,
		IdempotencyKey: "current-reconcile-" + f.suffix, CorrelationID: "current-reconcile-correlation-" + f.suffix,
	}
	completed, replayed, err := ReconcileCashRemittance(ctx, db, input)
	if err != nil || replayed || completed.State != "REMITTED" || completed.ReceiptDocumentID == nil || *completed.ReceiptDocumentID != receipt.ID {
		t.Fatalf("reconcile current COD remittance = %+v replayed=%v error=%v", completed, replayed, err)
	}
	if _, replayed, err := ReconcileCashRemittance(ctx, db, input); err != nil || !replayed {
		t.Fatalf("replay current COD reconciliation: replayed=%v error=%v", replayed, err)
	}
	assertRemittanceLedgerPosting(t, ctx, db, "CASH_REMITTANCE_RECONCILIATION", submitted.ID, 560, "EXTERNAL_SETTLEMENT_CASH", "DEBIT", "CAPTAIN_CASH_RECEIVABLE", "CREDIT")
	registry, err = ListCashLiabilityRegistry(ctx, db, "current-external-"+f.suffix, "collected_asc", nil, "", 10)
	if err != nil || registry.TotalItems != 0 || registry.TotalAmountMinor != 0 || len(registry.Items) != 0 {
		t.Fatalf("Finance registry after current reconciliation = %+v error=%v", registry, err)
	}
	return receipt.ID
}

func (f remittanceMigrationFixture) reconcilePartnerCommissionFromStoredReceipt(t *testing.T, ctx context.Context, db *sql.DB, cashReceiptID string) {
	t.Helper()
	partnerID := "partner-receipt-" + f.suffix
	operatorID := "operator-receipt-" + f.suffix
	ledgerID := "ledger-seed-partner-commission-" + f.suffix
	var evidenceValid, evidenceWrongPurpose, evidenceWrongUploader string
	seedRequestHash := "commission-seed-" + f.suffix
	seedCorrelation := "commission-seed-correlation-" + f.suffix
	if _, err := db.ExecContext(ctx, `INSERT INTO wlt.ledger_transactions(id,transaction_type,source_type,source_id,currency,idempotency_key,request_hash,correlation_id) VALUES($1,'PARTNER_STORE_CASH_COMMISSION_ASSESSED','PARTNER_STORE_CASH_COMMISSION',$2,'YER',$3,$4,$5)`, ledgerID, "order-"+f.suffix, "seed-commission-ledger-"+f.suffix, seedRequestHash, seedCorrelation); err != nil {
		t.Fatalf("seed partner commission ledger transaction: %v", err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO wlt.ledger_entries(transaction_id,line_sequence,account_class,account_code,actor_type,actor_id,direction,amount_minor,currency) VALUES($1,1,'asset','PARTNER_COMMISSION_RECEIVABLE','partner',$2,'DEBIT',10000,'YER'),($1,2,'income','PLATFORM_COMMISSION_INCOME',NULL,NULL,'CREDIT',10000,'YER')`, ledgerID, partnerID); err != nil {
		t.Fatalf("seed partner commission receivable: %v", err)
	}
	receiptCipher, err := NewDestinationCipher("MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=")
	if err != nil {
		t.Fatalf("create Partner Finance evidence cipher: %v", err)
	}
	for index, document := range []struct{ id, purpose, actor string }{
		{"valid", "TRANSFER_RECEIPT", operatorID},
		{"wrong-purpose", "SETTLEMENT_STATEMENT", operatorID},
		{"wrong-uploader", "TRANSFER_RECEIPT", "another-operator-" + f.suffix},
	} {
		saved, err := SaveFinanceEvidenceDocument(ctx, db, receiptCipher, FinanceEvidenceDocumentInput{
			Purpose: document.purpose, Filename: fmt.Sprintf("receipt-%d.pdf", index+1), ContentType: "application/pdf", Content: []byte("verified partner transfer evidence " + document.id + f.suffix),
			ActorID: document.actor, IdempotencyKey: "evidence-key-" + document.id + "-" + f.suffix, CorrelationID: "evidence-correlation-" + document.id + "-" + f.suffix,
		})
		if err != nil {
			t.Fatalf("save Finance receipt %s through WLT evidence owner: %v", document.id, err)
		}
		switch index {
		case 0:
			evidenceValid = saved.ID
		case 1:
			evidenceWrongPurpose = saved.ID
		case 2:
			evidenceWrongUploader = saved.ID
		}
	}
	baseTransactions := countLedgerTransactions(t, ctx, db)
	baseBalance, err := ReadPartnerCommissionReceivableBalance(ctx, db, partnerID)
	if err != nil || baseBalance != 10000 {
		t.Fatalf("seed partner commission balance = (%d, %v), want 10000", baseBalance, err)
	}
	baseInput := PartnerCommissionRemittanceInput{PartnerActorID: partnerID, AmountMinor: 4200, RemittanceReference: "bank-transfer-" + f.suffix, VerifiedBy: operatorID, IdempotencyKey: "commission-remit-key-" + f.suffix, CorrelationID: "commission-remit-correlation-" + f.suffix}
	for _, attempt := range []struct {
		name       string
		evidenceID string
		verifiedBy string
		wantErr    error
	}{
		{name: "missing receipt", evidenceID: "missing-receipt-" + f.suffix, verifiedBy: operatorID, wantErr: ErrPartnerRemittanceEvidence},
		{name: "wrong purpose", evidenceID: evidenceWrongPurpose, verifiedBy: operatorID, wantErr: ErrPartnerRemittanceEvidence},
		{name: "different uploader", evidenceID: evidenceWrongUploader, verifiedBy: operatorID, wantErr: ErrPartnerRemittanceEvidence},
		{name: "receipt already claimed by Captain remittance", evidenceID: cashReceiptID, verifiedBy: operatorID, wantErr: ErrPartnerRemittanceEvidenceUsed},
	} {
		input := baseInput
		input.EvidenceDocumentID = attempt.evidenceID
		input.VerifiedBy = attempt.verifiedBy
		if _, _, err := RecordPartnerCommissionRemittance(ctx, db, input); !errors.Is(err, attempt.wantErr) {
			t.Errorf("%s receipt attempt error = %v, want %v", attempt.name, err, attempt.wantErr)
		}
		if got := countLedgerTransactions(t, ctx, db); got != baseTransactions {
			t.Errorf("%s receipt attempt changed ledger transaction count to %d, want %d", attempt.name, got, baseTransactions)
		}
	}

	validInput := baseInput
	validInput.EvidenceDocumentID = evidenceValid
	remittance, replay, err := RecordPartnerCommissionRemittance(ctx, db, validInput)
	if err != nil || replay || remittance.ID == "" || remittance.EvidenceDocumentID != evidenceValid || remittance.EvidenceReference != "" || remittance.VerifiedBy != operatorID {
		t.Fatalf("record receipt-backed Partner remittance = (%+v, replay=%t, %v)", remittance, replay, err)
	}
	readback, err := ReadPartnerCommissionRemittance(ctx, db, remittance.ID)
	if err != nil || readback.EvidenceDocumentID != evidenceValid || readback.VerifiedBy != operatorID || readback.LedgerTransactionID != remittance.LedgerTransactionID {
		t.Fatalf("WLT Partner remittance readback = (%+v, %v)", readback, err)
	}
	remaining, err := ReadPartnerCommissionReceivableBalance(ctx, db, partnerID)
	if err != nil || remaining != 5800 {
		t.Fatalf("remaining Partner receivable = (%d, %v), want 5800", remaining, err)
	}
	if got := countLedgerTransactions(t, ctx, db); got != baseTransactions+1 {
		t.Fatalf("valid Partner remittance ledger count = %d, want %d", got, baseTransactions+1)
	}
	assertRemittanceLedgerPosting(t, ctx, db, "PARTNER_COMMISSION_REMITTANCE", remittance.ID, 4200, "EXTERNAL_SETTLEMENT_CASH", "DEBIT", "PARTNER_COMMISSION_RECEIVABLE", "CREDIT")
	replayed, wasReplay, err := RecordPartnerCommissionRemittance(ctx, db, validInput)
	if err != nil || !wasReplay || replayed.ID != remittance.ID {
		t.Fatalf("idempotent Partner remittance replay = (%+v, replay=%t, %v)", replayed, wasReplay, err)
	}
	usedEvidenceAttempt := validInput
	usedEvidenceAttempt.AmountMinor = 1000
	usedEvidenceAttempt.IdempotencyKey = "commission-remit-second-" + f.suffix
	usedEvidenceAttempt.CorrelationID = "commission-remit-second-correlation-" + f.suffix
	if _, _, err := RecordPartnerCommissionRemittance(ctx, db, usedEvidenceAttempt); !errors.Is(err, ErrPartnerRemittanceEvidenceUsed) {
		t.Errorf("reused Partner receipt error = %v, want ErrPartnerRemittanceEvidenceUsed", err)
	}
	if got := countLedgerTransactions(t, ctx, db); got != baseTransactions+1 {
		t.Errorf("reused receipt changed ledger transaction count to %d, want %d", got, baseTransactions+1)
	}
}

func countLedgerTransactions(t *testing.T, ctx context.Context, db *sql.DB) int {
	t.Helper()
	var count int
	if err := db.QueryRowContext(ctx, `SELECT COUNT(*) FROM wlt.ledger_transactions`).Scan(&count); err != nil {
		t.Fatalf("count WLT ledger transactions: %v", err)
	}
	return count
}

func assertRemittanceLedgerPosting(t *testing.T, ctx context.Context, db *sql.DB, sourceType, sourceID string, amount int64, firstCode, firstDirection, secondCode, secondDirection string) {
	t.Helper()
	var entries int
	var firstCount, secondCount int
	if err := db.QueryRowContext(ctx, `
		SELECT COUNT(*),
		       COUNT(*) FILTER(WHERE account_code=$3 AND direction=$4 AND amount_minor=$5),
		       COUNT(*) FILTER(WHERE account_code=$6 AND direction=$7 AND amount_minor=$5)
		FROM wlt.ledger_entries e JOIN wlt.ledger_transactions tx ON tx.id=e.transaction_id
		WHERE tx.source_type=$1 AND tx.source_id=$2`, sourceType, sourceID, firstCode, firstDirection, amount, secondCode, secondDirection).Scan(&entries, &firstCount, &secondCount); err != nil {
		t.Fatalf("read %s ledger posting for %s: %v", sourceType, sourceID, err)
	}
	if entries != 2 || firstCount != 1 || secondCount != 1 {
		t.Fatalf("%s ledger posting for %s = entries:%d first:%d second:%d", sourceType, sourceID, entries, firstCount, secondCount)
	}
}

func remittanceTimePointer(value time.Time) *time.Time {
	return &value
}
