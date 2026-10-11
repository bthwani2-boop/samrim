package storepublication

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
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

func TestPublicationReadinessGuardSkipsExternalDependenciesForHiddenStore(t *testing.T) {
	called := false
	readiness, err := evaluatePublicationGuard(context.Background(), "hidden", postgres.StoreRecord{ID: "store-1"}, func(context.Context, postgres.StoreRecord) (PublicationReadiness, error) {
		called = true
		return PublicationReadiness{}, errors.New("WLT unavailable")
	})
	if called || err != nil || readiness.Ready {
		t.Fatalf("hiding a Store must not require partner or WLT readiness: called=%v readiness=%+v err=%v", called, readiness, err)
	}
}

func TestPublicationReadinessGuardRequiresLiveReadinessForPublishing(t *testing.T) {
	outage := errors.New("WLT unavailable")
	calls := 0
	read := func(context.Context, postgres.StoreRecord) (PublicationReadiness, error) {
		calls++
		return PublicationReadiness{}, outage
	}
	if _, err := evaluatePublicationGuard(context.Background(), "published", postgres.StoreRecord{ID: "store-1"}, read); !errors.Is(err, outage) || calls != 1 {
		t.Fatalf("publishing must fail closed when external readiness fails: calls=%d err=%v", calls, err)
	}
	rejected, err := evaluatePublicationGuard(context.Background(), "published", postgres.StoreRecord{ID: "store-1"}, func(context.Context, postgres.StoreRecord) (PublicationReadiness, error) {
		return PublicationReadiness{BlockedReason: CommercialAgreementNotReadyReason}, nil
	})
	if !errors.Is(err, ErrPublicationReadinessBlocked) || rejected.BlockedReason != CommercialAgreementNotReadyReason {
		t.Fatalf("publishing must reject unmet commercial readiness: readiness=%+v err=%v", rejected, err)
	}
	ready, err := evaluatePublicationGuard(context.Background(), "published", postgres.StoreRecord{ID: "store-1"}, func(context.Context, postgres.StoreRecord) (PublicationReadiness, error) {
		return PublicationReadiness{Ready: true}, nil
	})
	if err != nil || !ready.Ready {
		t.Fatalf("publishing must accept confirmed readiness: readiness=%+v err=%v", ready, err)
	}
}
