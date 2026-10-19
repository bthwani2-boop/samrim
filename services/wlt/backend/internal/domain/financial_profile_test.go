package domain

import "testing"

func TestValidateFinancialProfile(t *testing.T) {
	tests := []struct {
		name        string
		origin      string
		period      string
		wantInvalid bool
	}{
		{name: "field daily", origin: OriginField, period: SettlementDaily},
		{name: "control panel monthly", origin: OriginControlPanel, period: SettlementMonthly},
		{name: "invalid origin", origin: "partner", period: SettlementWeekly, wantInvalid: true},
		{name: "invalid period", origin: OriginField, period: "YEARLY", wantInvalid: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := ValidateFinancialProfile("joining_case_1", "partner_1", tt.origin, tt.period)
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
