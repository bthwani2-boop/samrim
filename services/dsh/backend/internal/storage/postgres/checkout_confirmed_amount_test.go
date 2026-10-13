package postgres

import "testing"

func TestCheckoutConfirmedTotalPreventsSilentPriceChange(t *testing.T) {
	for _, tc := range []struct {
		name     string
		expected *int64
		actual   int64
		allow    bool
	}{
		{name: "legacy multi-store child without quote", actual: 1200, allow: true},
		{name: "accepted total unchanged", expected: confirmedMinor(1200), actual: 1200, allow: true},
		{name: "price increased", expected: confirmedMinor(1200), actual: 1300},
		{name: "price decreased", expected: confirmedMinor(1200), actual: 1000},
		{name: "explicit zero", expected: confirmedMinor(0), actual: 1200},
		{name: "negative", expected: confirmedMinor(-1), actual: 1200},
		{name: "nonpositive computed", expected: confirmedMinor(0), actual: 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := checkoutTotalMatchesConfirmation(tc.expected, tc.actual); got != tc.allow {
				t.Fatalf("checkoutTotalMatchesConfirmation(%v,%d)=%t want %t", tc.expected, tc.actual, got, tc.allow)
			}
		})
	}
	input := CheckoutInput{ClientActorID: "client", CartID: "cart", StoreID: "store", ExpectedCartVersion: 3}
	legacy := HashCheckoutRequest(input)
	input.ExpectedTotalAmountMinor = confirmedMinor(1200)
	bound := HashCheckoutRequest(input)
	if bound == legacy {
		t.Fatal("accepted quote total must alter checkout idempotency request hash")
	}
	input.ExpectedTotalAmountMinor = confirmedMinor(1300)
	if HashCheckoutRequest(input) == bound {
		t.Fatal("changed accepted total must conflict with original key")
	}
	input.ExpectedTotalAmountMinor = nil
	if HashCheckoutRequest(input) != legacy {
		t.Fatal("legacy replay identity changed")
	}
}

func confirmedMinor(value int64) *int64 { return &value }
