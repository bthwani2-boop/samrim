package customercart

import (
	"math"
	"net/http/httptest"
	"testing"
)

func testEstimateCart(price string, quantity int64, available bool) Snapshot {
	return Snapshot{
		ActorID: "customer-a", StoreID: "store-a", Version: 3,
		Lines: []Line{{OfferID: "offer-a", VariantID: "variant-a", Quantity: quantity,
			PreviewUnitYER: price, PreviewAvailable: available}},
	}
}
func TestEstimateExactYERAndNeverClaimsCheckoutReady(t *testing.T) {
	snapshot := testEstimateCart("1200", 3, true)
	snapshot.Lines = append(snapshot.Lines, Line{
		OfferID: "offer-b", VariantID: "variant-b", Quantity: 2,
		PreviewUnitYER: "155", PreviewAvailable: true,
	})
	amount, reason := estimateFromSnapshot(snapshot)
	if reason != "" || amount.MerchandiseSubtotalYER != "3910" || amount.CheckoutReady ||
		len(amount.Lines) != 2 || amount.Lines[0].LineTotalYER != "3600" ||
		amount.Lines[1].LineTotalYER != "310" || amount.CartVersion != 3 {
		t.Fatalf("invalid canonical merchandise preview: %#v %s", amount, reason)
	}
}
func TestEstimateFailsClosedOnUnavailableAndOverflow(t *testing.T) {
	cases := []struct {
		name string
		cart Snapshot
		code string
	}{
		{"no lines", Snapshot{Version: 0, Lines: []Line{}}, "CART_EMPTY_OR_TOO_LARGE"},
		{"unavailable", testEstimateCart("550", 1, false), "CART_LINE_UNAVAILABLE"},
		{"invalid amount", testEstimateCart("not-a-price", 1, true), "CART_LINE_UNAVAILABLE"},
		{"zero amount", testEstimateCart("0", 1, true), "CART_LINE_UNAVAILABLE"},
		{"quantity", testEstimateCart("1", 0, true), "CART_LINE_UNAVAILABLE"},
		{"multiplication overflow", testEstimateCart("9223372036854775807", 2, true), "MERCHANDISE_AMOUNT_OUT_OF_RANGE"},
		{"addition overflow", Snapshot{Version: 3, Lines: []Line{
			{PreviewUnitYER: "9223372036854775800", Quantity: 1, PreviewAvailable: true},
			{PreviewUnitYER: "10", Quantity: 1, PreviewAvailable: true},
		}}, "MERCHANDISE_AMOUNT_OUT_OF_RANGE"},
		{"unsafe version", Snapshot{Version: maxJSONSafeInteger + 1, Lines: []Line{
			{PreviewUnitYER: "1", Quantity: 1, PreviewAvailable: true},
		}}, "CART_VERSION_CONFLICT"},
		{"invalid integer", testEstimateCart("9223372036854775808", 1, true), "CART_LINE_UNAVAILABLE"},
		{"huge quantity", testEstimateCart("1", math.MaxInt32+1, true), "CART_LINE_UNAVAILABLE"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, got := estimateFromSnapshot(tc.cart)
			if got != tc.code {
				t.Fatalf("got %s want %s", got, tc.code)
			}
		})
	}
}
func TestEstimateRequiresExactlyOneCanonicalVersion(t *testing.T) {
	router := httptest.NewRecorder()
	_ = router
	cases := []struct {
		raw   string
		valid bool
	}{
		{"/v1/carts/store-a/merchandise-estimate?expectedVersion=0", true},
		{"/v1/carts/store-a/merchandise-estimate?expectedVersion=77", true},
		{"/v1/carts/store-a/merchandise-estimate?expectedVersion=01", false},
		{"/v1/carts/store-a/merchandise-estimate?expectedVersion=-1", false},
		{"/v1/carts/store-a/merchandise-estimate?expectedVersion=1&expectedVersion=2", false},
		{"/v1/carts/store-a/merchandise-estimate?storeId=store-b", false},
		{"/v1/carts/store-a/merchandise-estimate", false},
		{"/v1/carts/store-a/merchandise-estimate?expectedVersion=9007199254740992", false},
	}
	for _, tc := range cases {
		req := httptest.NewRequest("GET", tc.raw, nil)
		req.SetPathValue("storeID", "store-a")
		_, actual := validExpectedVersion(req)
		if actual != tc.valid {
			t.Fatalf("%s valid=%v expected=%v", tc.raw, actual, tc.valid)
		}
	}
}
