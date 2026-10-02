package field

import "testing"

func TestNormalizePhoneE164(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  string
	}{
		{name: "arabic-indic digits and separators", input: "+٩٦٧ ٧٧٠-٠٠١٠٠", want: "+96777000100"},
		{name: "eastern arabic digits", input: "+۹۶۷ (۷۷۰) ۰۰۱۰۰", want: "+96777000100"},
		{name: "ascii unchanged", input: "+96777000100", want: "+96777000100"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := normalizePhoneE164(tt.input); got != tt.want {
				t.Fatalf("normalizePhoneE164(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}
