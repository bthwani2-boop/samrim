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
	input := StoreCommercialAgreementDecision{AgreementVersion: 5, Decision: "APPROVE", Reason: "Reviewed Store rates", RootOwnerSelfApproval: true, CurrentStorePartnerActorID: "partner-5", CurrentFulfillmentModes: []string{"PARTNER_CAPTAIN", "CUSTOMER_PICKUP"}}
	client := &Client{rootApprovalProofSecret: []byte(strings.Repeat("S", 40))}
	proof, err := client.rootOwnerApprovalProof("store-agreement", input, "root-idempotency", "root-correlation", "root-actor")
	if err != nil {
		t.Fatal(err)
	}
	bytes, err := base64.RawURLEncoding.DecodeString(proof)
	if err != nil {
		t.Fatal(err)
	}
	facts, err := json.Marshal([]any{"wlt-root-owner-approval-v2", "store-agreement", strconv.Itoa(5), "APPROVE", "root-actor", "Reviewed Store rates", "root-idempotency", "root-correlation", "partner-5", []string{"CUSTOMER_PICKUP", "PARTNER_CAPTAIN"}})
	if err != nil {
		t.Fatal(err)
	}
	mac := hmac.New(sha256.New, client.rootApprovalProofSecret)
	_, _ = mac.Write(facts)
	if !hmac.Equal(bytes, mac.Sum(nil)) {
		t.Fatal("DSH root proof is not bound to canonical mutation")
	}
	reordered := input
	reordered.CurrentFulfillmentModes = []string{"CUSTOMER_PICKUP", "PARTNER_CAPTAIN"}
	reorderedProof, err := client.rootOwnerApprovalProof("store-agreement", reordered, "root-idempotency", "root-correlation", "root-actor")
	if err != nil || reorderedProof != proof {
		t.Fatalf("mode order should be canonical: %v", err)
	}
	// Independent protocol vector consumed by the WLT HTTP boundary test.
	wireDecision := StoreCommercialAgreementDecision{
		AgreementVersion: 3, Decision: "APPROVE", Reason: "reviewed agreed financial rates",
		RootOwnerSelfApproval: true, CurrentStorePartnerActorID: "partner-5",
		CurrentFulfillmentModes: []string{"PARTNER_CAPTAIN", "CUSTOMER_PICKUP"},
	}
	wireProof, wireErr := client.rootOwnerApprovalProof("agreement-123", wireDecision, "root-approval-operation", "root-correlation", "root-operator")
	if wireErr != nil || wireProof != "3KBN5adhHYI6LaOr9bLx2VOuVhF6CQL7f0qkn5kmXKM" {
		t.Fatalf("DSH outbound protocol proof does not match WLT independent wire vector: %q, %v", wireProof, wireErr)
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
