package postgres

import (
	"context"
	"database/sql"
	"testing"
	"time"
)

func TestPayoutSettlementValidators(t *testing.T) {
	t.Run("mutation context boundaries", func(t *testing.T) {
		valid := []struct {
			idempotencyKey string
			correlationID  string
		}{
			{idempotencyKey: "12345678", correlationID: "abcdefgh"},
			{idempotencyKey: string(make([]byte, 128)), correlationID: string(make([]byte, 128))},
		}
		for _, item := range valid {
			if !validMutationContext(item.idempotencyKey, item.correlationID) {
				t.Fatalf("expected valid mutation context for lengths %d/%d", len(item.idempotencyKey), len(item.correlationID))
			}
		}

		invalid := []struct {
			idempotencyKey string
			correlationID  string
		}{
			{idempotencyKey: "1234567", correlationID: "abcdefgh"},
			{idempotencyKey: "12345678", correlationID: "abcdefg"},
			{idempotencyKey: string(make([]byte, 129)), correlationID: "abcdefgh"},
			{idempotencyKey: "12345678", correlationID: string(make([]byte, 129))},
		}
		for _, item := range invalid {
			if validMutationContext(item.idempotencyKey, item.correlationID) {
				t.Fatalf("expected invalid mutation context for lengths %d/%d", len(item.idempotencyKey), len(item.correlationID))
			}
		}
	})

	t.Run("payout statuses", func(t *testing.T) {
		for _, status := range []string{"HELD", "CANCELLED", "PREPARED", "APPROVED", "FROZEN", "EXECUTED", "COMPLETED", "EXCEPTION"} {
			if !validPayoutStatus(status) {
				t.Fatalf("expected payout status %q to be valid", status)
			}
		}
		for _, status := range []string{"", "held", "PENDING", "APPROVE"} {
			if validPayoutStatus(status) {
				t.Fatalf("expected payout status %q to be invalid", status)
			}
		}
	})

	t.Run("settlement batch statuses", func(t *testing.T) {
		for _, status := range []string{"DRAFT", "PREPARED", "APPROVED", "FROZEN", "EXECUTION_IN_PROGRESS", "AWAITING_VERIFICATION", "AWAITING_RECONCILIATION", "COMPLETED", "CANCELLED", "EXCEPTION"} {
			if !validSettlementBatchStatus(status) {
				t.Fatalf("expected settlement batch status %q to be valid", status)
			}
		}
		for _, status := range []string{"", "frozen", "EXECUTED", "PENDING"} {
			if validSettlementBatchStatus(status) {
				t.Fatalf("expected settlement batch status %q to be invalid", status)
			}
		}
	})

	t.Run("sha256 format", func(t *testing.T) {
		if !validSHA256("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef") {
			t.Fatal("expected lowercase 64-character SHA-256 to be valid")
		}
		for _, value := range []string{
			"",
			"0123456789abcdef",
			"0123456789ABCDEF0123456789abcdef0123456789abcdef0123456789abcdef",
			"g123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
		} {
			if validSHA256(value) {
				t.Fatalf("expected SHA-256 value %q to be invalid", value)
			}
		}
	})
}

func TestPayoutSettlementRejectsInvalidInputsBeforeDatabaseMutation(t *testing.T) {
	ctx := context.Background()
	zeroDB := &sql.DB{}
	validKey := "idem-key"
	validCorrelation := "corr-key"

	if _, err := ListPayoutRequests(ctx, nil, "", 10); err != ErrPayoutInvalidInput {
		t.Fatalf("ListPayoutRequests nil db: got %v, want %v", err, ErrPayoutInvalidInput)
	}
	if _, err := ListPayoutRequests(ctx, zeroDB, "not-a-status", 10); err != ErrPayoutInvalidInput {
		t.Fatalf("ListPayoutRequests invalid status: got %v, want %v", err, ErrPayoutInvalidInput)
	}

	payoutCases := []struct {
		name string
		call func() error
	}{
		{
			name: "prepare missing payout id",
			call: func() error {
				_, err := PreparePayout(ctx, zeroDB, PreparePayoutInput{ActorID: "operator", Reason: "reviewed", Evidence: "evidence", IdempotencyKey: validKey, CorrelationID: validCorrelation})
				return err
			},
		},
		{
			name: "approve missing reason",
			call: func() error {
				_, err := ApprovePayout(ctx, zeroDB, ApprovePayoutInput{PayoutID: "payout-1", ActorID: "operator", IdempotencyKey: validKey, CorrelationID: validCorrelation})
				return err
			},
		},
		{
			name: "cancel short idempotency key",
			call: func() error {
				_, err := CancelPayout(ctx, zeroDB, CancelPayoutInput{PayoutID: "payout-1", ActorID: "operator", Reason: "cancelled", IdempotencyKey: "short", CorrelationID: validCorrelation})
				return err
			},
		},
	}
	for _, tc := range payoutCases {
		t.Run(tc.name, func(t *testing.T) {
			if err := tc.call(); err != ErrPayoutInvalidInput {
				t.Fatalf("got %v, want %v", err, ErrPayoutInvalidInput)
			}
		})
	}

	batchCases := []struct {
		name string
		call func() error
	}{
		{
			name: "create batch removes empty ids then rejects empty set",
			call: func() error {
				_, err := CreateSettlementBatch(ctx, zeroDB, CreateSettlementBatchInput{PayoutIDs: []string{"", "  "}, ActorID: "operator", IdempotencyKey: validKey, CorrelationID: validCorrelation})
				return err
			},
		},
		{
			name: "approve batch requires reason",
			call: func() error {
				_, err := ApproveSettlementBatch(ctx, zeroDB, BatchActionInput{BatchID: "batch-1", ActorID: "operator", IdempotencyKey: validKey, CorrelationID: validCorrelation})
				return err
			},
		},
		{
			name: "freeze batch rejects short correlation id",
			call: func() error {
				_, err := FreezeSettlementBatch(ctx, zeroDB, BatchActionInput{BatchID: "batch-1", ActorID: "operator", IdempotencyKey: validKey, CorrelationID: "short"})
				return err
			},
		},
		{
			name: "record transfer requires external reference",
			call: func() error {
				_, err := RecordManualTransfer(ctx, zeroDB, RecordTransferInput{BatchID: "batch-1", PayoutID: "payout-1", ActorID: "operator", ReceiptDocumentID: "document-1", IdempotencyKey: validKey, CorrelationID: validCorrelation})
				return err
			},
		},
		{
			name: "verify transfer requires transfer id",
			call: func() error {
				_, err := VerifyManualTransfer(ctx, zeroDB, VerifyTransferInput{ActorID: "operator", IdempotencyKey: validKey, CorrelationID: validCorrelation})
				return err
			},
		},
	}
	for _, tc := range batchCases {
		t.Run(tc.name, func(t *testing.T) {
			if err := tc.call(); err != ErrSettlementBatchInput {
				t.Fatalf("got %v, want %v", err, ErrSettlementBatchInput)
			}
		})
	}

	now := time.Date(2026, 9, 29, 12, 0, 0, 0, time.UTC)
	statementCases := []struct {
		name string
		call func() error
	}{
		{
			name: "statement requires YER",
			call: func() error {
				_, err := RegisterSettlementStatement(ctx, zeroDB, SettlementStatementInput{ProviderKey: "provider", Currency: "USD", PeriodStart: now, PeriodEnd: now, EvidenceDocumentID: "document-1", ActorID: "operator", IdempotencyKey: validKey, CorrelationID: validCorrelation})
				return err
			},
		},
		{
			name: "statement rejects reversed period",
			call: func() error {
				_, err := RegisterSettlementStatement(ctx, zeroDB, SettlementStatementInput{ProviderKey: "provider", Currency: "YER", PeriodStart: now, PeriodEnd: now.Add(-time.Hour), EvidenceDocumentID: "document-1", ActorID: "operator", IdempotencyKey: validKey, CorrelationID: validCorrelation})
				return err
			},
		},
		{
			name: "statement row requires cipher",
			call: func() error {
				_, err := RecordSettlementStatementRow(ctx, zeroDB, nil, SettlementStatementRowInput{StatementID: "statement-1", RowSequence: 1, ExternalReference: "external-1", WalletIdentifier: "+967771234567", AmountMinor: 1000, Currency: "YER", TransactionAt: now, ActorID: "operator", IdempotencyKey: validKey, CorrelationID: validCorrelation})
				return err
			},
		},
		{
			name: "reconcile requires cipher",
			call: func() error {
				_, err := ReconcileManualTransfer(ctx, zeroDB, nil, ReconcileTransferInput{TransferID: "transfer-1", StatementRowID: "row-1", ActorID: "operator", IdempotencyKey: validKey, CorrelationID: validCorrelation})
				return err
			},
		},
	}
	for _, tc := range statementCases {
		t.Run(tc.name, func(t *testing.T) {
			if err := tc.call(); err != ErrSettlementBatchInput {
				t.Fatalf("got %v, want %v", err, ErrSettlementBatchInput)
			}
		})
	}

	if _, err := ReadSettlementBatch(ctx, nil, "batch-1"); err != ErrSettlementBatchInput {
		t.Fatalf("ReadSettlementBatch nil db: got %v, want %v", err, ErrSettlementBatchInput)
	}
	if _, _, err := ListSettlementBatches(ctx, nil, "", nil, "", 25); err != ErrSettlementBatchInput {
		t.Fatalf("ListSettlementBatches nil db: got %v, want %v", err, ErrSettlementBatchInput)
	}
}
