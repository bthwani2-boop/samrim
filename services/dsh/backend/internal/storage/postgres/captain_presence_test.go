package postgres

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestCaptainOpportunityIntensityHasNoExactCounts(t *testing.T) {
	for _, tc := range []struct {
		count int64
		want  string
	}{{6, "LOW"}, {9, "LOW"}, {10, "MEDIUM"}, {19, "MEDIUM"}, {20, "HIGH"}} {
		if got := captainOpportunityIntensity(tc.count); got != tc.want {
			t.Fatalf("order count %d intensity=%q, want %q", tc.count, got, tc.want)
		}
	}
	sample := CaptainOpportunityHeatmap{
		Cells:      []CaptainOpportunityCell{{Latitude: 15.35, Longitude: 44.15, Intensity: "LOW", Kind: "ORDERS"}, {Latitude: 15.35, Longitude: 44.15, Intensity: "MEDIUM", Kind: "CAPTAINS"}},
		MeasuredAt: time.Now().UTC(), SampleStatus: "AVAILABLE",
		SignalType: "RECENT_ACTIVITY", PolicyVersion: "RECENT_COARSE_V2",
	}
	b, err := json.Marshal(sample)
	if err != nil {
		t.Fatal(err)
	}
	for _, leaked := range []string{"orderId", "storeId", "captainActorId", "clientActorId", "count", "customerAddress", "addressText"} {
		if strings.Contains(string(b), leaked) {
			t.Fatalf("opportunity map leaked source detail %s", leaked)
		}
	}
}
