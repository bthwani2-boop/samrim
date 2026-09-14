package authentication

import (
	"encoding/base64"
	"fmt"
	"testing"

	identitysecurity "github.com/bthwani2-boop/samrim/services/identity/backend/internal/security"
	"golang.org/x/crypto/argon2"
)

func TestPasswordAcceptedForLoginRejectsValidLegacyLength(t *testing.T) {
	legacyPassword := "Legacy-Password-9"
	salt := []byte("legacy-salt-1234")
	key := argon2.IDKey([]byte(legacyPassword), salt, 3, 64*1024, 2, 32)
	hash := fmt.Sprintf(
		"$argon2id$v=19$m=65536,t=3,p=2$%s$%s",
		base64.RawStdEncoding.EncodeToString(salt),
		base64.RawStdEncoding.EncodeToString(key),
	)

	if !identitysecurity.VerifyPassword(hash, legacyPassword) {
		t.Fatal("test fixture did not produce a valid legacy password hash")
	}
	if passwordAcceptedForLogin(hash, legacyPassword) {
		t.Fatal("legacy valid hash accepted a password outside the exact-eight policy")
	}
}
