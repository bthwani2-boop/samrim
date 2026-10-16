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
	selected, err := selectFundedNearbyCaptains(context.Background(), pool, 2000, 0, wallet)
	if err != nil || !reflect.DeepEqual(selected, []string{"second", "third", "fourth"}) {
		t.Fatalf("selected %v err %v", selected, err)
	}
	if len(called) != 4 {
		t.Fatalf("wallet preflight count=%d", len(called))
	}
	noMoney, err := selectFundedNearbyCaptains(context.Background(), pool, 0, 0, func(context.Context, string) (wlt.CaptainWalletState, error) {
		t.Fatal("wallet must not block prepaid orders")
		return wlt.CaptainWalletState{}, nil
	})
	if err != nil || len(noMoney) != 3 {
		t.Fatalf("prepaid offers %v err %v", noMoney, err)
	}
	_, err = selectFundedNearbyCaptains(context.Background(), pool, 2000, 0, func(context.Context, string) (wlt.CaptainWalletState, error) {
		return wlt.CaptainWalletState{AvailableMinor: 0, Currency: "YER"}, nil
	})
	if !errors.Is(err, postgres.ErrCaptainNoAvailable) {
		t.Fatalf("all insolvent: %v", err)
	}
	_, err = selectFundedNearbyCaptains(context.Background(), pool, 2000, 0, func(context.Context, string) (wlt.CaptainWalletState, error) {
		return wlt.CaptainWalletState{}, errors.New("WLT unavailable")
	})
	if !errors.Is(err, ErrPaymentUnavailable) {
		t.Fatalf("wallet outage must not become eligibility rejection: %v", err)
	}
}

func TestCaptainMinimumBalanceAppliesToAllPaymentModes(t *testing.T) {
	candidates := []postgres.NearbyCaptainCandidate{{ActorID: "below"}, {ActorID: "equal"}, {ActorID: "above"}}
	for _, testCase := range []struct {
		name string
		cash int64
	}{
		{"wallet-only", 0}, {"mixed", 100}, {"cash", 200},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			calls := 0
			selected, err := selectFundedNearbyCaptains(context.Background(), candidates, testCase.cash, 500, func(_ context.Context, id string) (wlt.CaptainWalletState, error) {
				calls++
				balance := int64(499)
				if id == "equal" {
					balance = 500
				}
				if id == "above" {
					balance = 1000
				}
				return wlt.CaptainWalletState{AvailableMinor: balance, Currency: "YER"}, nil
			})
			if err != nil || !reflect.DeepEqual(selected, []string{"equal", "above"}) || calls != 3 {
				t.Fatalf("%s: selected %v, reads %d, err %v", testCase.name, selected, calls, err)
			}
		})
	}
}
func TestCaptainMinimumPreservesCashExposureRequirement(t *testing.T) {
	pool := []postgres.NearbyCaptainCandidate{{ActorID: "minimum-only"}, {ActorID: "both"}}
	selected, err := selectFundedNearbyCaptains(context.Background(), pool, 1200, 500, func(_ context.Context, id string) (wlt.CaptainWalletState, error) {
		available := int64(600)
		if id == "both" {
			available = 1250
		}
		return wlt.CaptainWalletState{AvailableMinor: available, Currency: "YER"}, nil
	})
	if err != nil || !reflect.DeepEqual(selected, []string{"both"}) {
		t.Fatalf("cash exposure: %v %v", selected, err)
	}
}
