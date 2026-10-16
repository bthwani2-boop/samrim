package postgres

import (
	"math"
	"testing"
)

func ptrMeters(n int64) *int64 { return &n }
func TestProgressiveDeliveryDistanceBands(t *testing.T) {
	bands := []DeliveryDistanceBand{{UpToMeters: ptrMeters(500), RatePerKmMinor: 150}, {UpToMeters: ptrMeters(5000), RatePerKmMinor: 120}, {UpToMeters: nil, RatePerKmMinor: 100}}
	for _, tc := range []struct{ meters, expected int64 }{
		{0, 0}, {250, 38}, {500, 75}, {501, 76}, {1000, 135}, {5000, 615}, {5001, 616}, {6000, 715}, {20000, 2115},
	} {
		got, err := calculateDistanceBandFee(tc.meters, bands)
		if err != nil || got != tc.expected {
			t.Fatalf("distance=%dm got=%d want=%d err=%v", tc.meters, got, tc.expected, err)
		}
	}
	// Never permit a boundary to reduce the quoted total.
	var previous int64
	for metres := int64(0); metres < 20001; metres += 7 {
		value, err := calculateDistanceBandFee(metres, bands)
		if err != nil || value < previous {
			t.Fatalf("nonmonotonic price %d -> %d: %v", previous, value, err)
		}
		previous = value
	}
}
func TestDeliveryDistanceBandsRejectInvalidTiers(t *testing.T) {
	valid := []DeliveryDistanceBand{{UpToMeters: ptrMeters(500), RatePerKmMinor: 150}, {UpToMeters: nil, RatePerKmMinor: 120}}
	for _, bad := range [][]DeliveryDistanceBand{
		nil, {}, {{UpToMeters: ptrMeters(500), RatePerKmMinor: 150}},
		{{UpToMeters: nil, RatePerKmMinor: 0}},
		{{UpToMeters: ptrMeters(500), RatePerKmMinor: 150}, {UpToMeters: ptrMeters(1000), RatePerKmMinor: 120}},
		{{UpToMeters: ptrMeters(500), RatePerKmMinor: 150}, {UpToMeters: ptrMeters(400), RatePerKmMinor: 120}, {UpToMeters: nil, RatePerKmMinor: 90}},
		{{UpToMeters: ptrMeters(0), RatePerKmMinor: 150}, {UpToMeters: nil, RatePerKmMinor: 120}},
		{{UpToMeters: ptrMeters(500), RatePerKmMinor: 150}, {UpToMeters: nil, RatePerKmMinor: 0}},
	} {
		if validDeliveryDistanceBands(bad) {
			t.Fatalf("accepted invalid tiers %+v", bad)
		}
	}
	if !validDeliveryDistanceBands(valid) {
		t.Fatal("valid policy rejected")
	}
	if _, err := calculateDistanceBandFee(math.MaxInt64, []DeliveryDistanceBand{{UpToMeters: nil, RatePerKmMinor: 100000000}}); err == nil {
		t.Fatal("overflow must be rejected")
	}
}
