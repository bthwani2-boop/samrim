package captain

import (
	"context"
	"errors"
	"reflect"
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
