package joiningcase

import "testing"

func TestFieldScopeAdmitsServiceCity(t *testing.T) {
	cases := []struct {
		name    string
		all     bool
		allowed []string
		city    string
		want    bool
	}{
		{"exact", false, []string{"sanaa"}, "sanaa", true},
		{"wrong city", false, []string{"ibb"}, "sanaa", false},
		{"empty permitted", false, nil, "sanaa", false},
		{"all", true, nil, "sanaa", true},
		{"missing case city", true, nil, "", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := fieldScopeAdmitsServiceCity(tc.all, tc.allowed, tc.city)
			if got != tc.want {
				t.Fatalf("got=%v want=%v", got, tc.want)
			}
		})
	}
}
