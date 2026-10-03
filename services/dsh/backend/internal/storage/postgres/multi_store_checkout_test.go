package postgres

import (
	"encoding/json"
	"testing"
)

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

func TestMultiStoreCheckoutRecipientHashPreservesLegacySelfReplay(t *testing.T) {
	type legacyChild struct {
		CartID          string
		StoreID         string
		AddressID       string
		CartVersion     int
		FulfillmentMode string
		PromotionCode   string
	}
	legacyPayload := struct {
		ID            string        `json:"id"`
		ClientActorID string        `json:"clientActorId"`
		Children      []legacyChild `json:"children"`
	}{ID: "multi-1", ClientActorID: "client-1", Children: []legacyChild{{CartID: "cart-a", StoreID: "store-a", AddressID: "address-a", CartVersion: 1, FulfillmentMode: "BTHWANI_CAPTAIN"}, {CartID: "cart-b", StoreID: "store-b", AddressID: "address-b", CartVersion: 2, FulfillmentMode: "PARTNER_CAPTAIN"}}}
	legacyJSON, err := json.Marshal(legacyPayload)
	if err != nil {
		t.Fatalf("marshal legacy multi-store identity: %v", err)
	}
	legacyHash := HashMarketingFacts(string(legacyJSON))
	input := MultiStoreCheckoutInput{ID: "multi-1", ClientActorID: "client-1", Children: []MultiStoreCheckoutChildInput{
		{CartID: "cart-a", StoreID: "store-a", AddressID: "address-a", CartVersion: 1, FulfillmentMode: "BTHWANI_CAPTAIN", Recipient: DeliveryRecipientInput{Mode: "SELF"}},
		{CartID: "cart-b", StoreID: "store-b", AddressID: "address-b", CartVersion: 2, FulfillmentMode: "PARTNER_CAPTAIN", Recipient: DeliveryRecipientInput{Mode: "SELF"}},
	}}
	if got := HashMultiStoreCheckoutRequest(input); got != legacyHash {
		t.Fatal("SELF recipient changed the legacy multi-store idempotency identity")
	}
	input.Children[0].Recipient = DeliveryRecipientInput{Mode: "OTHER", Name: "Ali", PhoneE164: "+967712345678"}
	otherHash := HashMultiStoreCheckoutRequest(input)
	if otherHash == legacyHash {
		t.Fatal("alternate recipient was not bound to the multi-store idempotency identity")
	}
	input.Children[0].Recipient.Name = "Different recipient"
	if HashMultiStoreCheckoutRequest(input) == otherHash {
		t.Fatal("changed alternate recipient retained the same multi-store idempotency identity")
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
