package http

import "testing"

func TestDevelopmentSimulatorPlatformFeeOnlyOnSuccess(t *testing.T) {
	for _, item := range []struct {
		outcome     string
		gross, want int64
	}{
		{"SUCCESS", 1000, 20},
		{"success", 1000, 20},
		{"SUCCESS", 1500, 30},
		{"SUCCESS", 49, 0},
		{"SUCCESS", 1, 0},
		{"SUCCESS", 0, 0},
		{"SUCCESS", -1, 0},
		{"FAILURE", 1000, 0},
		{"UNKNOWN", 1000, 0},
		{"DELAYED", 1000, 0},
	} {
		if got := developmentSimulatorCashInProviderFeeMinor(item.outcome, item.gross); got != item.want {
			t.Errorf("outcome=%s gross=%d got=%d want=%d", item.outcome, item.gross, got, item.want)
		}
	}
}
