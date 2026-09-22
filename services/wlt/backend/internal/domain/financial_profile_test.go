package domain

import "testing"

func TestValidateFinancialProfile(t *testing.T) {
	tests := []struct {
		name        string
		origin      string
		period      string
		commission  int
		wantInvalid bool
	}{
		{name: "field daily", origin: OriginField, period: SettlementDaily, commission: 1500},
		{name: "control panel monthly zero", origin: OriginControlPanel, period: SettlementMonthly, commission: 0},
		{name: "invalid origin", origin: "partner", period: SettlementWeekly, commission: 1500, wantInvalid: true},
		{name: "negative commission", origin: OriginField, period: SettlementWeekly, commission: -1, wantInvalid: true},
		{name: "commission over one hundred percent", origin: OriginField, period: SettlementWeekly, commission: 10001, wantInvalid: true},
		{name: "invalid period", origin: OriginField, period: "YEARLY", commission: 1500, wantInvalid: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := ValidateFinancialProfile("joining_case_1", "partner_1", tt.origin, tt.period, tt.commission)
			if (err != nil) != tt.wantInvalid {
				t.Fatalf("ValidateFinancialProfile() error = %v, wantInvalid=%t", err, tt.wantInvalid)
			}
		})
	}
}

func TestCanActivateFinancialProfile(t *testing.T) {
	if !CanActivateFinancialProfile(ProfilePendingBinding) {
		t.Fatal("pending profile must be activatable")
	}
	if CanActivateFinancialProfile(ProfileActive) {
		t.Fatal("active profile must not be activatable again")
	}
}
