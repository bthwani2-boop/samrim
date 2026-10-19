package postgres

import "testing"

func TestPickupNoShowCandidateIsReadyUnpaidCashAtStorePickup(t *testing.T) {
	paymentIntentID := "payment-intent"
	base := OrderRecord{
		State:           "READY_FOR_PICKUP",
		FulfillmentMode: FulfillmentModeCustomerPickup,
		PaymentMethod:   "CASH_AT_STORE",
		PaymentState:    "REQUIRES_COLLECTION",
		PaymentIntentID: &paymentIntentID,
	}

	tests := []struct {
		name   string
		mutate func(*OrderRecord)
		want   bool
	}{
		{name: "eligible order", want: true},
		{name: "not ready", mutate: func(order *OrderRecord) { order.State = "PREPARING" }},
		{name: "delivery order", mutate: func(order *OrderRecord) { order.FulfillmentMode = FulfillmentModeBthwaniCaptain }},
		{name: "non cash at store", mutate: func(order *OrderRecord) { order.PaymentMethod = "CARD" }},
		{name: "already collected", mutate: func(order *OrderRecord) { order.PaymentState = "COLLECTED" }},
		{name: "missing payment intent", mutate: func(order *OrderRecord) { order.PaymentIntentID = nil }},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			order := base
			if test.mutate != nil {
				test.mutate(&order)
			}
			if got := isPickupNoShowCandidate(order); got != test.want {
				t.Fatalf("isPickupNoShowCandidate() = %t, want %t", got, test.want)
			}
		})
	}
}
