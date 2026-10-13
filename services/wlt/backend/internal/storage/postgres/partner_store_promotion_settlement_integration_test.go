package postgres

import (
	"fmt"
	"testing"

	"github.com/bthwani2-boop/samrim/services/wlt/backend/internal/domain"
)

// Proves the funded discount is paid to the Partner even where cash was collected
// by the Store, not a BTHWANI Captain. Cash stays at the Store; the platform
// subsidy is the only net Partner-wallet credit on a cash-only order.
func TestFundedStoreCashCollectionPostsPlatformSubsidyExactlyOnce(t *testing.T) {
	s := newFieldAcquisitionScenario(t)
	owner, _, _, _, _, _, _, _, _ := setupPartnerFinanceProof(t, s, false)
	for _, mode := range []string{"CUSTOMER_PICKUP", "PARTNER_CAPTAIN"} {
		for _, source := range []struct {
			name                        string
			fundingSource               string
			share                       *int
			partnerMinor, platformMinor int64
			internalMinor               int64
		}{
			{name: "PARTNER", partnerMinor: 1000, platformMinor: 0},
			{name: "BTHWANI", partnerMinor: 0, platformMinor: 1000},
			{name: "SHARED", share: func() *int { v := 40; return &v }(), partnerMinor: 400, platformMinor: 600},
			{name: "SHARED_WITH_WALLET", fundingSource: "SHARED", share: func() *int { v := 40; return &v }(), partnerMinor: 400, platformMinor: 600, internalMinor: 1200},
		} {
			t.Run(mode+"/"+source.name, func(t *testing.T) {
				store := fmt.Sprintf("promo-store-%s-%s-%s", mode, source.name, s.suffix)
				order := fmt.Sprintf("promo-order-%s-%s-%s", mode, source.name, s.suffix)
				customer := "promo-customer-" + order
				cashMinor := 4000 - source.internalMinor
				fundingSource := source.name
				if source.fundingSource != "" {
					fundingSource = source.fundingSource
				}
				if source.internalMinor > 0 {
					funding, _, err := CreateCashInFundingIntent(s.ctx, s.db, CreateCashInFundingIntentInput{
						ActorType: "customer", ActorID: customer, AmountMinor: source.internalMinor,
						Currency: "YER", ProviderKey: DevelopmentSimulatorProvider,
						IdempotencyKey: order + "-wallet-funding", CorrelationID: order + "-wallet-funding-correlation",
					})
					if err != nil {
						t.Fatal(err)
					}
					if _, _, err := ApplyCashInFundingResult(s.ctx, s.db, ApplyCashInFundingResultInput{
						FundingIntentID: funding.ID, Outcome: "SUCCESS",
						ProviderTransactionReference: order + "-simulation",
						ActorID:                      "synthetic-provider", IdempotencyKey: order + "-wallet-credit",
						CorrelationID: order + "-wallet-credit-correlation",
					}); err != nil {
						t.Fatal(err)
					}
				}
				agreement, _, err := ProposeStoreCommercialAgreement(s.ctx, s.db, ProposeStoreCommercialAgreementInput{
					StoreID: store, PartnerActorID: owner,
					Rates:   []StoreCommercialAgreementRate{{FulfillmentMode: mode, CommissionRateBps: 1000}},
					ActorID: "promo-proposer", Reason: "isolated funded store settlement",
					IdempotencyKey: order + "-propose", CorrelationID: order + "-propose-correlation",
				})
				if err != nil {
					t.Fatal(err)
				}
				agreement, _, err = AcceptStoreCommercialAgreement(s.ctx, s.db, agreement.AgreementID, agreement.AgreementVersion, owner,
					"accepted", order+"-accept", order+"-accept-correlation")
				if err != nil {
					t.Fatal(err)
				}
				_, _, err = DecideStoreCommercialAgreement(s.ctx, s.db, StoreCommercialAgreementDecisionInput{
					AgreementID: agreement.AgreementID, ExpectedVersion: agreement.AgreementVersion, Decision: "APPROVE",
					ActorID: "promo-approver", CurrentStorePartnerActorID: owner, CurrentFulfillmentModes: []string{mode},
					Reason: "approved", IdempotencyKey: order + "-approve", CorrelationID: order + "-approve-correlation",
				})
				if err != nil {
					t.Fatal(err)
				}
				intent, replay, err := CreatePaymentIntent(s.ctx, s.db, CreatePaymentIntentInput{
					ExternalReference: order + "-external", PayerActorID: customer,
					OrderID: order, AmountMinor: cashMinor, Currency: "YER", Method: domain.MethodCashAtStore,
					CustomerPaymentAllocation: &CustomerPaymentAllocationInput{
						OrderID: order, StoreID: store, PartnerActorID: owner,
						CommercialStoreTypeID: "promo-type", FulfillmentMode: mode, Currency: "YER",
						SubtotalMinor: 5000, DiscountMinor: 1000, CashAmountMinor: cashMinor,
						InternalBalanceAmountMinor: source.internalMinor, CustomerPayableMinor: 4000, PolicyVersion: "promo-proof-v1",
						PromotionFunding: &PromotionFundingInput{
							PromotionID: "promo-" + s.suffix, PromotionVersion: 1, PromotionCode: "SAVE",
							StoreID: store, FundingSource: fundingSource, PartnerSharePercent: source.share, DiscountMinor: 1000,
						},
					},
					IdempotencyKey: order + "-create", CorrelationID: order + "-create-correlation",
				})
				if err != nil || replay {
					t.Fatalf("created payment replay=%t err=%v", replay, err)
				}
				_, replay, err = CollectPaymentIntent(s.ctx, s.db, CollectPaymentIntentInput{
					IntentID: intent.ID, CollectedAmountMinor: cashMinor, CollectedByActorID: owner,
					CollectionReference: order + "-cash", ExpectedVersion: intent.Version,
					IdempotencyKey: order + "-collect", CorrelationID: order + "-collect-correlation",
				})
				if err != nil || replay {
					t.Fatalf("collected payment replay=%t err=%v", replay, err)
				}
				input := PartnerStoreCashCommissionInput{
					OrderID: order, PaymentIntentID: intent.ID, PartnerActorID: owner, FulfillmentMode: mode,
					IdempotencyKey: order + "-commission", CorrelationID: order + "-commission-correlation",
				}
				record, replay, err := RecordPartnerStoreCashCommission(s.ctx, s.db, input)
				if err != nil || replay {
					t.Fatalf("posted commission replay=%t err=%v", replay, err)
				}
				if record.GrossProductMinor != 5000-source.partnerMinor {
					t.Fatalf("wrong funded gross=%d", record.GrossProductMinor)
				}
				var debit, credit, expense, walletCredit, commissionDebit, count int64
				err = s.db.QueryRowContext(s.ctx, `SELECT
                    COALESCE(SUM(amount_minor) FILTER(WHERE direction='DEBIT'),0),
                    COALESCE(SUM(amount_minor) FILTER(WHERE direction='CREDIT'),0),
                    COALESCE(SUM(amount_minor) FILTER(WHERE account_code='BTHWANI_PROMOTION_EXPENSE' AND direction='DEBIT'),0),
                    COALESCE(SUM(amount_minor) FILTER(WHERE account_code='PARTNER_WALLET' AND direction='CREDIT'),0),
                    COALESCE(SUM(amount_minor) FILTER(WHERE account_code='PARTNER_COMMISSION_RECEIVABLE' AND direction='DEBIT'),0),
                    COUNT(*) FROM wlt.ledger_entries WHERE transaction_id=$1`, record.LedgerTransactionID).
					Scan(&debit, &credit, &expense, &walletCredit, &commissionDebit, &count)
				if err != nil || count < 2 || debit != credit || expense != source.platformMinor || walletCredit != source.platformMinor+source.internalMinor ||
					commissionDebit != record.CommissionMinor || debit != source.platformMinor+source.internalMinor+record.CommissionMinor {
					t.Fatalf("unfunded store cash promotion: mode=%s source=%s debit=%d credit=%d expense=%d partner_wallet=%d commission=%d lines=%d row=%+v err=%v",
						mode, source.name, debit, credit, expense, walletCredit, commissionDebit, count, record, err)
				}
				repeated, replayed, err := RecordPartnerStoreCashCommission(s.ctx, s.db, input)
				if err != nil || !replayed || repeated.LedgerTransactionID != record.LedgerTransactionID {
					t.Fatalf("commission replay mismatch %+v replay=%t err=%v", repeated, replayed, err)
				}
				var transactions int
				err = s.db.QueryRowContext(s.ctx, "SELECT COUNT(*) FROM wlt.ledger_transactions WHERE source_type='PARTNER_STORE_CASH_COMMISSION' AND source_id=$1", order).Scan(&transactions)
				if err != nil || transactions != 1 {
					t.Fatalf("double posted store commission: count=%d err=%v", transactions, err)
				}
				stores, err := ReadPartnerStoreFinance(s.ctx, s.db, owner, []string{store})
				if err != nil || len(stores) != 1 || stores[0].EarnedMinor != source.platformMinor+source.internalMinor ||
					stores[0].EligibleAvailableMinor != source.platformMinor+source.internalMinor ||
					!stores[0].AttributionComplete {
					t.Fatalf("cash Store credit not eligible for scoped payout: %+v err=%v", stores, err)
				}
			})
		}
	}
}
