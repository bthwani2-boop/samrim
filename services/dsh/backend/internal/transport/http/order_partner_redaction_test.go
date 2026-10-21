package transporthttp

import (
	"testing"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/contract"
)

func TestPartnerOrderRecipientPrivacy(t *testing.T) {
	original := contract.Order{
		FulfillmentMode: "BTHWANI_CAPTAIN",
		AddressID:       "private-address", AddressVersion: 4,
		AddressText: "private address line", AddressLatitude: 15.3, AddressLongitude: 44.2,
		ServiceabilityAddressVersion: 4,
		Recipient:                    contract.OrderRecipient{Mode: "OTHER", Name: "private recipient", PhoneE164: "+967711111111", Instructions: "private directions"},
	}
	hidden := redactPartnerOrder(original)
	if hidden.AddressID != "" || hidden.AddressVersion != 0 || hidden.AddressText != "" || hidden.AddressLatitude != 0 || hidden.AddressLongitude != 0 || hidden.ServiceabilityAddressVersion != 0 || hidden.Recipient.Name != "" || hidden.Recipient.PhoneE164 != "" || hidden.Recipient.Instructions != "" {
		t.Fatalf("partner response exposed private customer destination: %+v", hidden)
	}
	if original.AddressID != "private-address" || original.Recipient.Name != "private recipient" {
		t.Fatal("redaction mutated the canonical source")
	}
	pickup := original
	pickup.FulfillmentMode = "CUSTOMER_PICKUP"
	pickupResult := redactPartnerOrder(pickup)
	if pickupResult.AddressText != "" || pickupResult.Recipient.Name != original.Recipient.Name {
		t.Fatal("pickup needs no delivery address but retains its pickup recipient")
	}
	ownedDelivery := original
	ownedDelivery.FulfillmentMode = "PARTNER_CAPTAIN"
	result := redactPartnerOrder(ownedDelivery)
	if result.AddressText != ownedDelivery.AddressText || result.Recipient.PhoneE164 != ownedDelivery.Recipient.PhoneE164 {
		t.Fatal("partner courier flow lost required delivery details")
	}
}
