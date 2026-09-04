package security

import "testing"

func TestNormalizePhoneE164(t *testing.T) {
	for raw, expected := range map[string]string{
		"777000001":        "+967777000001",
		"967777000001":     "+967777000001",
		"00967777000001":   "+967777000001",
		"+967 777-000-001": "+967777000001",
	} {
		actual, err := NormalizePhoneE164(raw)
		if err != nil || actual != expected {
			t.Fatalf("NormalizePhoneE164(%q)=%q,%v want %q", raw, actual, err, expected)
		}
	}
	if _, err := NormalizePhoneE164("not-a-phone"); err == nil {
		t.Fatal("invalid phone accepted")
	}
}

func TestIdentityInputNormalization(t *testing.T) {
	if username, err := NormalizeUsername(" Captain.One "); err != nil || username != "captain.one" {
		t.Fatalf("unexpected username %q err=%v", username, err)
	}
	if _, err := NormalizeUsername("Captain One"); err == nil {
		t.Fatal("username containing spaces accepted")
	}
	if _, err := NormalizeDeviceFingerprint("short"); err == nil {
		t.Fatal("short device fingerprint accepted")
	}
	if value, err := NormalizeDeviceFingerprint("device-12345678"); err != nil || value != "device-12345678" {
		t.Fatalf("valid fingerprint rejected: %q %v", value, err)
	}
}

func TestOpaqueSecurityValues(t *testing.T) {
	tokenA, err := RandomToken(32)
	if err != nil || len(tokenA) < 32 {
		t.Fatalf("token generation failed: %v", err)
	}
	tokenB, err := RandomToken(32)
	if err != nil || tokenA == tokenB {
		t.Fatalf("tokens are not independently random: %v", err)
	}
	if HMAC256Hex([]byte("01234567890123456789012345678901"), "a") == HMAC256Hex([]byte("01234567890123456789012345678901"), "b") {
		t.Fatal("HMAC does not distinguish payloads")
	}
}
