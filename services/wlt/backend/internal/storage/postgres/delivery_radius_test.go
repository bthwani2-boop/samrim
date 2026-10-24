package postgres

import "testing"

func TestDeliveryQuoteRejectsOutsideOperatingRadius(t *testing.T) {
	for _, tc := range []struct {
		distance int64
		eligible bool
	}{
		{0, true}, {500, true}, {20_000, true}, {30_000, true}, {30_001, false}, {140_000, false}, {-1, false},
	} {
		if got := deliveryDistanceWithinCoverage(tc.distance); got != tc.eligible {
			t.Fatalf("distance=%d got=%t want=%t", tc.distance, got, tc.eligible)
		}
	}
	near := haversineMeters(15.3694457, 44.1910064, 15.37, 44.19)
	far := haversineMeters(15.3694457, 44.1910064, 16.63, 44.19)
	if !deliveryDistanceWithinCoverage(near) || deliveryDistanceWithinCoverage(far) {
		t.Fatalf("real geography near=%dm far=%dm incorrectly authorized", near, far)
	}
}
