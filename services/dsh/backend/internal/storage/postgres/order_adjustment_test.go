package postgres

import "testing"

func TestOrderAdjustmentDecisionHashBindsCustomerActor(t *testing.T) {
	first := HashOrderAdjustmentDecision("order-1", "adjustment-1", "customer-1", "ACCEPT", 4, 1)
	otherCustomer := HashOrderAdjustmentDecision("order-1", "adjustment-1", "customer-2", "ACCEPT", 4, 1)
	if first == otherCustomer {
		t.Fatal("decision idempotency hash must include the customer identity to prevent cross-customer replay")
	}
}
