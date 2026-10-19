package postgres

import "testing"

func TestPartnerStoreCashCommissionMode(t *testing.T) {
	tests := []struct {
		mode string
		want bool
	}{
		{mode: "CUSTOMER_PICKUP", want: true},
		{mode: "PARTNER_CAPTAIN", want: true},
		{mode: "", want: false},
		{mode: "PARTNER_DELIVERY", want: false},
		{mode: "partner_captain", want: false},
	}

	for _, test := range tests {
		t.Run(test.mode, func(t *testing.T) {
			if got := isPartnerStoreCashCommissionMode(test.mode); got != test.want {
				t.Fatalf("isPartnerStoreCashCommissionMode(%q) = %t, want %t", test.mode, got, test.want)
			}
		})
	}
}

func TestPartnerStoreCashCommissionHashPreservesPickupReplayAndBindsMode(t *testing.T) {
	input := PartnerStoreCashCommissionInput{
		OrderID:         " order-1 ",
		PaymentIntentID: " payment-1 ",
		PartnerActorID:  " partner-1 ",
		FulfillmentMode: "CUSTOMER_PICKUP",
	}

	gotPickup := HashPartnerStoreCashCommission(input)
	wantLegacyPickup := hashFacts("partner-store-pickup-commission", "order-1", "payment-1", "partner-1")
	if gotPickup != wantLegacyPickup {
		t.Fatalf("pickup request hash = %q, want legacy replay hash %q", gotPickup, wantLegacyPickup)
	}

	input.FulfillmentMode = "PARTNER_CAPTAIN"
	gotPartnerCaptain := HashPartnerStoreCashCommission(input)
	if gotPartnerCaptain == gotPickup {
		t.Fatal("Partner Captain request hash must be distinct from pickup")
	}
	if gotPartnerCaptain != hashFacts("partner-store-cash-commission", "order-1", "payment-1", "partner-1", "PARTNER_CAPTAIN") {
		t.Fatal("Partner Captain request hash must bind the fulfillment mode")
	}
}
