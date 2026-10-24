package postgres

import (
	"errors"
	"testing"
)

// Provider-scoped Cash-In closure runs only on the isolated WLT_TEST_DATABASE_URL.
// Every scenario asserts the canonical wallet balance and persisted ledger, not
// just an HTTP response or a success screen.
func TestCashInMultiProviderRecoveryIsolation(t *testing.T) {
	s := newFieldAcquisitionScenario(t)
	const providerA = "WALLET_PROVIDER_TEST_ALPHA"
	const providerB = "WALLET_PROVIDER_TEST_BETA"
	actor := "cash-in-provider-recovery-" + s.suffix
	create := func(label, provider string, amount int64) CashInFundingIntentRecord {
		t.Helper()
		key := "cashin-" + label + "-" + s.suffix
		input := CreateCashInFundingIntentInput{
			ActorType: "customer", ActorID: actor, AmountMinor: amount,
			Currency: "YER", ProviderKey: provider, IdempotencyKey: key,
			CorrelationID: key + "-correlation",
		}
		item, replay, err := CreateCashInFundingIntent(s.ctx, s.db, input)
		if err != nil || replay || item.State != "PENDING_PROVIDER" || item.LedgerTransactionID != nil {
			t.Fatalf("%s create: %+v replay=%t err=%v", label, item, replay, err)
		}
		if again, wasReplay, err := CreateCashInFundingIntent(s.ctx, s.db, input); err != nil || !wasReplay || again.ID != item.ID {
			t.Fatalf("%s intent retry was not idempotent: %+v %t %v", label, again, wasReplay, err)
		}
		altered := input
		if provider == providerA {
			altered.ProviderKey = providerB
		} else {
			altered.ProviderKey = providerA
		}
		if _, _, err := CreateCashInFundingIntent(s.ctx, s.db, altered); !errors.Is(err, ErrIdempotencyConflict) {
			t.Fatalf("%s reused idempotency key across providers: %v", label, err)
		}
		return item
	}
	checkBalance := func(want int64) {
		t.Helper()
		balance, err := ReadWalletBalance(s.ctx, s.db, "customer", actor)
		if err != nil || balance != want {
			t.Fatalf("unexpected actual wallet balance: %d, want %d, err=%v", balance, want, err)
		}
	}
	apply := func(item CashInFundingIntentRecord, outcome, transaction, key string) (CashInFundingIntentRecord, bool, error) {
		return ApplyCashInFundingResult(s.ctx, s.db, ApplyCashInFundingResultInput{
			FundingIntentID: item.ID, Outcome: outcome, ProviderTransactionReference: transaction,
			ProviderFeeMinor: func() int64 {
				if outcome == "SUCCESS" {
					return 37
				}
				return 0
			}(),
			ActorID: actor, IdempotencyKey: key + "-" + s.suffix,
			CorrelationID: "cashin-recovery-correlation-" + s.suffix,
		})
	}
	pending := create("pending", providerA, 1000)
	if got, _, err := apply(pending, "UNKNOWN", "", "pending-unknown"); err != nil || got.State != "UNKNOWN" || got.LedgerTransactionID != nil {
		t.Fatalf("unknown provider outcome must not credit: %+v err=%v", got, err)
	}
	if got, _, err := apply(pending, "DELAYED", "", "pending-delay"); err != nil || got.State != "UNKNOWN" || got.LedgerTransactionID != nil {
		t.Fatalf("delayed provider must remain unresolved: %+v err=%v", got, err)
	}
	checkBalance(0)
	failed := create("failed", providerB, 700)
	if got, _, err := apply(failed, "FAILURE", "", "failed-decline"); err != nil || got.State != "FAILED" || got.LedgerTransactionID != nil {
		t.Fatalf("failed provider must never credit: %+v err=%v", got, err)
	}
	checkBalance(0)
	if _, _, err := apply(failed, "SUCCESS", "txn-failed-after-final", "failed-after-final"); !errors.Is(err, ErrFundingIntentState) {
		t.Fatalf("late success reversed a finalized failure: %v", err)
	}
	// Four concurrent retries of the *same* provider confirmation must post exactly once.
	const retries = 4
	type result struct {
		record CashInFundingIntentRecord
		replay bool
		err    error
	}
	start := make(chan struct{})
	results := make(chan result, retries)
	for i := 0; i < retries; i++ {
		go func() {
			<-start
			record, replay, err := apply(pending, "SUCCESS", "provider-txn-shared-"+s.suffix, "pending-confirm")
			results <- result{record, replay, err}
		}()
	}
	close(start)
	var ledgerID string
	originals, replays := 0, 0
	for i := 0; i < retries; i++ {
		got := <-results
		if got.err != nil || got.record.State != "SETTLED" || got.record.LedgerTransactionID == nil {
			t.Fatalf("concurrent settlement %d %+v", i, got)
		}
		if ledgerID == "" {
			ledgerID = *got.record.LedgerTransactionID
		}
		if *got.record.LedgerTransactionID != ledgerID {
			t.Fatal("concurrent retry generated multiple ledgers")
		}
		if got.replay {
			replays++
		} else {
			originals++
		}
	}
	if originals != 1 || replays != retries-1 {
		t.Fatalf("original=%d replays=%d", originals, replays)
	}
	checkBalance(1000)
	var lines int
	var debit, credit int64
	if err := s.db.QueryRowContext(s.ctx, `SELECT COUNT(*),
		COALESCE(SUM(amount_minor) FILTER (WHERE direction='DEBIT'),0),
		COALESCE(SUM(amount_minor) FILTER (WHERE direction='CREDIT'),0)
		FROM wlt.ledger_entries WHERE transaction_id=$1`, ledgerID).Scan(&lines, &debit, &credit); err != nil || lines != 3 || debit != 1000 || credit != 1000 {
		t.Fatalf("ledger balance lines=%d debit=%d credit=%d err=%v", lines, debit, credit, err)
	}
	// A duplicate provider settlement reference is rejected within that provider.
	collision := create("collision", providerA, 2000)
	if _, _, err := apply(collision, "SUCCESS", "provider-txn-shared-"+s.suffix, "collision-confirm"); !errors.Is(err, ErrFundingProviderReferenceUsed) {
		t.Fatalf("provider reused settled transaction ref: %v", err)
	}
	if got, err := ReadCashInFundingIntent(s.ctx, s.db, collision.ID); err != nil || got.State != "PENDING_PROVIDER" || got.LedgerTransactionID != nil {
		t.Fatalf("duplicate provider ref left an orphan ledger: %+v err=%v", got, err)
	}
	checkBalance(1000)
	// Another provider's native transaction namespace may independently use that ref.
	other := create("other", providerB, 500)
	if got, _, err := apply(other, "SUCCESS", "provider-txn-shared-"+s.suffix, "other-confirm"); err != nil || got.State != "SETTLED" {
		t.Fatalf("cross-provider transaction namespace was incorrectly shared: %+v %v", got, err)
	}
	checkBalance(1500)
	if _, _, err := apply(pending, "SUCCESS", "new-ref-"+s.suffix, "pending-late-duplicate"); !errors.Is(err, ErrFundingIntentState) {
		t.Fatalf("late second settlement accepted: %v", err)
	}
	checkBalance(1500)
}
