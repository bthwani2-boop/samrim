package postgres

import "testing"

func TestValidateMultiStoreCheckoutChildrenSupportsCustomerFulfillmentModes(t *testing.T) {
	for _, fulfillmentMode := range []string{"BTHWANI_CAPTAIN", "PARTNER_CAPTAIN"} {
		t.Run(fulfillmentMode, func(t *testing.T) {
			children := []MultiStoreCheckoutChildInput{
				{CartID: "cart-a", StoreID: "store-a", AddressID: "address-a", CartVersion: 1, FulfillmentMode: fulfillmentMode},
				{CartID: "cart-b", StoreID: "store-b", AddressID: "address-b", CartVersion: 1, FulfillmentMode: fulfillmentMode},
			}
			if err := validateMultiStoreCheckoutChildren(children); err != nil {
				t.Fatalf("valid delivery fulfillment mode rejected: %v", err)
			}
		})
	}
	children := []MultiStoreCheckoutChildInput{
		{CartID: "cart-a", StoreID: "store-a", CartVersion: 1, FulfillmentMode: "CUSTOMER_PICKUP"},
		{CartID: "cart-b", StoreID: "store-b", CartVersion: 1, FulfillmentMode: "CUSTOMER_PICKUP"},
	}
	if err := validateMultiStoreCheckoutChildren(children); err != nil {
		t.Fatalf("valid pickup fulfillment mode rejected: %v", err)
	}
}

func TestValidateMultiStoreCheckoutChildrenRejectsInvalidFulfillmentFacts(t *testing.T) {
	base := []MultiStoreCheckoutChildInput{
		{CartID: "cart-a", StoreID: "store-a", AddressID: "address-a", CartVersion: 1, FulfillmentMode: "PARTNER_CAPTAIN"},
		{CartID: "cart-b", StoreID: "store-b", AddressID: "address-b", CartVersion: 1, FulfillmentMode: "BTHWANI_CAPTAIN"},
	}
	tests := map[string]func([]MultiStoreCheckoutChildInput) []MultiStoreCheckoutChildInput{
		"missing delivery address": func(children []MultiStoreCheckoutChildInput) []MultiStoreCheckoutChildInput {
			children[0].AddressID = ""
			return children
		},
		"pickup with address": func(children []MultiStoreCheckoutChildInput) []MultiStoreCheckoutChildInput {
			children[0].FulfillmentMode = "CUSTOMER_PICKUP"
			return children
		},
		"unsupported mode": func(children []MultiStoreCheckoutChildInput) []MultiStoreCheckoutChildInput {
			children[0].FulfillmentMode = "UNKNOWN"
			return children
		},
		"duplicate cart": func(children []MultiStoreCheckoutChildInput) []MultiStoreCheckoutChildInput {
			children[1].CartID = children[0].CartID
			return children
		},
		"duplicate store": func(children []MultiStoreCheckoutChildInput) []MultiStoreCheckoutChildInput {
			children[1].StoreID = children[0].StoreID
			return children
		},
	}
	for name, mutate := range tests {
		t.Run(name, func(t *testing.T) {
			children := mutate(append([]MultiStoreCheckoutChildInput(nil), base...))
			if err := validateMultiStoreCheckoutChildren(children); err == nil {
				t.Fatal("invalid checkout child facts were accepted")
			}
		})
	}
}
