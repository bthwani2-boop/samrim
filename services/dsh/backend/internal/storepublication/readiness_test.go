package storepublication

import (
	"testing"
	"time"

	identityclient "github.com/bthwani2-boop/samrim/services/identity/clients/go"
)

func TestEvaluatePartnerReadiness(t *testing.T) {
	activatedAt := time.Unix(1, 0)
	tests := []struct {
		name      string
		view      identityclient.ActorRoleView
		wantReady bool
		wantBlock string
	}{
		{
			name: "eligible partner",
			view: identityclient.ActorRoleView{
				Role: "partner", Enabled: true, SecurityEnabled: true, ActivatedAt: &activatedAt,
			},
			wantReady: true,
		},
		{
			name: "not activated",
			view: identityclient.ActorRoleView{
				Role: "partner", Enabled: true, SecurityEnabled: true,
			},
			wantBlock: PartnerIdentityNotEligibleReason,
		},
		{
			name: "disabled role",
			view: identityclient.ActorRoleView{
				Role: "partner", Enabled: false, SecurityEnabled: true, ActivatedAt: &activatedAt,
			},
			wantBlock: PartnerIdentityNotEligibleReason,
		},
		{
			name: "security disabled",
			view: identityclient.ActorRoleView{
				Role: "partner", Enabled: true, SecurityEnabled: false, ActivatedAt: &activatedAt,
			},
			wantBlock: PartnerIdentityNotEligibleReason,
		},
		{
			name: "wrong role",
			view: identityclient.ActorRoleView{
				Role: "captain", Enabled: true, SecurityEnabled: true, ActivatedAt: &activatedAt,
			},
			wantBlock: PartnerIdentityNotEligibleReason,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := evaluatePartnerReadiness(tt.view)
			if got.Ready != tt.wantReady || got.BlockedReason != tt.wantBlock {
				t.Fatalf("readiness = %+v, want ready=%t blockedReason=%q", got, tt.wantReady, tt.wantBlock)
			}
		})
	}
}
