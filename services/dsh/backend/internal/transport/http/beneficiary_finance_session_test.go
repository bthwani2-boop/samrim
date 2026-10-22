package transporthttp

import (
	"testing"

	identityclient "github.com/bthwani2-boop/samrim/services/identity/clients/go"
)

// Settlement and payout endpoints must not accept a token merely because
// its actor has an eligible role; the issuing application is part of authority.
func TestBeneficiaryFinanceSessionRequiresMatchingSurface(t *testing.T) {
	cases := []struct {
		name, role, surface, subject string
		allowed                      bool
	}{
		{"partner on partner app", "partner", "app-partner", "partner-1", true},
		{"captain on captain app", "captain", "app-captain", "captain-1", true},
		{"field on field app", "field", "app-field", "field-1", true},
		{"partner on field app", "partner", "app-field", "partner-1", false},
		{"captain on field app", "captain", "app-field", "captain-1", false},
		{"field on captain app", "field", "app-captain", "field-1", false},
		{"partner on control panel", "partner", "control-panel", "partner-1", false},
		{"captain on client app", "captain", "app-client", "captain-1", false},
		{"client role", "client", "app-client", "client-1", false},
		{"operator role", "operator", "control-panel", "operator-1", false},
		{"missing subject", "partner", "app-partner", " ", false},
		{"missing surface", "partner", "", "partner-1", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := validBeneficiaryFinanceSession(identityclient.ActorIdentity{
				Role: tc.role, Surface: tc.surface, Subject: tc.subject,
			})
			if got != tc.allowed {
				t.Fatalf("beneficiary authority=%t, want %t for role=%q surface=%q", got, tc.allowed, tc.role, tc.surface)
			}
		})
	}
}

// Customer and Captain Cash-In as well as Field finance use the same
// canonical surface check, without allowing an actor role to cross apps.
func TestOwnAppFinanceSessionForWalletFundingAndField(t *testing.T) {
	cases := []struct {
		role, surface, subject string
		allowed                bool
	}{
		{"client", "app-client", "client-1", true},
		{"client", "app-captain", "client-1", false},
		{"captain", "app-captain", "captain-1", true},
		{"captain", "app-field", "captain-1", false},
		{"field", "app-field", "field-1", true},
		{"field", "app-client", "field-1", false},
		{"partner", "app-partner", "partner-1", true},
		{"partner", "control-panel", "partner-1", false},
		{"field", "app-field", "", false},
		{"client", "", "client-1", false},
	}
	for _, tc := range cases {
		id := identityclient.ActorIdentity{Role: tc.role, Surface: tc.surface, Subject: tc.subject}
		if got := validOwnAppFinanceSession(id); got != tc.allowed {
			t.Errorf("role=%q surface=%q subject=%q: got=%t want=%t", tc.role, tc.surface, tc.subject, got, tc.allowed)
		}
	}
}
