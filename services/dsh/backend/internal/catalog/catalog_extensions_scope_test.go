package catalog

import "testing"

func TestStoreAttachmentRequiresActingStoreOnBothSides(t *testing.T) {
	tests := []struct {
		name    string
		acting  string
		first   string
		second  string
		allowed bool
	}{
		{name: "both attached records belong to authorized store", acting: "store_a", first: "store_a", second: "store_a", allowed: true},
		{name: "matching foreign pair must not be attached", acting: "store_a", first: "store_b", second: "store_b"},
		{name: "foreign offer must not be attached", acting: "store_a", first: "store_a", second: "store_b"},
		{name: "foreign group or section must not be attached", acting: "store_a", first: "store_b", second: "store_a"},
		{name: "empty owner must not authorize", acting: "", first: "", second: ""},
		{name: "normalizes authorized store identifier", acting: " store_a ", first: "store_a", second: "store_a", allowed: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := storeAttachmentMatchesOwner(tt.acting, tt.first, tt.second); got != tt.allowed {
				t.Fatalf("attachment allowed=%v, want %v", got, tt.allowed)
			}
		})
	}
}
