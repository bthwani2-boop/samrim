package notification

import "testing"

func TestValidClientShareRequest(t *testing.T) {
	for _, kind := range []string{"STORE", "OFFER", "PROMOTION", "CONTENT"} {
		if !ValidClientShareRequest(ClientShareRequest{ContentKind: kind, ContentID: "ref-123", MessageCode: "LOOK"}) {
			t.Fatalf("valid kind %q rejected", kind)
		}
	}
	for _, input := range []ClientShareRequest{
		{ContentKind: "CART", ContentID: "private", MessageCode: "LOOK"},
		{ContentKind: "STORE", ContentID: "", MessageCode: "LOOK"},
		{ContentKind: "STORE", ContentID: " x ", MessageCode: "LOOK"},
		{ContentKind: "STORE", ContentID: "valid", MessageCode: "pay-me"},
	} {
		if ValidClientShareRequest(input) {
			t.Fatalf("invalid share accepted: %+v", input)
		}
	}
}
