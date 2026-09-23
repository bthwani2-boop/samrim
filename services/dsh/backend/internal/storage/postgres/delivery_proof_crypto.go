package postgres

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"regexp"
	"strings"
)

var deliveryProofKeyIDPattern = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,32}$`)

type deliveryProofKey struct {
	aead        cipher.AEAD
	verifier    []byte
	idempotency []byte
}

// DeliveryProofKeyring keeps active proof material reversible only while a code
// is pending. Old keys remain available for active proofs and idempotent retries
// during a key rotation.
type DeliveryProofKeyring struct {
	activeKeyID string
	keys        map[string]deliveryProofKey
}

func NewDeliveryProofKeyring(activeKeyID string, encodedKeys map[string]string) (*DeliveryProofKeyring, error) {
	activeKeyID = strings.TrimSpace(activeKeyID)
	if !deliveryProofKeyIDPattern.MatchString(activeKeyID) || len(encodedKeys) == 0 {
		return nil, errors.New("DSH delivery proof key configuration is invalid")
	}
	keys := make(map[string]deliveryProofKey, len(encodedKeys))
	for keyID, encoded := range encodedKeys {
		keyID = strings.TrimSpace(keyID)
		if !deliveryProofKeyIDPattern.MatchString(keyID) {
			return nil, errors.New("DSH delivery proof key ID is invalid")
		}
		encoded = strings.TrimSpace(encoded)
		if strings.HasPrefix(encoded, "base64:") {
			encoded = strings.TrimPrefix(encoded, "base64:")
		}
		master, err := base64.StdEncoding.DecodeString(encoded)
		if err != nil || len(master) != 32 {
			return nil, fmt.Errorf("DSH delivery proof key %q must be a base64-encoded 32-byte key", keyID)
		}
		encryptionKey := deriveDeliveryProofKey(master, "encryption")
		block, err := aes.NewCipher(encryptionKey)
		if err != nil {
			return nil, fmt.Errorf("create DSH delivery proof cipher: %w", err)
		}
		aead, err := cipher.NewGCM(block)
		if err != nil {
			return nil, fmt.Errorf("create DSH delivery proof AEAD: %w", err)
		}
		keys[keyID] = deliveryProofKey{
			aead:        aead,
			verifier:    deriveDeliveryProofKey(master, "verifier"),
			idempotency: deriveDeliveryProofKey(master, "idempotency"),
		}
	}
	if _, ok := keys[activeKeyID]; !ok {
		return nil, errors.New("DSH active delivery proof key is missing from the keyring")
	}
	return &DeliveryProofKeyring{activeKeyID: activeKeyID, keys: keys}, nil
}

func NewDeliveryProofKeyringFromEnv(activeKeyID, encodedKeyring string) (*DeliveryProofKeyring, error) {
	var keys map[string]string
	if err := json.Unmarshal([]byte(strings.TrimSpace(encodedKeyring)), &keys); err != nil {
		return nil, errors.New("DSH_DELIVERY_PROOF_KEYRING must be a JSON object of key IDs to base64 keys")
	}
	return NewDeliveryProofKeyring(activeKeyID, keys)
}

func deriveDeliveryProofKey(master []byte, purpose string) []byte {
	mac := hmac.New(sha256.New, master)
	_, _ = io.WriteString(mac, "bthwani/dsh/delivery-proof/v1/"+purpose)
	return mac.Sum(nil)
}

func (k *DeliveryProofKeyring) Encrypt(orderID, code string) (string, string, error) {
	if k == nil || strings.TrimSpace(orderID) == "" || !validDeliveryProofCode(code) {
		return "", "", errors.New("DSH delivery proof encryption input is invalid")
	}
	key := k.keys[k.activeKeyID]
	nonce := make([]byte, key.aead.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", "", fmt.Errorf("generate DSH delivery proof nonce: %w", err)
	}
	sealed := key.aead.Seal(nonce, nonce, []byte(code), []byte("dsh-delivery-proof-v1\x00"+orderID))
	return k.activeKeyID, base64.RawStdEncoding.EncodeToString(sealed), nil
}

func (k *DeliveryProofKeyring) Decrypt(orderID, keyID, ciphertext string) (string, error) {
	if k == nil || strings.TrimSpace(orderID) == "" || strings.TrimSpace(ciphertext) == "" {
		return "", errors.New("DSH delivery proof ciphertext is unavailable")
	}
	key, ok := k.keys[keyID]
	if !ok {
		return "", errors.New("DSH delivery proof key is unavailable")
	}
	sealed, err := base64.RawStdEncoding.DecodeString(ciphertext)
	if err != nil || len(sealed) < key.aead.NonceSize()+key.aead.Overhead() {
		return "", errors.New("DSH delivery proof ciphertext is invalid")
	}
	nonce, payload := sealed[:key.aead.NonceSize()], sealed[key.aead.NonceSize():]
	plaintext, err := key.aead.Open(nil, nonce, payload, []byte("dsh-delivery-proof-v1\x00"+orderID))
	if err != nil || !validDeliveryProofCode(string(plaintext)) {
		return "", errors.New("DSH delivery proof ciphertext authentication failed")
	}
	return string(plaintext), nil
}

func (k *DeliveryProofKeyring) ProofVerifier(orderID, keyID, code string) (string, error) {
	if k == nil || strings.TrimSpace(orderID) == "" || !validDeliveryProofCode(code) {
		return "", errors.New("DSH delivery proof verifier input is invalid")
	}
	key, ok := k.keys[keyID]
	if !ok {
		return "", errors.New("DSH delivery proof key is unavailable")
	}
	mac := hmac.New(sha256.New, key.verifier)
	_, _ = io.WriteString(mac, orderID+"\x00"+code)
	return hex.EncodeToString(mac.Sum(nil)), nil
}

func (k *DeliveryProofKeyring) VerifyProof(orderID, keyID, storedVerifier, code string) bool {
	expected, err := k.ProofVerifier(orderID, keyID, code)
	if err != nil || len(storedVerifier) != len(expected) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(storedVerifier), []byte(expected)) == 1
}

func (k *DeliveryProofKeyring) ActiveIdempotencyHash(purpose string, facts ...string) (string, error) {
	if k == nil || strings.TrimSpace(purpose) == "" {
		return "", errors.New("DSH delivery proof idempotency input is invalid")
	}
	return k.idempotencyHash(k.activeKeyID, purpose, facts...)
}

func (k *DeliveryProofKeyring) HasKey(keyID string) bool {
	if k == nil {
		return false
	}
	_, ok := k.keys[keyID]
	return ok
}

func (k *DeliveryProofKeyring) VerifyIdempotencyHash(stored, purpose string, facts ...string) bool {
	if k == nil {
		return false
	}
	parts := strings.Split(stored, ".")
	if len(parts) != 3 || parts[0] != "v1" {
		return false
	}
	expected, err := k.idempotencyHash(parts[1], purpose, facts...)
	if err != nil || len(stored) != len(expected) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(stored), []byte(expected)) == 1
}

func (k *DeliveryProofKeyring) idempotencyHash(keyID, purpose string, facts ...string) (string, error) {
	key, ok := k.keys[keyID]
	if !ok || strings.TrimSpace(purpose) == "" {
		return "", errors.New("DSH delivery proof idempotency key is unavailable")
	}
	values := append([]string{"dsh-delivery-proof-idempotency-v1", purpose}, facts...)
	mac := hmac.New(sha256.New, key.idempotency)
	_, _ = io.WriteString(mac, strings.Join(values, "\x00"))
	return "v1." + keyID + "." + hex.EncodeToString(mac.Sum(nil)), nil
}

func validDeliveryProofCode(code string) bool {
	return len(code) == 6 && strings.Trim(code, "0123456789") == ""
}
