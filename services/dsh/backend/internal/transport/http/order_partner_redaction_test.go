package transporthttp

import (
	"testing"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/contract"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
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
func TestPartnerOrderDetailDoesNotExposePlatformDeliveryDestination(t *testing.T) {
	name, phone, instructions := "private recipient", "+967711111111", "private directions"
	item := postgres.OrderRecord{
		ID:                           "order-private-destination",
		FulfillmentMode:              "BTHWANI_CAPTAIN",
		AddressID:                    "private-address",
		AddressVersion:               4,
		AddressText:                  "private address line",
		AddressLatitude:              15.3,
		AddressLongitude:             44.2,
		ServiceabilityAddressVersion: 4,
		Recipient: postgres.DeliveryRecipientRecord{
			Mode: "OTHER", Name: &name, PhoneE164: &phone, Instructions: &instructions,
		},
	}

	// The order detail route uses this mapper, hiding the platform destination from
	// Partners while retaining the Client view.
	got := toOrderForRole(item, "partner")
	if got.AddressID != "" || got.AddressVersion != 0 || got.AddressText != "" || got.AddressLatitude != 0 || got.AddressLongitude != 0 || got.ServiceabilityAddressVersion != 0 || got.Recipient.Name != "" || got.Recipient.PhoneE164 != "" || got.Recipient.Instructions != "" {
		t.Fatalf("partner order detail exposed platform-delivery destination: %+v", got)
	}
}
func TestOrderDetailRoleMappingPreservesAuthorizedDestinations(t *testing.T) {
	name, phone := "recipient", "+967711111111"
	item := postgres.OrderRecord{
		FulfillmentMode: "BTHWANI_CAPTAIN",
		AddressText:     "private address",
		Recipient:       postgres.DeliveryRecipientRecord{Mode: "OTHER", Name: &name, PhoneE164: &phone},
	}
	client := toOrderForRole(item, "client")
	if client.AddressText != item.AddressText || client.Recipient.PhoneE164 != phone {
		t.Fatalf("client order detail lost its own delivery destination: %+v", client)
	}

	item.FulfillmentMode = "PARTNER_CAPTAIN"
	partnerDelivery := toOrderForRole(item, "partner")
	if partnerDelivery.AddressText != item.AddressText || partnerDelivery.Recipient.PhoneE164 != phone {
		t.Fatalf("partner delivery flow lost required destination: %+v", partnerDelivery)
	}
	unknown := toOrderForRole(item, "unknown")
	if unknown.ID != "" || unknown.AddressText != "" || unknown.Recipient.PhoneE164 != "" {
		t.Fatalf("unknown order audience must not receive an order: %+v", unknown)
	}
}
