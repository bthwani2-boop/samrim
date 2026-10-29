package wlt

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"strconv"
	"strings"
	"testing"
)

func TestDSHRootOwnerProofBindsApprovedFinanceMutation(t *testing.T) {
	input := StoreCommercialAgreementDecision{AgreementVersion: 5, Decision: "APPROVE", Reason: "Reviewed Store rates", RootOwnerSelfApproval: true}
	client := &Client{rootApprovalProofSecret: []byte(strings.Repeat("S", 40))}
	proof, err := client.rootOwnerApprovalProof("store-agreement", input, "root-idempotency", "root-correlation", "root-actor")
	if err != nil {
		t.Fatal(err)
	}
	bytes, err := base64.RawURLEncoding.DecodeString(proof)
	if err != nil {
		t.Fatal(err)
	}
	facts, err := json.Marshal([]string{"wlt-root-owner-approval-v1", "store-agreement", strconv.Itoa(5), "APPROVE", "root-actor", "Reviewed Store rates", "root-idempotency", "root-correlation"})
	if err != nil {
		t.Fatal(err)
	}
	mac := hmac.New(sha256.New, client.rootApprovalProofSecret)
	_, _ = mac.Write(facts)
	if !hmac.Equal(bytes, mac.Sum(nil)) {
		t.Fatal("DSH root proof is not bound to canonical mutation")
	}
	missingKey := &Client{}
	if _, err := missingKey.rootOwnerApprovalProof("store-agreement", input, "root-idempotency", "root-correlation", "root-actor"); err == nil {
		t.Fatal("Root Owner proof must fail closed without a separate key")
	}
	input.RootOwnerSelfApproval = false
	if proof, err := missingKey.rootOwnerApprovalProof("store-agreement", input, "root-idempotency", "root-correlation", "root-actor"); err != nil || proof != "" {
		t.Fatalf("ordinary Finance review must remain available without root key: %q, %v", proof, err)
	}
}
