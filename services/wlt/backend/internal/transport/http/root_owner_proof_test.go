package http

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
)

func TestRootOwnerApprovalProofRequiresSeparateKeyAndExactFacts(t *testing.T) {
	const actorID, agreementID, key, correlation = "root-operator", "agreement-123", "root-approval-operation", "root-correlation"
	input := storeCommercialAgreementDecisionRequest{
		RootOwnerSelfApproval: true, ExpectedAgreementVersion: 3,
		Decision: "APPROVE", Reason: "reviewed agreed financial rates",
	}
	server := &Server{rootApprovalProofSecret: []byte(strings.Repeat("S", 40))}
	facts, err := json.Marshal([]string{
		"wlt-root-owner-approval-v1", agreementID, strconv.Itoa(input.ExpectedAgreementVersion),
		input.Decision, actorID, input.Reason, key, correlation,
	})
	if err != nil {
		t.Fatal(err)
	}
	mac := hmac.New(sha256.New, server.rootApprovalProofSecret)
	_, _ = mac.Write(facts)
	input.RootOwnerApprovalProof = base64.RawURLEncoding.EncodeToString(mac.Sum(nil))

	check := func(testName string, candidate storeCommercialAgreementDecisionRequest, candidateServer *Server, name, idem, corr string, want bool, wantStatus int) {
		t.Helper()
		t.Run(testName, func(t *testing.T) {
			writer := httptest.NewRecorder()
			got := candidateServer.verifyRootOwnerApprovalProof(writer, name, candidate, actorID, idem, corr)
			if got != want {
				t.Fatalf("verified = %t, want %t", got, want)
			}
			if !want && writer.Code != wantStatus {
				t.Fatalf("status = %d, want %d", writer.Code, wantStatus)
			}
		})
	}
	check("valid Identity-gated DSH proof", input, server, agreementID, key, correlation, true, 0)
	check("different agreement blocked", input, server, "other-agreement", key, correlation, false, http.StatusForbidden)
	check("different idempotency blocked", input, server, agreementID, "other-operation", correlation, false, http.StatusForbidden)
	check("different correlation blocked", input, server, agreementID, key, "other-correlation", false, http.StatusForbidden)
	badReason := input
	badReason.Reason = "different terms"
	check("different reason blocked", badReason, server, agreementID, key, correlation, false, http.StatusForbidden)
	missing := input
	missing.RootOwnerApprovalProof = ""
	check("missing proof blocked", missing, server, agreementID, key, correlation, false, http.StatusForbidden)
	check("missing verification key fails closed", input, &Server{}, agreementID, key, correlation, false, http.StatusServiceUnavailable)
	ordinary := storeCommercialAgreementDecisionRequest{RootOwnerSelfApproval: false}
	check("ordinary Finance decision needs no proof", ordinary, &Server{}, agreementID, key, correlation, true, 0)
	ordinary.RootOwnerApprovalProof = input.RootOwnerApprovalProof
	check("unexpected proof blocked", ordinary, server, agreementID, key, correlation, false, http.StatusForbidden)
}
