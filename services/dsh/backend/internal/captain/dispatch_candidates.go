package captain

import (
	"context"
	"fmt"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/wlt"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

// Preserve source-ranked nearest order while rejecting financially ineligible
// captains before inserting offers. A missing wallet read fails closed.
func selectFundedNearbyCaptains(ctx context.Context, candidates []postgres.NearbyCaptainCandidate, cashMinor int64, readWallet func(context.Context, string) (wlt.CaptainWalletState, error)) ([]string, error) {
	approved := make([]string, 0, 3)
	for _, candidate := range candidates {
		if cashMinor > 0 {
			wallet, err := readWallet(ctx, candidate.ActorID)
			if err != nil {
				return nil, fmt.Errorf("%w: captain wallet preflight failed: %v", ErrPaymentUnavailable, err)
			}
			if wallet.Currency != "YER" || wallet.AvailableMinor < cashMinor {
				continue
			}
		}
		approved = append(approved, candidate.ActorID)
		if len(approved) == 3 {
			break
		}
	}
	if len(approved) == 0 {
		return nil, postgres.ErrCaptainNoAvailable
	}
	return approved, nil
}
