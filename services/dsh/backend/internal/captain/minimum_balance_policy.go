package captain

import (
	"context"
	"errors"
	"fmt"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/wlt"
)

// The configured minimum is required only when a Captain first becomes
// available. Later COD exposure is protected by WLT's actual cash reservation;
// it is not a recurring daily minimum or a floor on prepaid delivery.
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

// requireInitialCaptainFunding checks the first-ever availability activation.
// The admission audit remains the durable record across shifts and restores.
// A previous activation is never re-gated by the original funding threshold.
func (s *Service) requireInitialCaptainFunding(ctx context.Context, captainActorID string) error {
	var previouslyActivated bool
	if err := s.db.QueryRowContext(ctx, `SELECT EXISTS(
		SELECT 1 FROM dsh.captain_admission_audit
		WHERE actor_id=$1 AND event_type='captain_availability_changed'
		AND to_state='available')`, captainActorID).Scan(&previouslyActivated); err != nil {
		return fmt.Errorf("%w: captain activation history unavailable: %v", ErrPaymentUnavailable, err)
	}
	if previouslyActivated {
		return nil
	}
	minimum, err := s.captainMinimumBalance(ctx)
	if err != nil {
		return err
	}
	if minimum == 0 {
		return nil
	}
	state, err := s.payment.ReadCaptainWalletState(ctx, captainActorID)
	if err != nil {
		return fmt.Errorf("%w: initial captain funding unavailable: %v", ErrPaymentUnavailable, err)
	}
	if state.Currency != "YER" || state.LedgerBalanceMinor < minimum {
		return ErrCaptainWalletInsufficientFunds
	}
	return nil
}
