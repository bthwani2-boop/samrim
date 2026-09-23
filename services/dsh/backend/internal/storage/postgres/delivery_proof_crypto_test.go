package postgres

import (
	"encoding/base64"
	"strings"
	"testing"
)

func testDeliveryProofKeyring(t *testing.T) *DeliveryProofKeyring {
	t.Helper()
	oldKey := base64.StdEncoding.EncodeToString([]byte("0123456789abcdef0123456789abcdef"))
	newKey := base64.StdEncoding.EncodeToString([]byte("abcdef0123456789abcdef0123456789"))
	keyring, err := NewDeliveryProofKeyring("new", map[string]string{"old": oldKey, "new": newKey})
	if err != nil {
		t.Fatalf("create proof keyring: %v", err)
	}
	return keyring
}

func TestDeliveryProofKeyringEncryptsAndScopesCodes(t *testing.T) {
	keyring := testDeliveryProofKeyring(t)
	keyID, ciphertext, err := keyring.Encrypt("order-a", "123456")
	if err != nil {
		t.Fatalf("encrypt proof: %v", err)
	}
	if keyID != "new" || strings.Contains(ciphertext, "123456") {
		t.Fatalf("proof ciphertext exposed code or wrong key ID: keyID=%q", keyID)
	}
	code, err := keyring.Decrypt("order-a", keyID, ciphertext)
	if err != nil || code != "123456" {
		t.Fatalf("decrypt proof = %q, %v; want 123456", code, err)
	}
	if _, err := keyring.Decrypt("order-b", keyID, ciphertext); err == nil {
		t.Fatal("ciphertext authenticated for a different order")
	}
	if keyring.VerifyProof("order-a", keyID, mustProofVerifier(t, keyring, "order-a", keyID, "123456"), "654321") {
		t.Fatal("wrong proof code verified")
	}
}

func TestDeliveryProofIdempotencyHashSupportsRetainedRotationKey(t *testing.T) {
	oldOnly, err := NewDeliveryProofKeyring("old", map[string]string{"old": base64.StdEncoding.EncodeToString([]byte("0123456789abcdef0123456789abcdef"))})
	if err != nil {
		t.Fatalf("create old proof keyring: %v", err)
	}
	stored, err := oldOnly.ActiveIdempotencyHash("captain-complete", "assignment-1", "delivered", "123456")
	if err != nil {
		t.Fatalf("hash idempotency request: %v", err)
	}
	rotated := testDeliveryProofKeyring(t)
	if !rotated.VerifyIdempotencyHash(stored, "captain-complete", "assignment-1", "delivered", "123456") {
		t.Fatal("retained key did not verify the prior idempotency hash")
	}
	if rotated.VerifyIdempotencyHash(stored, "captain-complete", "assignment-1", "delivered", "654321") {
		t.Fatal("idempotency hash accepted different proof material")
	}
}

func TestLegacyCaptainCompletionHashesCoverPriorRequestShapes(t *testing.T) {
	hashes := legacyCaptainCompletionRequestHashes("assignment-1", "delivered", 1250, "123456", 2)
	if len(hashes) != 3 || hashes[0] != HashCaptainCompletionRequest("assignment-1", "delivered", 1250, "123456", 2) {
		t.Fatalf("legacy completion hashes do not include the proof-bearing request shape")
	}
	if hashes[1] != hashFacts("captain-complete", "assignment-1", "delivered", "1250", "2") || hashes[2] != hashFacts("captain-complete", "assignment-1", "delivered", "2") {
		t.Fatal("legacy completion hashes do not cover the historical amount and pre-amount request shapes")
	}
	if replayHashes := legacyCaptainCompletionRequestHashes("assignment-1", "delivered", 1250, "", 2); replayHashes[1] != hashes[1] || replayHashes[2] != hashes[2] {
		t.Fatal("legacy completion replay without a proof code did not preserve pre-proof request shapes")
	}
}

func TestLegacyCaptainCompletionDigestIsKeyedAndPurposeScoped(t *testing.T) {
	keyring := testDeliveryProofKeyring(t)
	legacyDigest := HashCaptainCompletionRequest("assignment-1", "delivered", 1250, "123456", 2)
	protected, err := keyring.ActiveIdempotencyHash("captain-completion-legacy", legacyDigest)
	if err != nil {
		t.Fatalf("protect legacy completion digest: %v", err)
	}
	if !keyring.VerifyIdempotencyHash(protected, "captain-completion-legacy", legacyDigest) {
		t.Fatal("protected legacy completion digest did not verify")
	}
	if keyring.VerifyIdempotencyHash(protected, "captain-completion-legacy", HashCaptainCompletionRequest("assignment-1", "delivered", 1250, "654321", 2)) {
		t.Fatal("protected legacy completion digest accepted a different request")
	}
	if keyring.VerifyIdempotencyHash(protected, "captain-completion", legacyDigest) {
		t.Fatal("legacy completion digest verified under the current request purpose")
	}
}

func TestCaptainCompletionReplayHashMatchesCurrentAndLegacyRequestFormats(t *testing.T) {
	keyring := testDeliveryProofKeyring(t)
	assignmentID := "assignment-1"
	submittedResult := "DeLiVeReD"
	requestFacts := []string{assignmentID, "delivered", "1250", "123456", "2"}
	currentHash, err := keyring.ActiveIdempotencyHash("captain-completion", requestFacts...)
	if err != nil {
		t.Fatalf("create current completion hash: %v", err)
	}
	if !captainCompletionReplayHashMatches(keyring, currentHash, requestFacts, assignmentID, submittedResult, 1250, "123456", 2) {
		t.Fatal("current completion request did not replay")
	}
	for index, legacyDigest := range legacyCaptainCompletionRequestHashes(assignmentID, submittedResult, 1250, "123456", 2) {
		storedHash, err := keyring.ActiveIdempotencyHash("captain-completion-legacy", legacyDigest)
		if err != nil {
			t.Fatalf("protect legacy completion hash %d: %v", index, err)
		}
		if !captainCompletionReplayHashMatches(keyring, storedHash, requestFacts, assignmentID, submittedResult, 1250, "123456", 2) {
			t.Fatalf("legacy completion request format %d did not replay with its submitted result casing", index)
		}
		if captainCompletionReplayHashMatches(keyring, storedHash, requestFacts, assignmentID, "delivered", 1250, "123456", 2) {
			t.Fatalf("legacy completion request format %d replayed with different submitted result casing", index)
		}
	}
}

func mustProofVerifier(t *testing.T, keyring *DeliveryProofKeyring, orderID, keyID, code string) string {
	t.Helper()
	verifier, err := keyring.ProofVerifier(orderID, keyID, code)
	if err != nil {
		t.Fatalf("create proof verifier: %v", err)
	}
	return verifier
}
