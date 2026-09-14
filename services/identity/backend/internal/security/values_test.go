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
	if _, err := NormalizeClientInstanceId("short"); err == nil {
		t.Fatal("short client instance id accepted")
	}
	if value, err := NormalizeClientInstanceId("device-12345678"); err != nil || value != "device-12345678" {
		t.Fatalf("valid client instance id rejected: %q %v", value, err)
	}
	if value, err := NormalizeVerificationCode("123456"); err != nil || value != "123456" {
		t.Fatalf("valid verification code rejected: %q %v", value, err)
	}
	if _, err := NormalizeVerificationCode("12345"); err == nil {
		t.Fatal("invalid verification code accepted")
	}
	if _, err := NormalizeEnrollmentToken("0123"); err == nil {
		t.Fatal("short enrollment token accepted")
	}
	if _, err := NormalizeEnrollmentToken("A12345"); err == nil {
		t.Fatal("short enrollment token accepted")
	}
	enrollmentToken, err := RandomEnrollmentToken()
	if err != nil {
		t.Fatal(err)
	}
	if value, err := NormalizeEnrollmentToken(enrollmentToken); err != nil || value != enrollmentToken {
		t.Fatalf("valid enrollment token rejected: %q %v", value, err)
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

func TestRandomEnrollmentTokenIsHighEntropy(t *testing.T) {
	token, err := RandomEnrollmentToken()
	if err != nil {
		t.Fatal(err)
	}
	if value, err := NormalizeEnrollmentToken(token); err != nil || value != token || len(token) < 24 {
		t.Fatalf("unexpected enrollment token: %q %v", token, err)
	}
}

func TestPasswordPolicyUsesExactUnicodeCodePointsAndRejectsWeakValues(t *testing.T) {
	if PasswordBlocklistVersion() != "identity-passwords-v3" || len(passwordBlocklistGenerated) != 15 {
		t.Fatal("versioned local password blocklist is missing or too small")
	}
	for _, password := range []string{"12345678", "password", "qwertyui"} {
		if PasswordAllowed(password) {
			t.Fatalf("blocklisted password accepted: %q", password)
		}
	}
	for _, password := range []string{"1234567", "123456789", "River123", "你好世界1234"} {
		if PasswordAllowed(password) != (password == "River123" || password == "你好世界1234") {
			t.Fatalf("unexpected exact-eight password decision: %q", password)
		}
	}
	decomposed := "Cafe\u0301-12"
	composed := "Café-12"
	if !PasswordAllowed(decomposed) {
		t.Fatal("an exact-eight decomposed Unicode password was rejected")
	}
	if PasswordAllowed("Cafe\u0301-123") {
		t.Fatal("a nine-code-point decomposed password was accepted after normalization")
	}
	hash := mustHashPassword(t, decomposed)
	if !VerifyPassword(hash, decomposed) {
		t.Fatal("the exact entered password was not accepted")
	}
	if VerifyPassword(hash, composed) {
		t.Fatal("a composed password was accepted as an equivalent to the decomposed password")
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
	password := "River123"
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
	if NeedsPasswordRehash(hash) {
		t.Fatal("current Argon2id parameters incorrectly marked for rehash")
	}
	if !NeedsPasswordRehash(strings.Replace(hash, "m=65536", "m=32768", 1)) {
		t.Fatal("legacy Argon2id parameters were not marked for rehash")
	}
}
