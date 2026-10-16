package captain

import (
	"context"
	"errors"
	"fmt"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/wlt"
)

// Missing policy preserves pre-configuration behavior. Every configured minimum
// is checked against the canonical available YER balance for ALL payment modes.
func (s *Service) captainMinimumBalance(ctx context.Context) (int64, error) {
	policy, err := s.payment.ReadCaptainMinimumBalancePolicy(ctx)
	if err == nil {
		if policy.State != "ACTIVE" || policy.Currency != "YER" || policy.MinimumAvailableMinor <= 0 {
			return 0, fmt.Errorf("%w: captain minimum policy is invalid", ErrPaymentUnavailable)
		}
		return policy.MinimumAvailableMinor, nil
	}
	var remote *wlt.Error
	if errors.As(err, &remote) && remote.Status == 404 && remote.Code == "CAPTAIN_MINIMUM_BALANCE_NOT_CONFIGURED" {
		return 0, nil
	}
	return 0, fmt.Errorf("%w: captain minimum policy read failed: %v", ErrPaymentUnavailable, err)
}
func (s *Service) requireCaptainMinimumBalance(ctx context.Context, captainActorID string) error {
	minimum, err := s.captainMinimumBalance(ctx)
	if err != nil {
		return err
	}
	if minimum == 0 {
		return nil
	}
	state, err := s.payment.ReadCaptainWalletState(ctx, captainActorID)
	if err != nil {
		return fmt.Errorf("%w: captain balance could not be read: %v", ErrPaymentUnavailable, err)
	}
	if state.Currency != "YER" || state.AvailableMinor < minimum {
		return ErrCaptainWalletInsufficientFunds
	}
	return nil
}
