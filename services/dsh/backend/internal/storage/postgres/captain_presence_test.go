package postgres

import "testing"

func TestCaptainPresenceHeatmapModes(t *testing.T) {
	for _, tc := range []struct {
		mode string
		size float64
	}{
		{"wide", .10}, {"balanced", .05}, {"detailed", .025},
	} {
		got, ok := captainPresenceCellSize(tc.mode)
		if !ok || got != tc.size {
			t.Fatalf("%s: %g/%v", tc.mode, got, ok)
		}
	}
	for _, mode := range []string{"", "unknown", "live", "detailed;delete"} {
		if _, ok := captainPresenceCellSize(mode); ok {
			t.Fatalf("accepted %s", mode)
		}
	}
}
