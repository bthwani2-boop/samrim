package postgres

import (
	"github.com/bthwani2-boop/samrim/services/wlt/backend/internal/domain"
	"testing"
)

// All nine payment/fulfillment paths exercise a dedicated real PostgreSQL DB.
// No test may point at the production or normal development database.
func TestPaymentFulfillmentMatrixNineJourneys(t *testing.T) {
	for _, mode := range []string{"BTHWANI_CAPTAIN", "PARTNER_CAPTAIN", "CUSTOMER_PICKUP"} {
		for _, method := range []string{"CASH", "WALLET", "MIXED"} {
			t.Run(mode+"/"+method, func(t *testing.T) {
				s := newFieldAcquisitionScenario(t)
				owner, _, store, _, _, _, _, _, _ := setupPartnerFinanceProof(t, s, false)
				order := "matrix-" + mode + "-" + method + "-" + s.suffix
				customer := "matrix-customer-" + s.suffix
				captain := "matrix-captain-" + s.suffix
				if mode != "BTHWANI_CAPTAIN" {
					store = "matrix-store-" + s.suffix
					a, _, err := ProposeStoreCommercialAgreement(s.ctx, s.db, ProposeStoreCommercialAgreementInput{
						StoreID: store, PartnerActorID: owner,
						Rates:   []StoreCommercialAgreementRate{{FulfillmentMode: mode, CommissionRateBps: 1000}},
						ActorID: "matrix-proposer", Reason: "nine journey isolated test",
						IdempotencyKey: order + "-propose", CorrelationID: order + "-propose-correlation",
					})
					if err != nil {
						t.Fatal(err)
					}
					a, _, err = AcceptStoreCommercialAgreement(s.ctx, s.db, a.AgreementID, a.AgreementVersion, owner, "accepted for matrix", order+"-accept", order+"-accept-correlation")
					if err != nil {
						t.Fatal(err)
					}
					_, _, err = DecideStoreCommercialAgreement(s.ctx, s.db, StoreCommercialAgreementDecisionInput{
						AgreementID: a.AgreementID, ExpectedVersion: a.AgreementVersion, Decision: "APPROVE",
						ActorID: "matrix-approver", CurrentStorePartnerActorID: owner,
						CurrentFulfillmentModes: []string{mode}, Reason: "approved for isolated test",
						IdempotencyKey: order + "-approve", CorrelationID: order + "-approve-correlation",
					})
					if err != nil {
						t.Fatal(err)
					}
				}
				fee := int64(0)
				if mode == "BTHWANI_CAPTAIN" {
					fee = 500
				}
				if mode == "PARTNER_CAPTAIN" {
					fee = 250
				}
				total := int64(5000) + fee
				walletMinor := int64(0)
				if method == "WALLET" {
					walletMinor = total
				}
				if method == "MIXED" {
					walletMinor = total / 2
				}
				cashMinor := total - walletMinor
				fund := func(kind, actor string, amount int64) {
					t.Helper()
					if amount == 0 {
						return
					}
					f, replay, err := CreateCashInFundingIntent(s.ctx, s.db, CreateCashInFundingIntentInput{
						ActorType: kind, ActorID: actor, AmountMinor: amount, Currency: "YER",
						ProviderKey:    DevelopmentSimulatorProvider,
						IdempotencyKey: order + "-fund-" + kind, CorrelationID: order + "-fund-" + kind + "-correlation",
					})
					if err != nil || replay {
						t.Fatalf("fund intent: err=%v replay=%t", err, replay)
					}
					r, replay, err := ApplyCashInFundingResult(s.ctx, s.db, ApplyCashInFundingResultInput{
						FundingIntentID: f.ID, Outcome: "SUCCESS", ActorID: "matrix-test-provider",
						ProviderTransactionReference: order + "-provider-" + kind,
						IdempotencyKey:               order + "-credit-" + kind, CorrelationID: order + "-credit-" + kind + "-correlation",
					})
					if err != nil || replay || r.State != "SETTLED" {
						t.Fatalf("fund settled: state=%s err=%v replay=%t", r.State, err, replay)
					}
				}
				fund("customer", customer, walletMinor)
				if mode == "BTHWANI_CAPTAIN" && cashMinor > 0 {
					fund("captain", captain, 20000)
				}
				paymentMethod := domain.MethodCashAtStore
				if mode == "BTHWANI_CAPTAIN" {
					paymentMethod = domain.MethodCashOnDelivery
				}
				p, replay, err := CreatePaymentIntent(s.ctx, s.db, CreatePaymentIntentInput{
					ExternalReference: order + "-ref", PayerActorID: customer, OrderID: order,
					AmountMinor: cashMinor, Currency: "YER", Method: paymentMethod,
					CustomerPaymentAllocation: &CustomerPaymentAllocationInput{
						OrderID: order, StoreID: store, PartnerActorID: owner,
						CommercialStoreTypeID: "finance-type", FulfillmentMode: mode, Currency: "YER",
						SubtotalMinor: 5000, DeliveryFeeMinor: fee, InternalBalanceAmountMinor: walletMinor,
						CashAmountMinor: cashMinor, CustomerPayableMinor: total, PolicyVersion: "matrix-proof-v1",
					},
					IdempotencyKey: order + "-create", CorrelationID: order + "-create-correlation",
				})
				if err != nil || replay {
					t.Fatalf("create: err=%v replay=%t", err, replay)
				}
				cod := CaptainCODReservationInput{OrderID: order, PaymentIntentID: p.ID, CaptainActorID: captain,
					IdempotencyKey: order + "-reserve", CorrelationID: order + "-reserve-correlation"}
				if mode == "BTHWANI_CAPTAIN" && cashMinor > 0 {
					hold, replayed, err := ReserveCaptainCOD(s.ctx, s.db, cod)
					if err != nil || replayed || hold.State != "ACTIVE" || hold.AmountMinor != cashMinor {
						t.Fatalf("COD hold: %+v replay=%t err=%v", hold, replayed, err)
					}
				}
				collector := ""
				reference := ""
				if cashMinor > 0 {
					collector = owner
					if mode == "BTHWANI_CAPTAIN" {
						collector = captain
					}
					reference = order + "-cash"
				}
				p, replay, err = CollectPaymentIntent(s.ctx, s.db, CollectPaymentIntentInput{
					IntentID: p.ID, CollectedAmountMinor: cashMinor, CollectedByActorID: collector,
					CollectionReference: reference, ExpectedVersion: p.Version,
					IdempotencyKey: order + "-collect", CorrelationID: order + "-collect-correlation",
				})
				if err != nil || replay || p.State != "COLLECTED" {
					t.Fatalf("collect: %+v replay=%t err=%v", p, replay, err)
				}
				if mode == "BTHWANI_CAPTAIN" {
					earningInput := FinalizePartnerOrderEarningInput{OrderID: order, PaymentIntentID: p.ID,
						PartnerActorID: owner, CaptainActorID: captain, IdempotencyKey: order + "-earning",
						CorrelationID: order + "-earning-correlation"}
					earning, replayed, err := FinalizePartnerOrderEarning(s.ctx, s.db, earningInput)
					if err != nil || replayed || earning.DeliveryFeeMinor != fee {
						t.Fatalf("earn: %+v err=%v", earning, err)
					}
					if _, replayed, err = FinalizePartnerOrderEarning(s.ctx, s.db, earningInput); err != nil || !replayed {
						t.Fatalf("duplicate earning: replay=%t err=%v", replayed, err)
					}
					if cashMinor > 0 {
						cod.IdempotencyKey = order + "-finalize"
						cod.CorrelationID = order + "-finalize-correlation"
						closed, replayed, err := FinalizeCaptainCOD(s.ctx, s.db, cod)
						if err != nil || replayed || closed.State != "DEBITED" {
							t.Fatalf("COD debit: %+v err=%v", closed, err)
						}
						if _, replayed, err = FinalizeCaptainCOD(s.ctx, s.db, cod); err != nil || !replayed {
							t.Fatalf("duplicate COD: replay=%t err=%v", replayed, err)
						}
					}
					wallet, err := ReadCaptainWalletState(s.ctx, s.db, captain)
					expected := fee
					if cashMinor > 0 {
						expected += 20000 - cashMinor
					}
					if err != nil || wallet.LedgerBalanceMinor != expected || wallet.HeldMinor != 0 {
						t.Fatalf("captain ledger=%+v expected=%d err=%v", wallet, expected, err)
					}
					liability, err := ListCashLiability(s.ctx, s.db, captain, 25)
					if err != nil || liability.TotalAmountMinor != 0 {
						t.Fatalf("unclosed COD %+v err=%v", liability, err)
					}
				} else {
					input := PartnerStoreCashCommissionInput{OrderID: order, PaymentIntentID: p.ID,
						PartnerActorID: owner, FulfillmentMode: mode, IdempotencyKey: order + "-commission",
						CorrelationID: order + "-commission-correlation"}
					item, replayed, err := RecordPartnerStoreCashCommission(s.ctx, s.db, input)
					if err != nil || replayed || item.FulfillmentMode != mode {
						t.Fatalf("store commission: %+v err=%v", item, err)
					}
					if _, replayed, err = RecordPartnerStoreCashCommission(s.ctx, s.db, input); err != nil || !replayed {
						t.Fatalf("duplicate store commission replay=%t err=%v", replayed, err)
					}
				}
				expectedHolds := 0
				if mode == "BTHWANI_CAPTAIN" && cashMinor > 0 {
					expectedHolds = 1
				}
				var actualHolds int
				if err := s.db.QueryRowContext(s.ctx, "SELECT COUNT(*) FROM wlt.captain_cod_reservations WHERE order_id=$1", order).Scan(&actualHolds); err != nil || actualHolds != expectedHolds {
					t.Fatalf("COD reservations=%d want=%d err=%v", actualHolds, expectedHolds, err)
				}
				var badTransactions int
				query := "SELECT COUNT(*) FROM (SELECT t.id FROM wlt.ledger_transactions t LEFT JOIN wlt.ledger_entries e ON e.transaction_id=t.id WHERE t.source_id=$1 OR t.source_id IN (SELECT id FROM wlt.captain_cod_reservations WHERE order_id=$1) GROUP BY t.id HAVING COALESCE(SUM(CASE WHEN e.direction='DEBIT' THEN e.amount_minor ELSE -e.amount_minor END),0)<>0) bad"
				if err := s.db.QueryRowContext(s.ctx, query, order).Scan(&badTransactions); err != nil || badTransactions != 0 {
					t.Fatalf("unbalanced transactions=%d err=%v", badTransactions, err)
				}
			})
		}
	}
}
