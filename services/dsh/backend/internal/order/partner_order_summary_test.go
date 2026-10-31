package order

import (
	"testing"
	"time"
)

func TestPartnerOrderSummaryStartRequiresCanonicalPeriod(t *testing.T) {
	now := time.Date(2026, time.October, 31, 12, 30, 0, 0, time.FixedZone("Aden", 3*60*60))
	all, err := partnerOrderSummaryStart("all", now)
	if err != nil || all != nil {
		t.Fatalf("all-history period must have no lower bound: %v %v", all, err)
	}
	for _, tt := range []struct {
		name string
		days int
	}{{"7d", 7}, {"30d", 30}} {
		start, err := partnerOrderSummaryStart(tt.name, now)
		if err != nil || start == nil {
			t.Fatalf("%s lower bound missing %v", tt.name, err)
		}
		expected := now.UTC().Add(-time.Duration(tt.days) * 24 * time.Hour)
		if !start.Equal(expected) || start.Location() != time.UTC {
			t.Fatalf("%s: got %v want %v", tt.name, start, expected)
		}
	}
	for _, invalid := range []string{"", "month", "90d", "ALL", " 7d"} {
		start, err := partnerOrderSummaryStart(invalid, now)
		if err == nil || start != nil {
			t.Fatalf("invalid %q accepted: %v %v", invalid, start, err)
		}
	}
}
