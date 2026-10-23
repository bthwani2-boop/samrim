package postgres

import "testing"

func TestCheckoutHashBindsAcknowledgedDiscoveryClick(t *testing.T) {
	input := CheckoutInput{ClientActorID: "client", CartID: "cart", StoreID: "store", FulfillmentMode: FulfillmentModeCustomerPickup}
	baseline := HashCheckoutRequest(input)
	input.DiscoveryClickEventID = "acknowledged-click-a"
	first := HashCheckoutRequest(input)
	if baseline == first {
		t.Fatal("acknowledged discovery click was ignored by checkout idempotency hash")
	}
	input.DiscoveryClickEventID = "acknowledged-click-b"
	if first == HashCheckoutRequest(input) {
		t.Fatal("distinct acknowledged clicks must have distinct checkout facts")
	}
	input.DiscoveryClickEventID = " acknowledged-click-a "
	if first != HashCheckoutRequest(input) {
		t.Fatal("whitespace differences must not change canonical click identity")
	}
}
