package transporthttp

import (
	"testing"

	wlt "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/wlt"
)

func TestFieldFinancePayoutStatusFilterRemainsSeparateFromAdmissionState(t *testing.T) {
	noRequest := wlt.PayoutState{ActorType: "field"}
	held := wlt.PayoutState{ActorType: "field", LatestPayout: &wlt.PayoutRequest{Status: "HELD"}}
	for _, test := range []struct {
		status string
		state  wlt.PayoutState
		want   bool
	}{
		{status: "", state: noRequest, want: true},
		{status: "NO_REQUEST", state: noRequest, want: true},
		{status: "NO_REQUEST", state: held, want: false},
		{status: "HELD", state: held, want: true},
		{status: "COMPLETED", state: held, want: false},
	} {
		if got := fieldFinanceStateMatchesPayoutStatus(test.state, test.status); got != test.want {
			t.Errorf("status %q match=%v, want %v", test.status, got, test.want)
		}
	}
	if _, valid := normalizeFieldFinancePayoutStatus("pending"); valid {
		t.Fatal("unsupported payout status was accepted")
	}
	if status, valid := normalizeFieldFinancePayoutStatus("prepared"); !valid || status != "PREPARED" {
		t.Fatalf("normalized status=%q valid=%v", status, valid)
	}
}
