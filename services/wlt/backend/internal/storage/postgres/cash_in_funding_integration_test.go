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

func TestCashInProviderTransactionReferenceCannotCreditTwoActors(t *testing.T) {
	s := newFieldAcquisitionScenario(t)
	type candidate struct {
		actorType string
		actorID   string
		intentID  string
	}
	candidates := []candidate{
		{actorType: "customer", actorID: "provider-ref-customer-" + s.suffix},
		{actorType: "captain", actorID: "provider-ref-captain-" + s.suffix},
	}
	sharedReference := "provider-ref-collision-" + s.suffix
	for i := range candidates {
		c := &candidates[i]
		intent, replay, err := CreateCashInFundingIntent(s.ctx, s.db, CreateCashInFundingIntentInput{
			ActorType: c.actorType, ActorID: c.actorID, AmountMinor: 1000,
			Currency: "YER", ProviderKey: DevelopmentSimulatorProvider,
			IdempotencyKey: "fund-collision-" + c.actorID,
			CorrelationID:  "fund-collision-correlation-" + c.actorID,
		})
		if err != nil || replay {
			t.Fatalf("create %s funding intent replay=%t err=%v", c.actorType, replay, err)
		}
		c.intentID = intent.ID
	}
	type outcome struct {
		index  int
		record CashInFundingIntentRecord
		err    error
	}
	results := make(chan outcome, len(candidates))
	start := make(chan struct{})
	var wg sync.WaitGroup
	for i, c := range candidates {
		wg.Add(1)
		go func(i int, c candidate) {
			defer wg.Done()
			<-start
			record, _, err := ApplyCashInFundingResult(s.ctx, s.db, ApplyCashInFundingResultInput{
				FundingIntentID: c.intentID, Outcome: "SUCCESS",
				ProviderTransactionReference: sharedReference,
				ActorID:                      "synthetic-provider",
				IdempotencyKey:               "provider-result-" + c.actorID,
				CorrelationID:                "provider-result-correlation-" + c.actorID,
			})
			results <- outcome{index: i, record: record, err: err}
		}(i, c)
	}
	close(start)
	wg.Wait()
	close(results)
	winner, loser := -1, -1
	for result := range results {
		if result.err == nil && result.record.State == "SETTLED" {
			if winner != -1 {
				t.Fatalf("same provider reference settled two funding intents: %d and %d", winner, result.index)
			}
			winner = result.index
		} else if errors.Is(result.err, ErrFundingProviderReferenceUsed) {
			loser = result.index
		} else {
			t.Fatalf("unexpected provider-reference outcome for actor %d: %+v", result.index, result)
		}
	}
	if winner < 0 || loser < 0 || winner == loser {
		t.Fatalf("provider reference uniqueness not enforced: winner=%d loser=%d", winner, loser)
	}
	for i, c := range candidates {
		actual, err := ReadCashInFundingIntent(s.ctx, s.db, c.intentID)
		if err != nil {
			t.Fatal(err)
		}
		balance, err := ReadWalletBalance(s.ctx, s.db, c.actorType, c.actorID)
		if err != nil {
			t.Fatal(err)
		}
		var count int
		if err := s.db.QueryRowContext(s.ctx, "SELECT COUNT(*) FROM wlt.ledger_transactions WHERE source_type='FUNDING_INTENT' AND source_id=$1", c.intentID).Scan(&count); err != nil {
			t.Fatal(err)
		}
		if i == winner {
			if actual.State != "SETTLED" || balance != 1000 || count != 1 {
				t.Fatalf("winning actor has inconsistent settled funds: %+v balance=%d transactions=%d", actual, balance, count)
			}
		} else if actual.State != "PENDING_PROVIDER" || balance != 0 || count != 0 {
			t.Fatalf("losing actor received money or failed to roll back: %+v balance=%d transactions=%d", actual, balance, count)
		}
	}
	// A rejected provider-reference collision must leave the second intent
	// fully retryable with independent verified provider evidence.
	c := candidates[loser]
	recovered, replay, err := ApplyCashInFundingResult(s.ctx, s.db, ApplyCashInFundingResultInput{
		FundingIntentID: c.intentID, Outcome: "SUCCESS",
		ProviderTransactionReference: sharedReference + "-unique",
		ActorID:                      "synthetic-provider",
		IdempotencyKey:               "provider-recovery-" + c.actorID,
		CorrelationID:                "provider-recovery-correlation-" + c.actorID,
	})
	if err != nil || replay || recovered.State != "SETTLED" {
		t.Fatalf("independent valid funding evidence could not recover: %+v replay=%t err=%v", recovered, replay, err)
	}
	var collisionCount int
	if err := s.db.QueryRowContext(s.ctx, "SELECT COUNT(*) FROM wlt.cash_in_funding_intents WHERE provider_key=$1 AND provider_transaction_reference=$2", DevelopmentSimulatorProvider, sharedReference).Scan(&collisionCount); err != nil || collisionCount != 1 {
		t.Fatalf("shared provider reference settled %d times, err=%v", collisionCount, err)
	}
}
