package transporthttp

import "testing"

func TestBeneficiaryFinanceActorMatches(t *testing.T) {
	for _, tc := range []struct {
		name, role, actor, resultRole, resultActor string
		want                                       bool
	}{
		{"valid captain", "captain", "captain-11", "captain", "captain-11", true},
		{"valid customer", "customer", "customer-5", "customer", "customer-5", true},
		{"different captain", "captain", "captain-11", "captain", "captain-12", false},
		{"cross role", "captain", "captain-11", "customer", "captain-11", false},
		{"empty returned actor", "captain", "captain-11", "captain", "", false},
		{"empty request actor", "captain", "", "captain", "", false},
		{"empty returned role", "captain", "captain-11", "", "captain-11", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := beneficiaryFinanceActorMatches(tc.role, tc.actor, tc.resultRole, tc.resultActor); got != tc.want {
				t.Fatalf("actor binding got %v, want %v", got, tc.want)
			}
		})
	}
}
