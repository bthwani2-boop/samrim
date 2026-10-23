package postgres

import (
	"errors"
	"fmt"
	"testing"
)

func TestCashInProviderFeesArePlatformExpenseNotWalletDeduction(t *testing.T) {
	s := newFieldAcquisitionScenario(t)
	for _, actorType := range []string{"customer", "captain"} {
		t.Run(actorType, func(t *testing.T) {
			actor := "fee-" + actorType + "-" + s.suffix
			fund, _, err := CreateCashInFundingIntent(s.ctx, s.db, CreateCashInFundingIntentInput{
				ActorType: actorType, ActorID: actor, AmountMinor: 1000, Currency: "YER",
				ProviderKey: DevelopmentSimulatorProvider, IdempotencyKey: actor + "-fund",
				CorrelationID: actor + "-fund-correlation",
			})
			if err != nil {
				t.Fatal(err)
			}
			confirmation := ApplyCashInFundingResultInput{
				FundingIntentID: fund.ID, Outcome: "SUCCESS",
				ProviderTransactionReference: "fee-provider-" + actor,
				ProviderFeeMinor:             20, ActorID: "provider-settlement",
				IdempotencyKey: actor + "-settle", CorrelationID: actor + "-settle-correlation",
			}
			settled, replay, err := ApplyCashInFundingResult(s.ctx, s.db, confirmation)
			if err != nil || replay || settled.State != "SETTLED" || settled.ProviderFeeMinor != 20 || settled.LedgerTransactionID == nil {
				t.Fatalf("settlement %+v replay=%t err=%v", settled, replay, err)
			}
			balance, err := ReadWalletBalance(s.ctx, s.db, actorType, actor)
			if err != nil || balance != 1000 {
				t.Fatalf("beneficiary must receive gross amount, balance=%d err=%v", balance, err)
			}
			var net, providerExpense, walletCredit, totalDebit, totalCredit int64
			query := "SELECT COALESCE(SUM(amount_minor) FILTER (WHERE account_code='EXTERNAL_SETTLEMENT_CASH' AND direction='DEBIT'),0)," +
				" COALESCE(SUM(amount_minor) FILTER (WHERE account_code='PLATFORM_CASH_IN_PROVIDER_FEE_EXPENSE' AND direction='DEBIT'),0)," +
				" COALESCE(SUM(amount_minor) FILTER (WHERE account_code IN ('CUSTOMER_WALLET','CAPTAIN_WALLET') AND direction='CREDIT'),0)," +
				" COALESCE(SUM(amount_minor) FILTER (WHERE direction='DEBIT'),0)," +
				" COALESCE(SUM(amount_minor) FILTER (WHERE direction='CREDIT'),0) FROM wlt.ledger_entries WHERE transaction_id=$1"
			err = s.db.QueryRowContext(s.ctx, query, *settled.LedgerTransactionID).
				Scan(&net, &providerExpense, &walletCredit, &totalDebit, &totalCredit)
			if err != nil || net != 980 || providerExpense != 20 || walletCredit != 1000 || totalDebit != 1000 || totalCredit != 1000 {
				t.Fatalf("net=%d fee=%d wallet=%d debits=%d credits=%d err=%v", net, providerExpense, walletCredit, totalDebit, totalCredit, err)
			}
			repeated, replayed, err := ApplyCashInFundingResult(s.ctx, s.db, confirmation)
			if err != nil || !replayed || repeated.LedgerTransactionID == nil || *repeated.LedgerTransactionID != *settled.LedgerTransactionID {
				t.Fatalf("idempotent replay %+v replay=%t err=%v", repeated, replayed, err)
			}
			confirmation.ProviderFeeMinor = 21
			if _, _, err = ApplyCashInFundingResult(s.ctx, s.db, confirmation); !errors.Is(err, ErrIdempotencyConflict) {
				t.Fatalf("changed fee on same key should be rejected, got %v", err)
			}
		})
	}
	for _, fee := range []int64{-1, 1000, 1001} {
		t.Run(fmt.Sprintf("reject_fee_%d", fee), func(t *testing.T) {
			actor := fmt.Sprintf("fee-invalid-%d-%s", fee, s.suffix)
			fund, _, err := CreateCashInFundingIntent(s.ctx, s.db, CreateCashInFundingIntentInput{
				ActorType: "customer", ActorID: actor, AmountMinor: 1000, Currency: "YER",
				ProviderKey: DevelopmentSimulatorProvider, IdempotencyKey: actor + "-fund",
				CorrelationID: actor + "-fund-correlation",
			})
			if err != nil {
				t.Fatal(err)
			}
			_, _, err = ApplyCashInFundingResult(s.ctx, s.db, ApplyCashInFundingResultInput{
				FundingIntentID: fund.ID, Outcome: "SUCCESS", ProviderFeeMinor: fee,
				ProviderTransactionReference: actor + "-ref", ActorID: "provider",
				IdempotencyKey: actor + "-settle", CorrelationID: actor + "-settle-correlation",
			})
			if !errors.Is(err, ErrInvalidInput) {
				t.Fatalf("expected fail closed for fee=%d: %v", fee, err)
			}
			reread, err := ReadCashInFundingIntent(s.ctx, s.db, fund.ID)
			if err != nil || reread.State != "PENDING_PROVIDER" || reread.LedgerTransactionID != nil {
				t.Fatalf("no ledger after invalid fee: %+v %v", reread, err)
			}
		})
	}
}
