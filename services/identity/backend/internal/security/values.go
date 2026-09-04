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

	"golang.org/x/crypto/bcrypt"
)

var (
	phonePattern      = regexp.MustCompile(`^\+[1-9][0-9]{7,14}$`)
	usernamePattern   = regexp.MustCompile(`^[a-z0-9][a-z0-9._-]{0,63}$`)
	actorIDPattern    = regexp.MustCompile(`^[a-z][A-Za-z0-9._:-]{1,127}$`)
	devicePattern     = regexp.MustCompile(`^[A-Za-z0-9._:-]{8,256}$`)
	activationPattern = regexp.MustCompile(`^[0-9]{6}$`)
	ErrInvalidValue   = errors.New("invalid identity value")
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

func NormalizeUsername(raw string) (string, error) {
	username := strings.ToLower(strings.TrimSpace(raw))
	if !usernamePattern.MatchString(username) {
		return "", ErrInvalidValue
	}
	return username, nil
}

func NormalizeActorID(raw, role string) (string, error) {
	actorID := strings.TrimSpace(raw)
	if actorID == "" {
		return "", nil
	}
	role = strings.ToLower(strings.TrimSpace(role))
	if !actorIDPattern.MatchString(actorID) || !strings.HasPrefix(actorID, role+"-") {
		return "", ErrInvalidValue
	}
	return actorID, nil
}

func NormalizeDeviceFingerprint(raw string) (string, error) {
	fingerprint := strings.TrimSpace(raw)
	if !devicePattern.MatchString(fingerprint) {
		return "", ErrInvalidValue
	}
	return fingerprint, nil
}

func NormalizeActivationCode(raw string) (string, error) {
	code := strings.TrimSpace(raw)
	if !activationPattern.MatchString(code) {
		return "", ErrInvalidValue
	}
	return code, nil
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

func RandomActivationCode() (string, error) {
	buffer := make([]byte, 4)
	if _, err := rand.Read(buffer); err != nil {
		return "", err
	}
	value := (uint32(buffer[0])<<24 | uint32(buffer[1])<<16 | uint32(buffer[2])<<8 | uint32(buffer[3])) % 1000000
	return fmt.Sprintf("%06d", value), nil
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
	password = strings.TrimSpace(password)
	if len(password) < 12 || len(password) > 128 {
		return "", ErrInvalidValue
	}
	hashed, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return "", err
	}
	return string(hashed), nil
}

func VerifyPassword(hash, password string) bool {
	if strings.TrimSpace(hash) == "" || strings.TrimSpace(password) == "" {
		return false
	}
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) == nil
}

func MaskPhone(phone string) string {
	if len(phone) <= 6 {
		return "***"
	}
	return phone[:4] + strings.Repeat("*", len(phone)-7) + phone[len(phone)-3:]
}
