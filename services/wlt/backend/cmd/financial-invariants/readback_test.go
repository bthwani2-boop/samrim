package main

import "testing"

func validDeliveryReadback() deliveryHandoffReadback {
	return deliveryHandoffReadback{
		OrderID: "order-1", PaymentIntentID: "payment-1", CaptainActorID: "captain-1", PartnerActorID: "partner-1", CashAmountMinor: 800,
		OrderFound: true, OrderPaymentIntentID: "payment-1", OrderCashAmountMinor: 800,
		PaymentFound: true, PaymentState: "COLLECTED", PaymentAmountMinor: 800, CollectedByActorID: "captain-1",
		EarningFound: true, EarningPaymentIntentID: "payment-1", EarningPartnerActorID: "partner-1", EarningCaptainActorID: "captain-1",
		CODReservationFound: true, CODPaymentIntentID: "payment-1", CODCaptainActorID: "captain-1", CODAmountMinor: 800, CODState: "FINALIZED",
	}
}

func TestDeliveryHandoffReadback(t *testing.T) {
	tests := []struct {
		name   string
		change func(*deliveryHandoffReadback)
		valid  bool
	}{
		{name: "positive cash finalized", valid: true},
		{name: "positive cash remitted", change: func(r *deliveryHandoffReadback) { r.CODState = "REMITTED" }, valid: true},
		{name: "zero cash without COD reservation", change: func(r *deliveryHandoffReadback) {
			r.CashAmountMinor = 0
			r.OrderCashAmountMinor = 0
			r.PaymentAmountMinor = 0
			r.CollectedByActorID = ""
			r.CollectorIsNull = true
			r.CODReservationFound = false
		}, valid: true},
		{name: "mixed balance and cash compares cash amount", change: func(r *deliveryHandoffReadback) {
			r.CashAmountMinor = 300
			r.OrderCashAmountMinor = 300
			r.PaymentAmountMinor = 300
			r.CODAmountMinor = 300
		}, valid: true},
		{name: "wrong captain", change: func(r *deliveryHandoffReadback) { r.CollectedByActorID = "captain-2" }, valid: false},
		{name: "wrong payment intent", change: func(r *deliveryHandoffReadback) { r.EarningPaymentIntentID = "payment-2" }, valid: false},
		{name: "wrong amount", change: func(r *deliveryHandoffReadback) { r.PaymentAmountMinor++ }, valid: false},
		{name: "negative cash allocation", change: func(r *deliveryHandoffReadback) { r.CashAmountMinor = -1 }, valid: false},
		{name: "active COD reservation", change: func(r *deliveryHandoffReadback) { r.CODState = "ACTIVE" }, valid: false},
		{name: "missing earning", change: func(r *deliveryHandoffReadback) { r.EarningFound = false }, valid: false},
		{name: "zero cash with collector", change: func(r *deliveryHandoffReadback) {
			r.CashAmountMinor = 0
			r.OrderCashAmountMinor = 0
			r.PaymentAmountMinor = 0
		}, valid: false},
		{name: "zero cash with non-null empty collector", change: func(r *deliveryHandoffReadback) {
			r.CashAmountMinor = 0
			r.OrderCashAmountMinor = 0
			r.PaymentAmountMinor = 0
			r.CollectedByActorID = ""
		}, valid: false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			readback := validDeliveryReadback()
			if tt.change != nil {
				tt.change(&readback)
			}
			got := readback.violations()
			if tt.valid && len(got) != 0 {
				t.Fatalf("unexpected violations: %v", got)
			}
			if !tt.valid && len(got) == 0 {
				t.Fatal("expected a readback violation")
			}
		})
	}
}

func validStoreCashReadback(effect string, cash int64, collector string) storeCashHandoffReadback {
	fulfillment := "CUSTOMER_PICKUP"
	captain := ""
	if effect != "STORE_PICKUP_COLLECTION" {
		fulfillment = "PARTNER_CAPTAIN"
	}
	if effect == "PARTNER_CAPTAIN_STORE_CASH_COLLECTION" {
		captain = "captain-1"
	}
	return storeCashHandoffReadback{
		EffectType: effect, OrderID: "order-1", PaymentIntentID: "payment-1", PartnerActorID: "partner-1", CaptainActorID: captain, CashAmountMinor: cash,
		OrderFound: true, OrderPaymentIntentID: "payment-1", OrderCashAmountMinor: cash,
		PaymentFound: true, PaymentState: "COLLECTED", PaymentMethod: "CASH_AT_STORE", PaymentAmountMinor: cash, CollectedByActorID: collector,
		CollectorIsNull: collector == "",
		CommissionFound: true, CommissionPaymentIntent: "payment-1", CommissionPartnerActor: "partner-1", CommissionFulfillment: fulfillment,
	}
}

func TestStoreCashHandoffReadback(t *testing.T) {
	tests := []struct {
		name  string
		read  storeCashHandoffReadback
		valid bool
	}{
		{name: "zero cash store pickup", read: validStoreCashReadback("STORE_PICKUP_COLLECTION", 0, ""), valid: true},
		{name: "positive cash store pickup", read: validStoreCashReadback("STORE_PICKUP_COLLECTION", 500, "partner-1"), valid: true},
		{name: "partner captain balance settlement", read: validStoreCashReadback("PARTNER_CAPTAIN_BALANCE_SETTLEMENT", 0, ""), valid: true},
		{name: "positive partner captain cash", read: validStoreCashReadback("PARTNER_CAPTAIN_STORE_CASH_COLLECTION", 500, "partner-1"), valid: true},
		{name: "zero cash has collector", read: func() storeCashHandoffReadback {
			r := validStoreCashReadback("STORE_PICKUP_COLLECTION", 0, "partner-1")
			r.CollectorIsNull = false
			return r
		}(), valid: false},
		{name: "zero cash has non-null empty collector", read: func() storeCashHandoffReadback {
			r := validStoreCashReadback("STORE_PICKUP_COLLECTION", 0, "")
			r.CollectorIsNull = false
			return r
		}(), valid: false},
		{name: "wrong partner", read: func() storeCashHandoffReadback {
			r := validStoreCashReadback("STORE_PICKUP_COLLECTION", 500, "partner-1")
			r.CommissionPartnerActor = "partner-2"
			return r
		}(), valid: false},
		{name: "wrong payment intent", read: func() storeCashHandoffReadback {
			r := validStoreCashReadback("STORE_PICKUP_COLLECTION", 500, "partner-1")
			r.CommissionPaymentIntent = "payment-2"
			return r
		}(), valid: false},
		{name: "wrong amount", read: func() storeCashHandoffReadback {
			r := validStoreCashReadback("STORE_PICKUP_COLLECTION", 500, "partner-1")
			r.PaymentAmountMinor++
			return r
		}(), valid: false},
		{name: "negative cash allocation", read: validStoreCashReadback("STORE_PICKUP_COLLECTION", -1, ""), valid: false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := tt.read.violations()
			if tt.valid && len(got) != 0 {
				t.Fatalf("unexpected violations: %v", got)
			}
			if !tt.valid && len(got) == 0 {
				t.Fatal("expected a readback violation")
			}
		})
	}
}
