package transporthttp

import "testing"

func TestOperatorAnalyticsDaysStrictFilter(t *testing.T) {
	cases := []struct {
		name      string
		values    []string
		wantDays  int
		wantValid bool
	}{
		{"default", nil, 7, true},
		{"seven", []string{"7d"}, 7, true},
		{"thirty", []string{"30d"}, 30, true},
		{"empty", []string{""}, 0, false},
		{"other", []string{"90d"}, 0, false},
		{"repeated", []string{"7d", "30d"}, 0, false},
		{"uppercase", []string{"30D"}, 0, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			days, valid := operatorAnalyticsDays(tc.values)
			if days != tc.wantDays || valid != tc.wantValid {
				t.Fatalf("operatorAnalyticsDays(%v) = (%d, %v), want (%d, %v)", tc.values, days, valid, tc.wantDays, tc.wantValid)
			}
		})
	}
}
