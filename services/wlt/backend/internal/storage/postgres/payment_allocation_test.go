package postgres

import "testing"

func validCustomerPaymentAllocation() CustomerPaymentAllocationInput {
	return CustomerPaymentAllocationInput{OrderID: "o", StoreID: "s", PartnerActorID: "p", FulfillmentMode: "BTHWANI_CAPTAIN", Currency: "YER", SubtotalMinor: 4200, CashAmountMinor: 4200, CustomerPayableMinor: 4200, PolicyVersion: "v2"}
}
func TestCustomerPaymentAllocation(t *testing.T) {
	i := validCustomerPaymentAllocation()
	if validateCustomerPaymentAllocation(i) != nil {
		t.Fatal("valid rejected")
	}
	i.InternalBalanceAmountMinor = 1200
	i.CashAmountMinor = 3000
	if validateCustomerPaymentAllocation(i) != nil {
		t.Fatal("mixed rejected")
	}
	i.CashAmountMinor = 2999
	if validateCustomerPaymentAllocation(i) != ErrCustomerPaymentAllocationInvalidInput {
		t.Fatal("invalid accepted")
	}
}

func TestCustomerPaymentAllocationRequiresCanonicalStoreModeFacts(t *testing.T) {
	i := validCustomerPaymentAllocation()
	i.FulfillmentMode = "UNSUPPORTED"
	if validateCustomerPaymentAllocation(i) != ErrCustomerPaymentAllocationInvalidInput {
		t.Fatal("unsupported fulfillment mode accepted")
	}

	for _, mode := range []string{"PARTNER_CAPTAIN", "CUSTOMER_PICKUP"} {
		t.Run(mode, func(t *testing.T) {
			allocation := validCustomerPaymentAllocation()
			allocation.FulfillmentMode = mode
			if err := validateCustomerPaymentAllocation(allocation); err != nil {
				t.Fatalf("valid store-collected allocation rejected: %v", err)
			}
			allocation.DeliveryFeeMinor = 50
			if validateCustomerPaymentAllocation(allocation) != ErrCustomerPaymentAllocationInvalidInput {
				t.Fatal("store fulfillment accepted a delivery fee")
			}
		})
	}
}

func TestCustomerPaymentAllocationHashBindsStoreAndFulfillment(t *testing.T) {
	base := CreatePaymentIntentInput{ExternalReference: "ext", PayerActorID: "client", OrderID: "order", AmountMinor: 4200, Currency: "YER", Method: "CASH_ON_DELIVERY", CustomerPaymentAllocation: ptrCustomerPaymentAllocation(validCustomerPaymentAllocation())}
	baseHash := HashCreateRequest(base)

	changedStore := base
	changedStore.CustomerPaymentAllocation = ptrCustomerPaymentAllocation(validCustomerPaymentAllocation())
	changedStore.CustomerPaymentAllocation.StoreID = "other-store"
	if HashCreateRequest(changedStore) == baseHash {
		t.Fatal("request hash did not bind the Store ID")
	}

	changedMode := base
	changedMode.CustomerPaymentAllocation = ptrCustomerPaymentAllocation(validCustomerPaymentAllocation())
	changedMode.CustomerPaymentAllocation.FulfillmentMode = "PARTNER_CAPTAIN"
	if HashCreateRequest(changedMode) == baseHash {
		t.Fatal("request hash did not bind the fulfillment mode")
	}
}

func ptrCustomerPaymentAllocation(value CustomerPaymentAllocationInput) *CustomerPaymentAllocationInput {
	return &value
}
