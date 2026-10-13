package postgres

import (
	"errors"
	"fmt"
	"sync"
	"testing"
)

// Synthetic provider-result callbacks exercise WLT's real PostgreSQL
// transaction and double-entry invariants. No external transfer is made.
func TestCashInFundingProviderRetryPostsOneBalancedWalletCredit(t *testing.T) {
	s := newFieldAcquisitionScenario(t)
	for _, sample := range []struct {
		actorType string
		amount    int64
	}{
		{actorType: "customer", amount: 2000},
		{actorType: "captain", amount: 3000},
	} {
		t.Run(sample.actorType, func(t *testing.T) {
			actor := "cash-in-" + sample.actorType + "-" + s.suffix
			canonical, err := ReadWalletBalance(s.ctx, s.db, sample.actorType, actor)
			if err != nil || canonical != 0 {
				t.Fatalf("starting wallet balance=%d err=%v", canonical, err)
			}
			created, repeated, err := CreateCashInFundingIntent(s.ctx, s.db, CreateCashInFundingIntentInput{
				ActorType: sample.actorType, ActorID: actor, AmountMinor: sample.amount,
				Currency: "YER", ProviderKey: DevelopmentSimulatorProvider,
				IdempotencyKey: "cash-in-" + actor, CorrelationID: "cash-in-correlation-" + actor,
			})
			if err != nil || repeated || created.State != "PENDING_PROVIDER" {
				t.Fatalf("create funding intent: state=%q replay=%t err=%v", created.State, repeated, err)
			}
			unknownInput := ApplyCashInFundingResultInput{
				FundingIntentID: created.ID, Outcome: "UNKNOWN",
				ActorID:        "funding-proof-operator",
				IdempotencyKey: "cash-in-unknown-" + actor,
				CorrelationID:  "cash-in-unknown-correlation-" + actor,
			}
			unknown, replayed, err := ApplyCashInFundingResult(s.ctx, s.db, unknownInput)
			if err != nil || replayed || unknown.State != "UNKNOWN" || unknown.LedgerTransactionID != nil {
				t.Fatalf("unknown provider result moved money: state=%q replay=%t ledger=%v err=%v", unknown.State, replayed, unknown.LedgerTransactionID, err)
			}
			balance, err := ReadWalletBalance(s.ctx, s.db, sample.actorType, actor)
			if err != nil || balance != 0 {
				t.Fatalf("unknown provider result credited wallet: balance=%d err=%v", balance, err)
			}
			success := ApplyCashInFundingResultInput{
				FundingIntentID: created.ID, Outcome: "SUCCESS",
				ProviderTransactionReference: "synthetic-settlement-" + actor,
				ActorID:                      "funding-proof-operator",
				IdempotencyKey:               "cash-in-success-" + actor,
				CorrelationID:                "cash-in-success-correlation-" + actor,
			}
			type result struct {
				intent CashInFundingIntentRecord
				replay bool
				err    error
			}
			start := make(chan struct{})
			results := make(chan result, 2)
			var wg sync.WaitGroup
			for range 2 {
				wg.Add(1)
				go func() {
					defer wg.Done()
					<-start
					intent, replay, e := ApplyCashInFundingResult(s.ctx, s.db, success)
					results <- result{intent, replay, e}
				}()
			}
			close(start)
			wg.Wait()
			close(results)
			newCount, replayCount := 0, 0
			var ledgerID string
			for outcome := range results {
				if outcome.err != nil || outcome.intent.State != "SETTLED" || outcome.intent.LedgerTransactionID == nil {
					t.Fatalf("provider callback settlement failed: %+v", outcome)
				}
				if ledgerID != "" && ledgerID != *outcome.intent.LedgerTransactionID {
					t.Fatalf("duplicate provider result used multiple ledger transactions: %s != %s", ledgerID, *outcome.intent.LedgerTransactionID)
				}
				ledgerID = *outcome.intent.LedgerTransactionID
				if outcome.replay {
					replayCount++
				} else {
					newCount++
				}
			}
			if newCount != 1 || replayCount != 1 {
				t.Fatalf("callback results new=%d replay=%d", newCount, replayCount)
			}
			var lineCount, transactionCount int
			var debits, credits int64
			err = s.db.QueryRowContext(s.ctx, `SELECT COUNT(*),
				COALESCE(SUM(amount_minor) FILTER (WHERE direction='DEBIT'),0),
				COALESCE(SUM(amount_minor) FILTER (WHERE direction='CREDIT'),0)
				FROM wlt.ledger_entries WHERE transaction_id=$1`, ledgerID).
				Scan(&lineCount, &debits, &credits)
			if err != nil || lineCount != 2 || debits != sample.amount || credits != sample.amount {
				t.Fatalf("unbalanced funding ledger: lines=%d debit=%d credit=%d err=%v", lineCount, debits, credits, err)
			}
			err = s.db.QueryRowContext(s.ctx, `SELECT COUNT(*) FROM wlt.ledger_transactions
				WHERE source_type='FUNDING_INTENT' AND source_id=$1`, created.ID).Scan(&transactionCount)
			if err != nil || transactionCount != 1 {
				t.Fatalf("funding transaction count=%d err=%v", transactionCount, err)
			}
			balance, err = ReadWalletBalance(s.ctx, s.db, sample.actorType, actor)
			if err != nil || balance != sample.amount {
				t.Fatalf("wallet credited incorrectly: balance=%d want=%d err=%v", balance, sample.amount, err)
			}
			newKey := success
			newKey.IdempotencyKey += "-different"
			if _, _, err := ApplyCashInFundingResult(s.ctx, s.db, newKey); !errors.Is(err, ErrFundingIntentState) {
				t.Fatalf("settled intent accepted a new settlement key: %v", err)
			}
			changed := success
			changed.ProviderTransactionReference += "-different"
			if _, _, err := ApplyCashInFundingResult(s.ctx, s.db, changed); !errors.Is(err, ErrIdempotencyConflict) {
				t.Fatalf("same callback key accepted conflicting provider transaction: %v", err)
			}
			finalBalance, err := ReadWalletBalance(s.ctx, s.db, sample.actorType, actor)
			if err != nil || finalBalance != sample.amount {
				t.Fatal(fmt.Sprintf("retry double-credited %s wallet: balance=%d err=%v", sample.actorType, finalBalance, err))
			}
		})
	}
}
