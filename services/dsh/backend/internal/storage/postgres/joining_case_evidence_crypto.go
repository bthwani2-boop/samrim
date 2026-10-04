package postgres

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
)

type joiningCaseEvidenceKey struct {
	aead cipher.AEAD
	mac  []byte
}

// JoiningCaseEvidenceKeyring encrypts onboarding evidence independently from
// delivery proof keys. Old keys remain available while evidence is retained.
type JoiningCaseEvidenceKeyring struct {
	activeKeyID string
	keys        map[string]joiningCaseEvidenceKey
}

func NewJoiningCaseEvidenceKeyringFromEnv(activeKeyID, encodedKeyring string) (*JoiningCaseEvidenceKeyring, error) {
	var keys map[string]string
	if err := json.Unmarshal([]byte(strings.TrimSpace(encodedKeyring)), &keys); err != nil {
		return nil, errors.New("DSH_JOINING_CASE_EVIDENCE_KEYRING must be a JSON object of key IDs to base64 keys")
	}
	return NewJoiningCaseEvidenceKeyring(activeKeyID, keys)
}

func NewJoiningCaseEvidenceKeyring(activeKeyID string, encodedKeys map[string]string) (*JoiningCaseEvidenceKeyring, error) {
	activeKeyID = strings.TrimSpace(activeKeyID)
	if !deliveryProofKeyIDPattern.MatchString(activeKeyID) || len(encodedKeys) == 0 {
		return nil, errors.New("DSH joining-case evidence key configuration is invalid")
	}
	keys := make(map[string]joiningCaseEvidenceKey, len(encodedKeys))
	for id, encoded := range encodedKeys {
		id = strings.TrimSpace(id)
		encoded = strings.TrimSpace(strings.TrimPrefix(encoded, "base64:"))
		if !deliveryProofKeyIDPattern.MatchString(id) {
			return nil, errors.New("DSH joining-case evidence key ID is invalid")
		}
		master, err := base64.StdEncoding.DecodeString(encoded)
		if err != nil || len(master) != 32 {
			return nil, fmt.Errorf("DSH joining-case evidence key %q must be a base64-encoded 32-byte key", id)
		}
		encKey := deriveJoiningCaseEvidenceKey(master, "encryption")
		block, err := aes.NewCipher(encKey)
		if err != nil {
			return nil, fmt.Errorf("create DSH joining-case evidence cipher: %w", err)
		}
		aead, err := cipher.NewGCM(block)
		if err != nil {
			return nil, fmt.Errorf("create DSH joining-case evidence AEAD: %w", err)
		}
		keys[id] = joiningCaseEvidenceKey{aead: aead, mac: deriveJoiningCaseEvidenceKey(master, "request-hash")}
	}
	if _, ok := keys[activeKeyID]; !ok {
		return nil, errors.New("DSH active joining-case evidence key is missing from the keyring")
	}
	return &JoiningCaseEvidenceKeyring{activeKeyID: activeKeyID, keys: keys}, nil
}

func deriveJoiningCaseEvidenceKey(master []byte, purpose string) []byte {
	mac := hmac.New(sha256.New, master)
	_, _ = io.WriteString(mac, "bthwani/dsh/joining-case-evidence/v1/"+purpose)
	return mac.Sum(nil)
}

func (k *JoiningCaseEvidenceKeyring) Encrypt(scope, purpose string, plaintext []byte) (string, []byte, error) {
	if k == nil || strings.TrimSpace(scope) == "" || strings.TrimSpace(purpose) == "" || len(plaintext) == 0 {
		return "", nil, errors.New("DSH joining-case evidence encryption input is invalid")
	}
	key := k.keys[k.activeKeyID]
	nonce := make([]byte, key.aead.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", nil, fmt.Errorf("generate DSH joining-case evidence nonce: %w", err)
	}
	sealed := key.aead.Seal(nonce, nonce, plaintext, joiningCaseEvidenceAAD(scope, purpose))
	return k.activeKeyID, sealed, nil
}

func (k *JoiningCaseEvidenceKeyring) Decrypt(scope, purpose, keyID string, ciphertext []byte) ([]byte, error) {
	if k == nil || strings.TrimSpace(scope) == "" || strings.TrimSpace(purpose) == "" || len(ciphertext) == 0 {
		return nil, errors.New("DSH joining-case evidence ciphertext is unavailable")
	}
	key, ok := k.keys[keyID]
	if !ok || len(ciphertext) < key.aead.NonceSize()+key.aead.Overhead() {
		return nil, errors.New("DSH joining-case evidence key is unavailable")
	}
	nonce, payload := ciphertext[:key.aead.NonceSize()], ciphertext[key.aead.NonceSize():]
	plaintext, err := key.aead.Open(nil, nonce, payload, joiningCaseEvidenceAAD(scope, purpose))
	if err != nil {
		return nil, errors.New("DSH joining-case evidence ciphertext authentication failed")
	}
	return plaintext, nil
}

func joiningCaseEvidenceAAD(scope, purpose string) []byte {
	return []byte("dsh-joining-case-evidence-v1\x00" + strings.TrimSpace(scope) + "\x00" + strings.TrimSpace(purpose))
}

func (k *JoiningCaseEvidenceKeyring) RequestHash(purpose string, facts ...string) (string, error) {
	if k == nil || strings.TrimSpace(purpose) == "" {
		return "", errors.New("DSH joining-case evidence request hash input is invalid")
	}
	key, ok := k.keys[k.activeKeyID]
	if !ok {
		return "", errors.New("DSH joining-case evidence active key is unavailable")
	}
	values := append([]string{"dsh-joining-case-evidence-request-v1", strings.TrimSpace(purpose)}, facts...)
	mac := hmac.New(sha256.New, key.mac)
	_, _ = io.WriteString(mac, strings.Join(values, "\x00"))
	return "v1." + k.activeKeyID + "." + hex.EncodeToString(mac.Sum(nil)), nil
}

func (k *JoiningCaseEvidenceKeyring) VerifyRequestHash(stored, purpose string, facts ...string) bool {
	parts := strings.Split(stored, ".")
	if k == nil || len(parts) != 3 || parts[0] != "v1" {
		return false
	}
	key, ok := k.keys[parts[1]]
	if !ok {
		return false
	}
	values := append([]string{"dsh-joining-case-evidence-request-v1", strings.TrimSpace(purpose)}, facts...)
	mac := hmac.New(sha256.New, key.mac)
	_, _ = io.WriteString(mac, strings.Join(values, "\x00"))
	expected := "v1." + parts[1] + "." + hex.EncodeToString(mac.Sum(nil))
	return len(stored) == len(expected) && subtle.ConstantTimeCompare([]byte(stored), []byte(expected)) == 1
}

func (k *JoiningCaseEvidenceKeyring) HasKey(keyID string) bool {
	if k == nil {
		return false
	}
	_, ok := k.keys[keyID]
	return ok
}

func VerifyJoiningCaseEvidenceKeyring(ctx context.Context, db *sql.DB, keys *JoiningCaseEvidenceKeyring) error {
	if db == nil || keys == nil {
		return errors.New("DSH joining-case evidence keyring is unavailable")
	}
	rows, err := db.QueryContext(ctx, `SELECT DISTINCT key_id FROM (
		SELECT proof_number_key_id AS key_id FROM dsh.joining_case_private_evidence WHERE proof_number_ciphertext IS NOT NULL
		UNION ALL
		SELECT proof_image_key_id AS key_id FROM dsh.joining_case_private_evidence WHERE proof_image_ciphertext IS NOT NULL
	) AS referenced_keys WHERE key_id IS NOT NULL`)
	if err != nil {
		return fmt.Errorf("read DSH joining-case evidence key references: %w", err)
	}
	defer func() { _ = rows.Close() }()
	for rows.Next() {
		var keyID string
		if err := rows.Scan(&keyID); err != nil {
			return fmt.Errorf("scan DSH joining-case evidence key reference: %w", err)
		}
		if !keys.HasKey(keyID) {
			return fmt.Errorf("DSH joining-case evidence keyring is missing referenced key %q", keyID)
		}
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("read DSH joining-case evidence key references: %w", err)
	}
	return nil
}
