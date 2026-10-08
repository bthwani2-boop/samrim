package challenge

import (
	"context"
	"errors"
	"testing"

	"github.com/bthwani2-boop/samrim/services/identity/backend/internal/domain"
)

func TestManagedRecoveryExcludesOperatorAndClientRoles(t *testing.T) {
	service := New(nil, nil, nil, nil, nil)
	for _, role := range []string{"operator", "client", ""} {
		if _, err := service.RequestManagedRecovery(context.Background(), domain.ManagedChallengeRequest{Phone: "+967777000001", Role: role}, ""); !errors.Is(err, domain.ErrForbidden) {
			t.Errorf("RequestManagedRecovery(role=%q) error = %v, want forbidden", role, err)
		}
		if _, err := service.RecoverManaged(context.Background(), domain.ManagedRecoveryProofRequest{Phone: "+967777000001", Role: role}); !errors.Is(err, domain.ErrInvalidChallenge) {
			t.Errorf("RecoverManaged(role=%q) error = %v, want invalid challenge", role, err)
		}
	}
}
