package postgres

import (
	"context"
	"database/sql"
	"testing"
	"time"
)

func TestValidMutationContext(t *testing.T) {
	cases := []struct {
		name           string
		idempotencyKey string
		correlationID  string
		want           bool
	}{
		{name: "minimum lengths", idempotencyKey: "12345678", correlationID: "abcdefgh", want: true},
		{name: "maximum lengths", idempotencyKey: string(make([]byte, 128)), correlationID: string(make([]byte, 128)), want: true},
		{name: "short idempotency key", idempotencyKey: "1234567", correlationID: "abcdefgh", want: false},
		{name: "short correlation id", idempotencyKey: "12345678", correlationID: "abcdefg", want: false},
		{name: "long idempotency key", idempotencyKey: string(make([]byte, 129)), correlationID: "abcdefgh", want: false},
		{name: "long correlation id", idempotencyKey: "12345678", correlationID: string(make([]byte, 129)), want: false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := validMutationContext(tc.idempotencyKey, tc.correlationID); got != tc.want {
				t.Fatalf("validMutationContext lengths %d/%d: got %v, want %v", len(tc.idempotencyKey), len(tc.correlationID), got, tc.want)
			}
		})
	}
}

func TestValidPayoutStatus(t *testing.T) {
	cases := map[string]bool{
		"HELD": true, "CANCELLED": true, "PREPARED": true, "APPROVED": true,
		"FROZEN": true, "EXECUTED": true, "COMPLETED": true, "EXCEPTION": true,
		"": false, "held": false, "PENDING": false, "APPROVE": false,
	}
	for status, want := range cases {
		if got := validPayoutStatus(status); got != want {
			t.Fatalf("validPayoutStatus(%q): got %v, want %v", status, got, want)
		}
	}
}

func TestValidSettlementBatchStatus(t *testing.T) {
	cases := map[string]bool{
		"DRAFT": true, "PREPARED": true, "APPROVED": true, "FROZEN": true,
		"EXECUTION_IN_PROGRESS": true, "AWAITING_VERIFICATION": true,
		"AWAITING_RECONCILIATION": true, "COMPLETED": true, "CANCELLED": true,
		"EXCEPTION": true, "": false, "frozen": false, "EXECUTED": false, "PENDING": false,
	}
	for status, want := range cases {
		if got := validSettlementBatchStatus(status); got != want {
			t.Fatalf("validSettlementBatchStatus(%q): got %v, want %v", status, got, want)
		}
	}
}

func TestValidSHA256(t *testing.T) {
	cases := map[string]bool{
		"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef": true,
		"":                 false,
		"0123456789abcdef": false,
		"0123456789ABCDEF0123456789abcdef0123456789abcdef0123456789abcdef": false,
		"g123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef": false,
	}
	for value, want := range cases {
		if got := validSHA256(value); got != want {
			t.Fatalf("validSHA256(%q): got %v, want %v", value, got, want)
		}
	}
}

func TestPayoutMutationInputsRejectBeforeDatabase(t *testing.T) {
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

	cases := []struct {
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
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if err := tc.call(); err != ErrPayoutInvalidInput {
				t.Fatalf("got %v, want %v", err, ErrPayoutInvalidInput)
			}
		})
	}
}

func TestSettlementBatchMutationInputsRejectBeforeDatabase(t *testing.T) {
	ctx := context.Background()
	zeroDB := &sql.DB{}
	validKey := "idem-key"
	validCorrelation := "corr-key"

	cases := []struct {
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
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if err := tc.call(); err != ErrSettlementBatchInput {
				t.Fatalf("got %v, want %v", err, ErrSettlementBatchInput)
			}
		})
	}
}

func TestSettlementStatementInputsRejectBeforeDatabase(t *testing.T) {
	ctx := context.Background()
	zeroDB := &sql.DB{}
	validKey := "idem-key"
	validCorrelation := "corr-key"
	now := time.Date(2026, 9, 29, 12, 0, 0, 0, time.UTC)

	cases := []struct {
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
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if err := tc.call(); err != ErrSettlementBatchInput {
				t.Fatalf("got %v, want %v", err, ErrSettlementBatchInput)
			}
		})
	}
}

func TestSettlementReadsRejectInvalidInput(t *testing.T) {
	ctx := context.Background()
	if _, err := ReadSettlementBatch(ctx, nil, "batch-1"); err != ErrSettlementBatchInput {
		t.Fatalf("ReadSettlementBatch nil db: got %v, want %v", err, ErrSettlementBatchInput)
	}
	if _, _, err := ListSettlementBatches(ctx, nil, "", nil, "", 25); err != ErrSettlementBatchInput {
		t.Fatalf("ListSettlementBatches nil db: got %v, want %v", err, ErrSettlementBatchInput)
	}
}
