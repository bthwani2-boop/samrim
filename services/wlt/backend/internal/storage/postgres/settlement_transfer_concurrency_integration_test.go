package postgres

import (
	"database/sql"
	"errors"
	"fmt"
	"testing"
	"time"
)

func TestManualTransferVerificationSerializesReplayAndBatchProgress(t *testing.T) {
	t.Run("same key replays once", func(t *testing.T) {
		s, batch, record, _ := newManualTransferBatchFixture(t)
		first := record(0)
		record(1)
		input := VerifyTransferInput{TransferID: first.ID, ActorID: "independent-verifier", IdempotencyKey: "verify-replay-" + s.suffix, CorrelationID: "verify-replay-correlation-" + s.suffix}
		results := runBlockedTransferVerifications(t, s, `SELECT id FROM wlt.manual_transfer_executions WHERE id=$1 FOR NO KEY UPDATE`, first.ID, input, input)
		for _, result := range results {
			if result.err != nil || result.transfer.ID != first.ID || result.transfer.ExecutionStatus != "VERIFIED" {
				t.Errorf("identical verification retry did not return the committed result: %+v %v", result.transfer, result.err)
			}
		}
		var count int
		if err := s.db.QueryRowContext(s.ctx, `SELECT count(*) FROM wlt.payout_audit_events WHERE batch_id=$1 AND event_type='TRANSFER_VERIFIED'`, batch.ID).Scan(&count); err != nil || count != 1 {
			t.Fatalf("expected one verification audit, got %d: %v", count, err)
		}
		input.ActorID = "different-verifier"
		if _, err := VerifyManualTransfer(s.ctx, s.db, input); !errors.Is(err, ErrIdempotencyConflict) {
			t.Fatalf("same key accepted changed verification identity: %v", err)
		}
	})

	t.Run("different rows advance batch once both are verified", func(t *testing.T) {
		s, batch, record, _ := newManualTransferBatchFixture(t)
		first, second := record(0), record(1)
		results := runBlockedTransferVerifications(t, s, `SELECT id FROM wlt.settlement_batches WHERE id=$1 FOR NO KEY UPDATE`, batch.ID,
			VerifyTransferInput{TransferID: first.ID, ActorID: "independent-verifier", IdempotencyKey: "verify-first-" + s.suffix, CorrelationID: "verify-first-correlation-" + s.suffix},
			VerifyTransferInput{TransferID: second.ID, ActorID: "independent-verifier", IdempotencyKey: "verify-second-" + s.suffix, CorrelationID: "verify-second-correlation-" + s.suffix})
		for _, result := range results {
			if result.err != nil || result.transfer.ExecutionStatus != "VERIFIED" {
				t.Fatalf("concurrent verification failed: %+v %v", result.transfer, result.err)
			}
		}
		assertTransferBatchStatus(t, s, batch.ID, "AWAITING_RECONCILIATION")
	})

	t.Run("partially executed batch remains open for transfer recording", func(t *testing.T) {
		s, batch, record, reconcile := newManualTransferBatchFixture(t)
		first := record(0)
		verified, err := VerifyManualTransfer(s.ctx, s.db, VerifyTransferInput{TransferID: first.ID, ActorID: "independent-verifier", IdempotencyKey: "verify-early-" + s.suffix, CorrelationID: "verify-early-correlation-" + s.suffix})
		if err != nil || verified.ExecutionStatus != "VERIFIED" {
			t.Fatalf("early verification failed: %+v %v", verified, err)
		}
		assertTransferBatchStatus(t, s, batch.ID, "EXECUTION_IN_PROGRESS")
		reconcile(verified, 1)
		assertTransferBatchStatus(t, s, batch.ID, "EXECUTION_IN_PROGRESS")

		second := record(1)
		assertTransferBatchStatus(t, s, batch.ID, "AWAITING_VERIFICATION")
		verified, err = VerifyManualTransfer(s.ctx, s.db, VerifyTransferInput{TransferID: second.ID, ActorID: "independent-verifier", IdempotencyKey: "verify-later-" + s.suffix, CorrelationID: "verify-later-correlation-" + s.suffix})
		if err != nil || verified.ExecutionStatus != "VERIFIED" {
			t.Fatalf("remaining transfer verification failed: %+v %v", verified, err)
		}
		assertTransferBatchStatus(t, s, batch.ID, "AWAITING_RECONCILIATION")
		reconcile(verified, 2)
		assertTransferBatchStatus(t, s, batch.ID, "COMPLETED")
	})
}

type transferVerificationResult struct {
	transfer ManualTransferExecutionRecord
	err      error
}

func runBlockedTransferVerifications(t *testing.T, s *fieldAcquisitionScenario, query, id string, inputs ...VerifyTransferInput) []transferVerificationResult {
	t.Helper()
	blocker, err := s.db.BeginTx(s.ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = blocker.Rollback() }()
	var lockedID string
	if err := blocker.QueryRowContext(s.ctx, query, id).Scan(&lockedID); err != nil {
		t.Fatal(err)
	}
	results := make(chan transferVerificationResult, len(inputs))
	for _, input := range inputs {
		go func() {
			transfer, err := VerifyManualTransfer(s.ctx, s.db, input)
			results <- transferVerificationResult{transfer: transfer, err: err}
		}()
	}
	// Both requests must reach lock contention before the fixture releases
	// their shared transfer or batch. The test database has no other traffic.
	deadline := time.Now().Add(5 * time.Second)
	for {
		var waiting int
		if err := s.db.QueryRowContext(s.ctx, `SELECT count(*) FROM pg_stat_activity
			WHERE datname=current_database() AND wait_event_type='Lock'
			AND (query LIKE '%wlt.manual_transfer_executions%' OR query LIKE '%wlt.settlement_batches%'
			     OR query LIKE 'SELECT pg_advisory_xact_lock%')`).Scan(&waiting); err != nil {
			t.Fatal(err)
		}
		if waiting == len(inputs) {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("only %d/%d verification requests reached contention", waiting, len(inputs))
		}
		time.Sleep(10 * time.Millisecond)
	}
	if err := blocker.Commit(); err != nil {
		t.Fatal(err)
	}
	outcomes := make([]transferVerificationResult, 0, len(inputs))
	for range inputs {
		select {
		case result := <-results:
			outcomes = append(outcomes, result)
		case <-s.ctx.Done():
			t.Fatal(s.ctx.Err())
		}
	}
	return outcomes
}

func assertTransferBatchStatus(t *testing.T, s *fieldAcquisitionScenario, batchID, want string) {
	t.Helper()
	batch, err := ReadSettlementBatch(s.ctx, s.db, batchID)
	if err != nil || batch.Status != want {
		t.Errorf("batch status = %q, want %q: %v", batch.Status, want, err)
	}
}

func newManualTransferBatchFixture(t *testing.T) (*fieldAcquisitionScenario, SettlementBatchRecord, func(int) ManualTransferExecutionRecord, func(ManualTransferExecutionRecord, int)) {
	t.Helper()
	s := newFieldAcquisitionScenarioWithTimeout(t, 2*time.Minute)
	owner, staff, firstStore, secondStore, _, ownerFacts, staffFacts, cipher, _ := setupPartnerFinanceProof(t, s, true)
	factsByActor := map[string]IdentityFacts{owner: ownerFacts, staff: staffFacts}
	payout, _, err := CreatePartitionedPartnerPayoutRequest(s.ctx, s.db, cipher, PartnerPayoutRequestInput{
		PartnerActorID: owner, ScopeMode: PartnerPayoutScopeSpecified, RequestedStoreIDs: []string{firstStore, secondStore},
		StoreAmounts:     []PartnerPayoutStoreAmount{{StoreID: firstStore, AmountMinor: 1000}, {StoreID: secondStore, AmountMinor: 2000}},
		BeneficiaryFacts: factsByActor, IdempotencyKey: "payout-" + s.suffix, CorrelationID: "payout-correlation-" + s.suffix,
	})
	if err != nil || len(payout.Payouts) != 2 {
		t.Fatalf("create two canonical payout groups: %+v %v", payout, err)
	}
	var ids []string
	for _, item := range payout.Payouts {
		destination, err := ReadOfficialWalletDestinationByID(s.ctx, s.db, item.DestinationID)
		if err != nil {
			t.Fatal(err)
		}
		facts := factsByActor[destination.ActorID]
		if _, err := PreparePayout(s.ctx, s.db, cipher, PreparePayoutInput{PayoutID: item.ID, ActorID: "finance-preparer", Reason: "isolated batch proof", Evidence: "verified transfer fixture", IdentityFacts: facts, IdempotencyKey: item.ID + "-prepare", CorrelationID: item.ID + "-prepare-correlation"}); err != nil {
			t.Fatal(err)
		}
		if _, err := ApprovePayout(s.ctx, s.db, cipher, ApprovePayoutInput{PayoutID: item.ID, ActorID: "finance-approver", Reason: "isolated batch approval", IdentityFacts: facts, IdempotencyKey: item.ID + "-approve", CorrelationID: item.ID + "-approve-correlation"}); err != nil {
			t.Fatal(err)
		}
		ids = append(ids, item.ID)
	}
	facts := []IdentityFacts{ownerFacts, staffFacts}
	batch, err := CreateSettlementBatch(s.ctx, s.db, CreateSettlementBatchInput{PayoutIDs: ids, ActorID: "batch-preparer", IdentityFactsByBeneficiary: facts, DestinationCipher: cipher, IdempotencyKey: "batch-" + s.suffix, CorrelationID: "batch-correlation-" + s.suffix})
	if err != nil {
		t.Fatal(err)
	}
	batch, err = ApproveSettlementBatch(s.ctx, s.db, BatchActionInput{BatchID: batch.ID, ActorID: "batch-approver", Reason: "independent batch approval", IdentityFactsByBeneficiary: facts, DestinationCipher: cipher, IdempotencyKey: "batch-approve-" + s.suffix, CorrelationID: "batch-approve-correlation-" + s.suffix})
	if err != nil {
		t.Fatal(err)
	}
	batch, err = FreezeSettlementBatch(s.ctx, s.db, BatchActionInput{BatchID: batch.ID, ActorID: "batch-freezer", Reason: "freeze verified destinations", IdentityFactsByBeneficiary: facts, DestinationCipher: cipher, IdempotencyKey: "batch-freeze-" + s.suffix, CorrelationID: "batch-freeze-correlation-" + s.suffix})
	if err != nil || batch.Status != "FROZEN" {
		t.Fatalf("freeze batch: %+v %v", batch, err)
	}
	record := func(index int) ManualTransferExecutionRecord {
		t.Helper()
		key := fmt.Sprintf("%d-%s", index, s.suffix)
		receipt, err := SaveFinanceEvidenceDocument(s.ctx, s.db, cipher, FinanceEvidenceDocumentInput{Purpose: "TRANSFER_RECEIPT", Filename: "transfer.pdf", ContentType: "application/pdf", Content: []byte("%PDF-1.4\nisolated transfer " + key), ActorID: "finance-executor", IdempotencyKey: "receipt-" + key, CorrelationID: "receipt-correlation-" + key})
		if err != nil {
			t.Fatal(err)
		}
		transfer, err := RecordManualTransfer(s.ctx, s.db, RecordTransferInput{BatchID: batch.ID, PayoutID: ids[index], ActorID: "finance-executor", ExternalReference: "external-" + key, ReceiptDocumentID: receipt.ID, IdempotencyKey: "transfer-" + key, CorrelationID: "transfer-correlation-" + key})
		if err != nil {
			t.Fatal(err)
		}
		return transfer
	}
	var statementID string
	reconcile := func(transfer ManualTransferExecutionRecord, sequence int) {
		t.Helper()
		now := time.Now().UTC()
		if statementID == "" {
			evidence, err := SaveFinanceEvidenceDocument(s.ctx, s.db, cipher, FinanceEvidenceDocumentInput{Purpose: "SETTLEMENT_STATEMENT", Filename: "statement.pdf", ContentType: "application/pdf", Content: []byte("%PDF-1.4\nisolated statement " + s.suffix), ActorID: "statement-uploader", IdempotencyKey: "statement-evidence-" + s.suffix, CorrelationID: "statement-evidence-correlation-" + s.suffix})
			if err != nil {
				t.Fatal(err)
			}
			statement, err := RegisterSettlementStatement(s.ctx, s.db, SettlementStatementInput{BatchID: batch.ID, ProviderKey: transfer.ProviderKey, Currency: transfer.Currency, PeriodStart: now.Add(-time.Hour), PeriodEnd: now.Add(time.Hour), EvidenceDocumentID: evidence.ID, ActorID: "statement-uploader", IdempotencyKey: "statement-" + s.suffix, CorrelationID: "statement-correlation-" + s.suffix})
			if err != nil {
				t.Fatal(err)
			}
			statementID = statement.ID
		}
		destination, err := ReadOfficialWalletDestinationByID(s.ctx, s.db, transfer.DestinationID)
		if err != nil {
			t.Fatal(err)
		}
		key := fmt.Sprintf("%d-%s", sequence, s.suffix)
		row, err := RecordSettlementStatementRow(s.ctx, s.db, cipher, SettlementStatementRowInput{StatementID: statementID, RowSequence: sequence, ExternalReference: transfer.ExternalReference, WalletIdentifier: factsByActor[destination.ActorID].PhoneE164, AmountMinor: transfer.AmountMinor, Currency: transfer.Currency, TransactionAt: now, ActorID: "statement-recorder", IdempotencyKey: "row-" + key, CorrelationID: "row-correlation-" + key})
		if err != nil {
			t.Fatal(err)
		}
		item, err := ReconcileManualTransfer(s.ctx, s.db, cipher, ReconcileTransferInput{TransferID: transfer.ID, StatementRowID: row.ID, ActorID: "finance-reconciler", IdempotencyKey: "reconcile-" + key, CorrelationID: "reconcile-correlation-" + key})
		if err != nil || item.ExecutionStatus != "RECONCILED" {
			t.Fatalf("reconcile independently verified transfer: %+v %v", item, err)
		}
		var lines int
		var net sql.NullInt64
		if err := s.db.QueryRowContext(s.ctx, `SELECT count(*), SUM(CASE e.direction WHEN 'DEBIT' THEN e.amount_minor ELSE -e.amount_minor END)
			FROM wlt.ledger_transactions j JOIN wlt.ledger_entries e ON e.transaction_id=j.id
			WHERE j.source_type='MANUAL_EXTERNAL_TRANSFER' AND j.source_id=$1`, transfer.PayoutID).Scan(&lines, &net); err != nil || lines != 2 || !net.Valid || net.Int64 != 0 {
			t.Fatalf("reconciliation did not post a single balanced journal: lines=%d net=%v err=%v", lines, net, err)
		}
	}
	return s, batch, record, reconcile
}
