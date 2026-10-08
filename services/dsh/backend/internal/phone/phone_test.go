package phone

import "testing"

func TestNormalizeYemenE164(t *testing.T) {
	tests := map[string]string{
		"777123456":         "+967777123456",
		"0777123456":        "+967777123456",
		"967777123456":      "+967777123456",
		"00967 777-123-456": "+967777123456",
		"+967 777-123-456":  "+967777123456",
		"+1 202 555 0100":   "+12025550100",
		"+٩٦٧ ٧٧٧-١٢٣-٤٥٦":  "+967777123456",
	}
	for input, want := range tests {
		if got := NormalizeYemenE164(input); got != want {
			t.Fatalf("NormalizeYemenE164(%q)=%q, want %q", input, got, want)
		}
	}
}

func TestIsE164(t *testing.T) {
	if !IsE164("+967777123456") || !IsE164("+12025550100") {
		t.Fatal("valid E.164 numbers were rejected")
	}
	if IsE164("777123456") || IsE164("+967 777123456") {
		t.Fatal("non-canonical phone was accepted as E.164")
	}
}
