package postgres

import (
	"context"
	"database/sql"
	"errors"
	"testing"

	"github.com/bthwani2-boop/samrim/services/wlt/backend/internal/domain"
)

// Every allocated WLT payment must be attached to the exact canonical order.
// Invalid requests are rejected before even opening a DB transaction.
func TestCreatePaymentIntentRejectsDetachedOrForeignOrderAllocation(t *testing.T) {
	scenarios := []struct {
		name, mode, method, orderID, allocatedOrderID string
		withAllocation                                bool
	}{
		{"captain missing order reference", "BTHWANI_CAPTAIN", domain.MethodCashOnDelivery, "", "canonical-order", true},
		{"captain foreign order reference", "BTHWANI_CAPTAIN", domain.MethodCashOnDelivery, "other-order", "canonical-order", true},
		{"pickup missing order reference", "CUSTOMER_PICKUP", domain.MethodCashAtStore, "", "canonical-order", true},
		{"pickup foreign order reference", "CUSTOMER_PICKUP", domain.MethodCashAtStore, "other-order", "canonical-order", true},
		{"partner delivery missing order reference", "PARTNER_CAPTAIN", domain.MethodCashAtStore, "", "canonical-order", true},
		{"partner delivery foreign order reference", "PARTNER_CAPTAIN", domain.MethodCashAtStore, "other-order", "canonical-order", true},
		{"order reference without allocation", "BTHWANI_CAPTAIN", domain.MethodCashOnDelivery, "canonical-order", "", false},
	}
	for _, tc := range scenarios {
		t.Run(tc.name, func(t *testing.T) {
			input := CreatePaymentIntentInput{
				ExternalReference: "detached-payment-intent", PayerActorID: "payer",
				OrderID: tc.orderID, AmountMinor: 1500, Currency: "YER",
				Method: tc.method, IdempotencyKey: "detached-payment-key",
				CorrelationID: "detached-payment-correlation",
			}
			if tc.withAllocation {
				input.CustomerPaymentAllocation = &CustomerPaymentAllocationInput{
					OrderID: tc.allocatedOrderID, StoreID: "store", PartnerActorID: "partner",
					CommercialStoreTypeID: "store-type", FulfillmentMode: tc.mode,
					Currency: "YER", SubtotalMinor: 1500, CashAmountMinor: 1500,
					CustomerPayableMinor: 1500, PolicyVersion: "v1",
				}
			}
			// No driver or live connection is used: invalid facts must fail
			// validation before entering the transaction path.
			_, _, err := CreatePaymentIntent(context.Background(), &sql.DB{}, input)
			if !errors.Is(err, ErrInvalidInput) {
				t.Fatalf("detached allocation was accepted or reached storage: %v", err)
			}
		})
	}
}
