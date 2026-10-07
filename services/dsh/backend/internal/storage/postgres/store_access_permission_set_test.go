package postgres

import "testing"

func TestValidStorePermissionSetRequiresOrdersForFulfillment(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name        string
		permissions []string
		valid       bool
	}{
		{name: "orders only", permissions: []string{"orders"}, valid: true},
		{name: "delivery preset", permissions: []string{"fulfillment", "orders"}, valid: true},
		{name: "fulfillment only", permissions: []string{"fulfillment"}, valid: false},
		{name: "unknown", permissions: []string{"orders", "unknown"}, valid: false},
		{name: "empty", permissions: nil, valid: false},
	}
	for _, testCase := range cases {
		testCase := testCase
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()
			if actual := validStorePermissionSet(testCase.permissions); actual != testCase.valid {
				t.Fatalf("validStorePermissionSet(%v) = %v, want %v", testCase.permissions, actual, testCase.valid)
			}
		})
	}
}
