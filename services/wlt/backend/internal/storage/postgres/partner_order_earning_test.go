package postgres

import "testing"

func TestPartnerCommissionReceivableOffset(t *testing.T) {
	tests := []struct {
		name            string
		partnerNetMinor int64
		receivableMinor int64
		wantOffsetMinor int64
		wantError       error
	}{
		{name: "no outstanding receivable", partnerNetMinor: 900, receivableMinor: 0, wantOffsetMinor: 0},
		{name: "partial offset", partnerNetMinor: 900, receivableMinor: 200, wantOffsetMinor: 200},
		{name: "exact offset", partnerNetMinor: 200, receivableMinor: 200, wantOffsetMinor: 200},
		{name: "receivable cannot exceed partner earnings", partnerNetMinor: 200, receivableMinor: 900, wantOffsetMinor: 200},
		{name: "negative partner earnings rejected", partnerNetMinor: -1, receivableMinor: 100, wantError: ErrPartnerEarningInvalidInput},
		{name: "negative receivable rejected", partnerNetMinor: 100, receivableMinor: -1, wantError: ErrPartnerEarningInvalidInput},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, err := partnerCommissionReceivableOffset(test.partnerNetMinor, test.receivableMinor)
			if err != test.wantError || got != test.wantOffsetMinor {
				t.Fatalf("partnerCommissionReceivableOffset() = (%d, %v), want (%d, %v)", got, err, test.wantOffsetMinor, test.wantError)
			}
		})
	}
}
