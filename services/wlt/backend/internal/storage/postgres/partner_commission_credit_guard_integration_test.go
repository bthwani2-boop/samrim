package postgres

import (
	"errors"
	"testing"

	"github.com/bthwani2-boop/samrim/services/wlt/backend/internal/domain"
)

func TestPartnerCommissionCreditGuardBlocksDebtAndCountsPendingCashOrders(t *testing.T) {
	s := newFieldAcquisitionScenario(t)
	owner, _, _, _, _, _, _, _, earn := setupPartnerFinanceProof(t, s, false)
	store := "credit-limited-store-" + s.suffix
	earn(store, "CUSTOMER_PICKUP", 1000) // Ledger commission receivable: 100 YER
	if _, err := s.db.ExecContext(s.ctx, `UPDATE wlt.partner_commission_credit_policies
 SET maximum_receivable_minor=150,maximum_age_days=7 WHERE partner_actor_id='platform-default'`); err != nil {
		t.Fatal(err)
	}
	request := func(label string) (PaymentIntentRecord, bool, error) {
		return CreatePaymentIntent(s.ctx, s.db, CreatePaymentIntentInput{
			ExternalReference: store + "-" + label + "-payment",
			PayerActorID:      "credit-test-customer-" + s.suffix,
			OrderID:           store + "-" + label + "-order", AmountMinor: 1000,
			Currency: "YER", Method: domain.MethodCashAtStore,
			CustomerPaymentAllocation: &CustomerPaymentAllocationInput{
				OrderID: store + "-" + label + "-order", StoreID: store, PartnerActorID: owner,
				CommercialStoreTypeID: "finance-type", FulfillmentMode: "CUSTOMER_PICKUP",
				Currency: "YER", SubtotalMinor: 1000, CashAmountMinor: 1000,
				CustomerPayableMinor: 1000, PolicyVersion: "credit-risk-proof",
			}, IdempotencyKey: store + "-" + label + "-key",
			CorrelationID: store + "-" + label + "-correlation",
		})
	}
	if _, _, err := request("blocked"); !errors.Is(err, ErrPartnerCommissionCreditExceeded) {
		t.Fatalf("new cash order exceeds 150YER cap against 100YER outstanding: %v", err)
	}
	if _, err := s.db.ExecContext(s.ctx, `UPDATE wlt.partner_commission_credit_policies
 SET maximum_receivable_minor=200 WHERE partner_actor_id='platform-default'`); err != nil {
		t.Fatal(err)
	}
	first, replay, err := request("first")
	if err != nil || replay || first.ID == "" {
		t.Fatalf("eligible 200YER exposure should succeed: %+v replay=%v err=%v", first, replay, err)
	}
	again, replayed, err := request("first")
	if err != nil || !replayed || again.ID != first.ID {
		t.Fatalf("idempotent retry must not consume additional credit: %+v replay=%v err=%v", again, replayed, err)
	}
	if _, _, err := request("second"); !errors.Is(err, ErrPartnerCommissionCreditExceeded) {
		t.Fatalf("pending cash order must count alongside ledger receivable: %v", err)
	}
}
