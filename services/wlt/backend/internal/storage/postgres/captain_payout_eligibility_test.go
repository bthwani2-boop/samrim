package postgres

import "testing"

func TestCaptainEarnedWithdrawalAllowance(t *testing.T) {
	tests := []struct {
		name               string
		available, earned  int64
		completed, pending int64
		want               int64
	}{
		{"funding alone never withdrawable", 20000, 0, 0, 0, 0},
		{"earned withdrawable after cover drops below activation funding", 7000, 2000, 0, 0, 2000},
		{"wallet capacity caps earned withdrawal", 1000, 3000, 0, 0, 1000},
		{"completed transfers reduce eligibility", 12000, 5000, 3000, 0, 2000},
		{"active payout holds reduce eligibility", 12000, 5000, 0, 2000, 3000},
		{"fully paid earning", 10000, 5000, 5000, 0, 0},
		{"funding not withdrawable after earnings consumed", 10000, 5000, 4000, 1000, 0},
		{"cash reservations consume the available balance", 0, 5000, 0, 0, 0},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := captainEarnedWithdrawalAllowance(tt.available, tt.earned, tt.completed, tt.pending); got != tt.want {
				t.Fatalf("eligible=%d want=%d", got, tt.want)
			}
		})
	}
}
