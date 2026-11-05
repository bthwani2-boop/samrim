package captain

import (
	"context"
	"fmt"
	"time"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/wlt"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

// Preserve source-ranked nearest order while rejecting financially ineligible
// captains before inserting offers. A missing wallet read fails closed.
func selectFundedNearbyCaptains(ctx context.Context, candidates []postgres.NearbyCaptainCandidate, cashMinor int64, readWallet func(context.Context, string) (wlt.CaptainWalletState, error)) ([]string, error) {
	return selectFundedNearbyCaptainsUpTo(ctx, candidates, cashMinor, 3, readWallet)
}

// Select only the remaining funded-Captain quota: do not query WLT for a
// Captain whose eligibility is no longer needed for this offer batch.
func selectFundedNearbyCaptainsUpTo(ctx context.Context, candidates []postgres.NearbyCaptainCandidate, cashMinor int64, limit int, readWallet func(context.Context, string) (wlt.CaptainWalletState, error)) ([]string, error) {
	if cashMinor < 0 {
		return nil, fmt.Errorf("%w: negative COD exposure", ErrPaymentUnavailable)
	}
	if limit < 1 || limit > 3 {
		return nil, fmt.Errorf("%w: invalid funded captain limit", ErrPaymentUnavailable)
	}
	approved := make([]string, 0, limit)
	for _, candidate := range candidates {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
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
		if len(approved) == limit {
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
// Bound total scan time instead of hiding eligible Captains behind a fixed page count.
// Database pages remain bounded, and cancellation is propagated to WLT reads.
const captainCandidateScanTimeout = 8 * time.Second

func selectFundedNearbyCaptainPages(
	ctx context.Context,
	readPage func(context.Context, *postgres.NearbyCaptainCandidate) ([]postgres.NearbyCaptainCandidate, int64, error),
	readWallet func(context.Context, string) (wlt.CaptainWalletState, error),
) ([]string, error) {
	scanCtx, cancel := context.WithTimeout(ctx, captainCandidateScanTimeout)
	defer cancel()
	approved := make([]string, 0, 3)
	var after *postgres.NearbyCaptainCandidate
	var initialCashMinor int64
	cashRead := false
	for {
		if err := scanCtx.Err(); err != nil {
			return nil, err
		}
		candidates, cashMinor, err := readPage(scanCtx, after)
		if err != nil {
			return nil, err
		}
		// The reader may return a stale success after the caller cancelled.
		if err := scanCtx.Err(); err != nil {
			return nil, err
		}
		if cashMinor < 0 || (cashRead && cashMinor != initialCashMinor) {
			return nil, fmt.Errorf("%w: inconsistent COD exposure between captain pages", ErrPaymentUnavailable)
		}
		initialCashMinor, cashRead = cashMinor, true
		if len(candidates) == 0 {
			break
		}
		// Validate before reading WLT or satisfying the final quota: a stale
		// page must never reissue an offer to an already selected Captain.
		last := candidates[len(candidates)-1]
		if after != nil && (last.DistanceSquared < after.DistanceSquared ||
			(last.DistanceSquared == after.DistanceSquared && last.ActorID <= after.ActorID)) {
			return nil, fmt.Errorf("%w: captain candidate cursor did not advance", ErrPaymentUnavailable)
		}
		funded, err := selectFundedNearbyCaptainsUpTo(scanCtx, candidates, cashMinor, 3-len(approved), readWallet)
		if err != nil && err != postgres.ErrCaptainNoAvailable {
			// Never publish partial offers after an unavailable WLT read.
			return nil, err
		}
		// A late successful wallet response does not override cancellation.
		if err := scanCtx.Err(); err != nil {
			return nil, err
		}
		approved = append(approved, funded...)
		if len(approved) >= 3 {
			return approved[:3], nil
		}
		if len(candidates) < postgres.NearbyCaptainCandidatePageSize {
			break
		}
		after = &last
	}
	if len(approved) == 0 {
		return nil, postgres.ErrCaptainNoAvailable
	}
	return approved, nil
}
