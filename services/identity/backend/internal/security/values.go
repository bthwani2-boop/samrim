package security

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"unicode/utf8"

	"golang.org/x/crypto/argon2"
	"golang.org/x/text/unicode/norm"
)

var (
	phonePattern            = regexp.MustCompile("^\\+[1-9][0-9]{7,14}$")
	devicePattern           = regexp.MustCompile("^[A-Za-z0-9._:-]{8,256}$")
	verificationCodePattern = regexp.MustCompile("^[0-9]{6}$")
	enrollmentTokenPattern  = regexp.MustCompile("^[A-Za-z0-9_-]{24,256}$")
	ErrInvalidValue         = errors.New("invalid identity value")
)

const (
	argonMemory  uint32 = 64 * 1024
	argonTime    uint32 = 3
	argonThreads uint8  = 2
	argonKeyLen  uint32 = 32
)

func NormalizePhoneE164(raw string) (string, error) {
	phone := strings.TrimSpace(raw)
	replacer := strings.NewReplacer(" ", "", "-", "", "(", "", ")", "")
	phone = replacer.Replace(phone)
	switch {
	case strings.HasPrefix(phone, "00"):
		phone = "+" + strings.TrimPrefix(phone, "00")
	case strings.HasPrefix(phone, "967"):
		phone = "+" + phone
	case strings.HasPrefix(phone, "7"):
		phone = "+967" + phone
	}
	if !phonePattern.MatchString(phone) {
		return "", ErrInvalidValue
	}
	return phone, nil
}

func NormalizeDeviceFingerprint(raw string) (string, error) {
	fingerprint := strings.TrimSpace(raw)
	if !devicePattern.MatchString(fingerprint) {
		return "", ErrInvalidValue
	}
	return fingerprint, nil
}

func NormalizeVerificationCode(raw string) (string, error) {
	code := strings.TrimSpace(raw)
	if !verificationCodePattern.MatchString(code) {
		return "", ErrInvalidValue
	}
	return code, nil
}

func NormalizeEnrollmentToken(raw string) (string, error) {
	token := strings.TrimSpace(raw)
	if !enrollmentTokenPattern.MatchString(token) {
		return "", ErrInvalidValue
	}
	return token, nil
}

func RandomToken(byteCount int) (string, error) {
	if byteCount < 16 {
		return "", fmt.Errorf("token entropy too small")
	}
	buffer := make([]byte, byteCount)
	if _, err := rand.Read(buffer); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buffer), nil
}

func RandomEnrollmentToken() (string, error) {
	return RandomToken(24)
}

func SHA256Hex(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}

func HMAC256Hex(secret []byte, parts ...string) string {
	mac := hmac.New(sha256.New, secret)
	for index, part := range parts {
		if index > 0 {
			_, _ = mac.Write([]byte{0})
		}
		_, _ = mac.Write([]byte(part))
	}
	return hex.EncodeToString(mac.Sum(nil))
}

func ConstantTimeHexEqual(a, b string) bool {
	return hmac.Equal([]byte(a), []byte(b))
}

func HashPassword(password string) (string, error) {
	password = NormalizePassword(password)
	if !PasswordAllowed(password) {
		return "", ErrInvalidValue
	}
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	key := argon2.IDKey([]byte(password), salt, argonTime, argonMemory, argonThreads, argonKeyLen)
	return fmt.Sprintf(
		"$argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s",
		argon2.Version,
		argonMemory,
		argonTime,
		argonThreads,
		base64.RawStdEncoding.EncodeToString(salt),
		base64.RawStdEncoding.EncodeToString(key),
	), nil
}

func NormalizePassword(password string) string {
	return norm.NFC.String(password)
}

func PasswordAllowed(password string) bool {
	password = NormalizePassword(password)
	if !utf8.ValidString(password) {
		return false
	}
	length := utf8.RuneCountInString(password)
	if length < 15 || length > 128 || strings.TrimSpace(password) == "" {
		return false
	}
	return !isCommonPassword(password)
}

func isCommonPassword(password string) bool {
	return passwordInBlocklist(strings.ToLower(password))
}

func VerifyPassword(encoded, password string) bool {
	if encoded == "" || password == "" {
		return false
	}
	password = NormalizePassword(password)
	parts := strings.Split(encoded, "$")
	if len(parts) != 6 || parts[1] != "argon2id" {
		return false
	}
	var version int
	if _, err := fmt.Sscanf(parts[2], "v=%d", &version); err != nil || version != argon2.Version {
		return false
	}
	var memory, iterations uint32
	var threads uint8
	if _, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &memory, &iterations, &threads); err != nil {
		return false
	}
	if memory == 0 || iterations == 0 || threads == 0 || memory > 256*1024 || iterations > 10 || threads > 16 {
		return false
	}
	salt, err := base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil || len(salt) < 16 {
		return false
	}
	expected, err := base64.RawStdEncoding.DecodeString(parts[5])
	if err != nil || len(expected) < 16 || len(expected) > 64 {
		return false
	}
	actual := argon2.IDKey([]byte(password), salt, iterations, memory, threads, uint32(len(expected)))
	return hmac.Equal(actual, expected)
}

func MaskPhone(phone string) string {
	if len(phone) <= 6 {
		return "***"
	}
	return phone[:4] + strings.Repeat("*", len(phone)-7) + phone[len(phone)-3:]
}
