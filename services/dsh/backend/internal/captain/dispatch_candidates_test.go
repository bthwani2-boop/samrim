package captain

import (
	"context"
	"errors"
	"fmt"
	"reflect"
	"strings"
	"testing"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/wlt"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

func TestFundedNearestCaptainsOnlyAndFailClosed(t *testing.T) {
	pool := []postgres.NearbyCaptainCandidate{{ActorID: "nearest-no-balance"}, {ActorID: "second"}, {ActorID: "third"}, {ActorID: "fourth"}, {ActorID: "fifth"}}
	called := []string{}
	wallet := func(_ context.Context, id string) (wlt.CaptainWalletState, error) {
		called = append(called, id)
		balance := int64(2000)
		if id == "nearest-no-balance" {
			balance = 0
		}
		return wlt.CaptainWalletState{Currency: "YER", AvailableMinor: balance}, nil
	}
	selected, err := selectFundedNearbyCaptains(context.Background(), pool, 2000, wallet)
	if err != nil || !reflect.DeepEqual(selected, []string{"second", "third", "fourth"}) {
		t.Fatalf("selected %v err %v", selected, err)
	}
	if len(called) != 4 {
		t.Fatalf("wallet preflight count=%d", len(called))
	}
	noMoney, err := selectFundedNearbyCaptains(context.Background(), pool, 0, func(context.Context, string) (wlt.CaptainWalletState, error) {
		t.Fatal("wallet must not block prepaid orders")
		return wlt.CaptainWalletState{}, nil
	})
	if err != nil || !reflect.DeepEqual(noMoney, []string{"nearest-no-balance", "second", "third"}) {
		t.Fatalf("prepaid offers %v err %v", noMoney, err)
	}
	_, err = selectFundedNearbyCaptains(context.Background(), pool, 2000, func(context.Context, string) (wlt.CaptainWalletState, error) {
		return wlt.CaptainWalletState{AvailableMinor: 0, Currency: "YER"}, nil
	})
	if !errors.Is(err, postgres.ErrCaptainNoAvailable) {
		t.Fatalf("all insufficient cash coverage: %v", err)
	}
	_, err = selectFundedNearbyCaptains(context.Background(), pool, 2000, func(context.Context, string) (wlt.CaptainWalletState, error) {
		return wlt.CaptainWalletState{}, errors.New("WLT unavailable")
	})
	if !errors.Is(err, ErrPaymentUnavailable) {
		t.Fatalf("wallet outage must not become eligibility rejection: %v", err)
	}
}

// A nearby Captain with adequate funds may be ranked after many Captains
// without sufficient COD coverage; the dispatch search must still reach them.
func TestFundedCandidatesAfterThirtyUnfundedNeighbors(t *testing.T) {
	candidates := make([]postgres.NearbyCaptainCandidate, 0, 38)
	for i := 0; i < 35; i++ {
		candidates = append(candidates, postgres.NearbyCaptainCandidate{ActorID: fmt.Sprintf("unfunded-%d", i)})
	}
	for _, id := range []string{"funded-1", "funded-2", "funded-3"} {
		candidates = append(candidates, postgres.NearbyCaptainCandidate{ActorID: id})
	}
	called := 0
	selected, err := selectFundedNearbyCaptains(context.Background(), candidates, 1200, func(_ context.Context, actorID string) (wlt.CaptainWalletState, error) {
		called++
		if strings.HasPrefix(actorID, "unfunded-") {
			return wlt.CaptainWalletState{Currency: "YER", LedgerBalanceMinor: 10000, HeldMinor: 9000, AvailableMinor: 1000}, nil
		}
		return wlt.CaptainWalletState{Currency: "YER", AvailableMinor: 1200}, nil
	})
	if err != nil || !reflect.DeepEqual(selected, []string{"funded-1", "funded-2", "funded-3"}) {
		t.Fatalf("funded captains after unfunded candidates: selected=%v err=%v", selected, err)
	}
	if called != len(candidates) {
		t.Fatalf("searched %d of %d candidates", called, len(candidates))
	}
}

func TestCaptainCoverageDoesNotRequireRecurringDailyMinimum(t *testing.T) {
	candidates := []postgres.NearbyCaptainCandidate{{ActorID: "balance-7000"}, {ActorID: "balance-3000"}, {ActorID: "balance-0"}}
	lookup := func(_ context.Context, id string) (wlt.CaptainWalletState, error) {
		available := int64(0)
		switch id {
		case "balance-7000":
			available = 7000
		case "balance-3000":
			available = 3000
		}
		return wlt.CaptainWalletState{AvailableMinor: available, Currency: "YER"}, nil
	}
	cashOffers, err := selectFundedNearbyCaptains(context.Background(), candidates, 4000, lookup)
	if err != nil || !reflect.DeepEqual(cashOffers, []string{"balance-7000"}) {
		t.Fatalf("4000 cash with 7000 capacity: %v %v", cashOffers, err)
	}
	prepaid, err := selectFundedNearbyCaptains(context.Background(), candidates, 0, func(context.Context, string) (wlt.CaptainWalletState, error) {
		t.Fatal("prepaid candidates must not require cash balance lookup")
		return wlt.CaptainWalletState{}, nil
	})
	if err != nil || !reflect.DeepEqual(prepaid, []string{"balance-7000", "balance-3000", "balance-0"}) {
		t.Fatalf("zero cash eligible candidates: %v %v", prepaid, err)
	}
}

func TestCaptainCashExposureRequiresFullCoverage(t *testing.T) {
	pool := []postgres.NearbyCaptainCandidate{{ActorID: "not-covered"}, {ActorID: "exactly-covered"}}
	selected, err := selectFundedNearbyCaptains(context.Background(), pool, 1200, func(_ context.Context, id string) (wlt.CaptainWalletState, error) {
		available := int64(600)
		if id == "exactly-covered" {
			available = 1200
		}
		return wlt.CaptainWalletState{AvailableMinor: available, Currency: "YER"}, nil
	})
	if err != nil || !reflect.DeepEqual(selected, []string{"exactly-covered"}) {
		t.Fatalf("cash exposure must be fully covered: %v %v", selected, err)
	}
}

func TestFundedCaptainPaginationFindsLaterEligibleCaptains(t *testing.T) {
	first := make([]postgres.NearbyCaptainCandidate, 0, postgres.NearbyCaptainCandidatePageSize)
	for i := 0; i < postgres.NearbyCaptainCandidatePageSize; i++ {
		first = append(first, postgres.NearbyCaptainCandidate{ActorID: fmt.Sprintf("unfunded-%d", i), DistanceSquared: float64(i)})
	}
	second := make([]postgres.NearbyCaptainCandidate, 0, 8)
	for i := 30; i < 35; i++ {
		second = append(second, postgres.NearbyCaptainCandidate{ActorID: fmt.Sprintf("unfunded-%d", i), DistanceSquared: float64(i)})
	}
	for i := 1; i <= 3; i++ {
		second = append(second, postgres.NearbyCaptainCandidate{ActorID: fmt.Sprintf("funded-%d", i), DistanceSquared: float64(34 + i)})
	}
	pages := 0
	walletReads := 0
	readPage := func(_ context.Context, after *postgres.NearbyCaptainCandidate) ([]postgres.NearbyCaptainCandidate, int64, error) {
		pages++
		switch pages {
		case 1:
			if after != nil {
				t.Fatal("first page must not receive a cursor")
			}
			return first, 1200, nil
		case 2:
			if after == nil || after.ActorID != "unfunded-29" || after.DistanceSquared != 29 {
				t.Fatalf("incorrect page cursor: %+v", after)
			}
			return second, 1200, nil
		default:
			t.Fatal("a third query is unnecessary after three funded Captains")
			return nil, 0, nil
		}
	}
	readWallet := func(_ context.Context, actorID string) (wlt.CaptainWalletState, error) {
		walletReads++
		if strings.HasPrefix(actorID, "unfunded-") {
			return wlt.CaptainWalletState{Currency: "YER", AvailableMinor: 1199}, nil
		}
		return wlt.CaptainWalletState{Currency: "YER", AvailableMinor: 1200}, nil
	}
	selected, err := selectFundedNearbyCaptainPages(context.Background(), readPage, readWallet)
	if err != nil || !reflect.DeepEqual(selected, []string{"funded-1", "funded-2", "funded-3"}) {
		t.Fatalf("funded selection beyond page 1: %v err=%v", selected, err)
	}
	if pages != 2 || walletReads != 38 {
		t.Fatalf("pages=%d walletReads=%d, expected two pages and 38 preflights", pages, walletReads)
	}
}

func TestFundedCaptainPaginationFailsClosedAfterPartialSelection(t *testing.T) {
	candidates := make([]postgres.NearbyCaptainCandidate, 0, postgres.NearbyCaptainCandidatePageSize)
	candidates = append(candidates, postgres.NearbyCaptainCandidate{ActorID: "funded-first", DistanceSquared: 1})
	for i := 1; i < postgres.NearbyCaptainCandidatePageSize; i++ {
		candidates = append(candidates, postgres.NearbyCaptainCandidate{ActorID: fmt.Sprintf("unfunded-%d", i), DistanceSquared: float64(i + 1)})
	}
	pages := 0
	selected, err := selectFundedNearbyCaptainPages(context.Background(), func(_ context.Context, after *postgres.NearbyCaptainCandidate) ([]postgres.NearbyCaptainCandidate, int64, error) {
		pages++
		if pages == 1 {
			return candidates, 1200, nil
		}
		if after == nil || after.ActorID != "unfunded-29" {
			t.Fatalf("incorrect second page cursor: %+v", after)
		}
		return nil, 0, errors.New("database unavailable")
	}, func(_ context.Context, actorID string) (wlt.CaptainWalletState, error) {
		if actorID == "funded-first" {
			return wlt.CaptainWalletState{Currency: "YER", AvailableMinor: 1200}, nil
		}
		return wlt.CaptainWalletState{Currency: "YER", AvailableMinor: 0}, nil
	})
	if err == nil || selected != nil || pages != 2 {
		t.Fatalf("failed second page must not publish partial offers: %v err=%v pages=%d", selected, err, pages)
	}
}

func TestFundedCandidatesRejectNegativeCashExposure(t *testing.T) {
	candidates := []postgres.NearbyCaptainCandidate{{ActorID: "captain-1"}}
	selected, err := selectFundedNearbyCaptains(context.Background(), candidates, -1, func(context.Context, string) (wlt.CaptainWalletState, error) {
		t.Fatal("invalid COD amount must fail before wallet read")
		return wlt.CaptainWalletState{}, nil
	})
	if selected != nil || !errors.Is(err, ErrPaymentUnavailable) {
		t.Fatalf("invalid negative cash exposure must fail closed: selected=%v err=%v", selected, err)
	}
}

func TestFundedCandidatePaginationRejectsChangedCashExposure(t *testing.T) {
	first := make([]postgres.NearbyCaptainCandidate, postgres.NearbyCaptainCandidatePageSize)
	first[0] = postgres.NearbyCaptainCandidate{ActorID: "funded-first"}
	for i := 1; i < len(first); i++ {
		first[i] = postgres.NearbyCaptainCandidate{ActorID: fmt.Sprintf("unfunded-%d", i)}
	}
	pages := 0
	selected, err := selectFundedNearbyCaptainPages(context.Background(),
		func(_ context.Context, cursor *postgres.NearbyCaptainCandidate) ([]postgres.NearbyCaptainCandidate, int64, error) {
			pages++
			if pages == 1 {
				if cursor != nil {
					t.Fatal("first page cannot have a cursor")
				}
				return first, 1200, nil
			}
			if cursor == nil || cursor.ActorID != first[len(first)-1].ActorID {
				t.Fatalf("incorrect page cursor: %+v", cursor)
			}
			return []postgres.NearbyCaptainCandidate{{ActorID: "funded-later"}}, 0, nil
		},
		func(_ context.Context, id string) (wlt.CaptainWalletState, error) {
			if strings.HasPrefix(id, "unfunded-") {
				return wlt.CaptainWalletState{Currency: "YER", AvailableMinor: 0}, nil
			}
			return wlt.CaptainWalletState{Currency: "YER", AvailableMinor: 1200}, nil
		},
	)
	if selected != nil || !errors.Is(err, ErrPaymentUnavailable) || pages != 2 {
		t.Fatalf("cash amount changed between pages: selected=%v err=%v pages=%d", selected, err, pages)
	}
}

func TestFundedCandidatePagesStopAfterRemainingQuota(t *testing.T) {
	first := make([]postgres.NearbyCaptainCandidate, postgres.NearbyCaptainCandidatePageSize)
	first[0] = postgres.NearbyCaptainCandidate{ActorID: "funded-one"}
	first[1] = postgres.NearbyCaptainCandidate{ActorID: "funded-two"}
	for i := 2; i < len(first); i++ {
		first[i] = postgres.NearbyCaptainCandidate{ActorID: fmt.Sprintf("unfunded-%d", i)}
	}
	pages, reads := 0, []string{}
	selected, err := selectFundedNearbyCaptainPages(context.Background(),
		func(_ context.Context, cursor *postgres.NearbyCaptainCandidate) ([]postgres.NearbyCaptainCandidate, int64, error) {
			pages++
			if pages == 1 {
				return first, 1200, nil
			}
			if pages != 2 || cursor == nil || cursor.ActorID != first[len(first)-1].ActorID {
				t.Fatalf("unexpected query after final captain or bad cursor: page=%d cursor=%+v", pages, cursor)
			}
			return []postgres.NearbyCaptainCandidate{
				{ActorID: "funded-three"}, {ActorID: "wallet-lookup-must-not-run"},
			}, 1200, nil
		},
		func(_ context.Context, id string) (wlt.CaptainWalletState, error) {
			reads = append(reads, id)
			if id == "wallet-lookup-must-not-run" {
				return wlt.CaptainWalletState{}, errors.New("unneeded WLT failure")
			}
			if strings.HasPrefix(id, "unfunded-") {
				return wlt.CaptainWalletState{Currency: "YER", AvailableMinor: 0}, nil
			}
			return wlt.CaptainWalletState{Currency: "YER", AvailableMinor: 1200}, nil
		})
	if err != nil || !reflect.DeepEqual(selected, []string{"funded-one", "funded-two", "funded-three"}) || pages != 2 || len(reads) != 31 {
		t.Fatalf("remaining quota must stop WLT reads: selected=%v err=%v pages=%d reads=%v", selected, err, pages, reads)
	}
}

func TestFundedCandidateStalledCursorFailsClosedWithoutPartialOffers(t *testing.T) {
	pages := 0
	candidates := make([]postgres.NearbyCaptainCandidate, postgres.NearbyCaptainCandidatePageSize)
	for i := range candidates {
		candidates[i] = postgres.NearbyCaptainCandidate{ActorID: fmt.Sprintf("unfunded-%d", i)}
	}
	candidates[0].ActorID = "one-funded"
	selected, err := selectFundedNearbyCaptainPages(context.Background(),
		func(_ context.Context, _ *postgres.NearbyCaptainCandidate) ([]postgres.NearbyCaptainCandidate, int64, error) {
			pages++
			if pages > 1 {
				candidates[0].ActorID = "unfunded-0"
			}
			return candidates, 1200, nil
		}, func(_ context.Context, id string) (wlt.CaptainWalletState, error) {
			available := int64(0)
			if id == "one-funded" {
				available = 1200
			}
			return wlt.CaptainWalletState{Currency: "YER", AvailableMinor: available}, nil
		})
	if !errors.Is(err, ErrPaymentUnavailable) || selected != nil || pages != 2 {
		t.Fatalf("stalled cursor must fail closed: selected=%v err=%v pages=%d", selected, err, pages)
	}
}

// A funded Captain beyond the fourth page must not be lost merely because
// previous nearby Captains have insufficient WLT cash coverage.
func TestFundedCaptainPaginationBeyondOneHundredTwenty(t *testing.T) {
	const unfundedCount = 120
	candidates := make([]postgres.NearbyCaptainCandidate, 0, unfundedCount+3)
	for i := 0; i < unfundedCount; i++ {
		candidates = append(candidates, postgres.NearbyCaptainCandidate{
			ActorID: fmt.Sprintf("unfunded-%03d", i), DistanceSquared: float64(i),
		})
	}
	for i := 0; i < 3; i++ {
		candidates = append(candidates, postgres.NearbyCaptainCandidate{
			ActorID: fmt.Sprintf("funded-%d", i), DistanceSquared: float64(unfundedCount + i),
		})
	}
	pages := 0
	selected, err := selectFundedNearbyCaptainPages(context.Background(),
		func(_ context.Context, after *postgres.NearbyCaptainCandidate) ([]postgres.NearbyCaptainCandidate, int64, error) {
			start := pages * postgres.NearbyCaptainCandidatePageSize
			if pages > 0 && (after == nil || after.ActorID != candidates[start-1].ActorID) {
				t.Fatalf("wrong keyset cursor at page %d: %+v", pages+1, after)
			}
			pages++
			if start >= len(candidates) {
				return nil, 1200, nil
			}
			end := start + postgres.NearbyCaptainCandidatePageSize
			if end > len(candidates) {
				end = len(candidates)
			}
			return candidates[start:end], 1200, nil
		},
		func(_ context.Context, id string) (wlt.CaptainWalletState, error) {
			available := int64(0)
			if strings.HasPrefix(id, "funded-") {
				available = 1200
			}
			return wlt.CaptainWalletState{Currency: "YER", AvailableMinor: available}, nil
		},
	)
	if err != nil || !reflect.DeepEqual(selected, []string{"funded-0", "funded-1", "funded-2"}) || pages != 5 {
		t.Fatalf("eligible captains beyond 120: selected=%v err=%v pages=%d", selected, err, pages)
	}
}
