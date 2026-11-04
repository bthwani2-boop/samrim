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

// selectFundedNearbyCaptainPages keeps the candidate set bounded in memory
// while scanning beyond any page whose Captains cannot cover COD. Once three
// funded Captains are found no further database or WLT reads are performed.
func selectFundedNearbyCaptainPages(
	ctx context.Context,
	readPage func(context.Context, *postgres.NearbyCaptainCandidate) ([]postgres.NearbyCaptainCandidate, int64, error),
	readWallet func(context.Context, string) (wlt.CaptainWalletState, error),
) ([]string, error) {
	approved := make([]string, 0, 3)
	var after *postgres.NearbyCaptainCandidate
	for {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		candidates, cashMinor, err := readPage(ctx, after)
		if err != nil {
			return nil, err
		}
		if len(candidates) == 0 {
			break
		}
		funded, err := selectFundedNearbyCaptains(ctx, candidates, cashMinor, readWallet)
		if err != nil && err != postgres.ErrCaptainNoAvailable {
			// Never publish partial offers after an unavailable WLT read.
			return nil, err
		}
		approved = append(approved, funded...)
		if len(approved) >= 3 {
			return approved[:3], nil
		}
		if len(candidates) < postgres.NearbyCaptainCandidatePageSize {
			break
		}
		last := candidates[len(candidates)-1]
		after = &last
	}
	if len(approved) == 0 {
		return nil, postgres.ErrCaptainNoAvailable
	}
	return approved, nil
}
