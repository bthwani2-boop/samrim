package security

import (
	"strings"
	"testing"
)

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
	if _, err := NormalizeDeviceFingerprint("short"); err == nil {
		t.Fatal("short device fingerprint accepted")
	}
	if value, err := NormalizeDeviceFingerprint("device-12345678"); err != nil || value != "device-12345678" {
		t.Fatalf("valid fingerprint rejected: %q %v", value, err)
	}
	if value, err := NormalizeVerificationCode("123456"); err != nil || value != "123456" {
		t.Fatalf("valid verification code rejected: %q %v", value, err)
	}
	if _, err := NormalizeVerificationCode("12345"); err == nil {
		t.Fatal("invalid verification code accepted")
	}
	if _, err := NormalizeActivationCode("0123"); err == nil {
		t.Fatal("short activation code accepted")
	}
	if _, err := NormalizeActivationCode("A12345"); err == nil {
		t.Fatal("non-numeric activation code accepted")
	}
	activationCode, err := RandomActivationCode()
	if err != nil {
		t.Fatal(err)
	}
	if value, err := NormalizeActivationCode(activationCode); err != nil || value != activationCode {
		t.Fatalf("valid activation code rejected: %q %v", value, err)
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

func TestRandomActivationCodeIsSixDigits(t *testing.T) {
	code, err := RandomActivationCode()
	if err != nil {
		t.Fatal(err)
	}
	if value, err := NormalizeActivationCode(code); err != nil || value != code || len(code) != 6 {
		t.Fatalf("unexpected activation code: %q %v", code, err)
	}
}

func TestPasswordPolicyNormalizesUnicodeAndRejectsWeakValues(t *testing.T) {
	if PasswordAllowed("123456789012345") {
		t.Fatal("common password accepted")
	}
	if PasswordAllowed("short") {
		t.Fatal("short password accepted")
	}
	if _, err := HashPassword("Cafe\u0301-Long-Password"); err != nil || !VerifyPassword(mustHashPassword(t, "Café-Long-Password"), "Cafe\u0301-Long-Password") {
		t.Fatal("NFC password normalization failed")
	}
}

func mustHashPassword(t *testing.T, password string) string {
	t.Helper()
	hash, err := HashPassword(password)
	if err != nil {
		t.Fatal(err)
	}
	return hash
}

func TestArgon2idPasswordHashing(t *testing.T) {
	password := "Correct-Horse-Battery-Staple"
	hash, err := HashPassword(password)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(hash, "$argon2id$") {
		t.Fatalf("unexpected password hash format: %s", hash)
	}
	if !VerifyPassword(hash, password) {
		t.Fatal("valid password rejected")
	}
	if VerifyPassword(hash, password+"-wrong") {
		t.Fatal("invalid password accepted")
	}
}
