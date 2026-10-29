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
		Decision: "APPROVE", Reason: "reviewed agreed financial rates", CurrentStorePartnerActorID: "partner-5", CurrentFulfillmentModes: []string{"PARTNER_CAPTAIN", "CUSTOMER_PICKUP"},
	}
	server := &Server{rootApprovalProofSecret: []byte(strings.Repeat("S", 40))}
	facts, err := json.Marshal([]any{
		"wlt-root-owner-approval-v2", agreementID, strconv.Itoa(input.ExpectedAgreementVersion),
		input.Decision, actorID, input.Reason, key, correlation, "partner-5", []string{"CUSTOMER_PICKUP", "PARTNER_CAPTAIN"},
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
	reordered := input
	reordered.CurrentFulfillmentModes = []string{"CUSTOMER_PICKUP", "PARTNER_CAPTAIN"}
	check("canonical mode ordering", reordered, server, agreementID, key, correlation, true, 0)
	changedPartner := input
	changedPartner.CurrentStorePartnerActorID = "different-partner"
	check("different Partner blocks approval", changedPartner, server, agreementID, key, correlation, false, http.StatusForbidden)
	changedModes := input
	changedModes.CurrentFulfillmentModes = []string{"CUSTOMER_PICKUP"}
	check("different fulfillment modes block approval", changedModes, server, agreementID, key, correlation, false, http.StatusForbidden)
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

// DSH's independently generated wire vector is verified through the WLT HTTP
// decoder and the production proof guard, without touching financial state.
func TestRootOwnerDSHWireVectorAtWLTHTTPBoundary(t *testing.T) {
	const vector = "3KBN5adhHYI6LaOr9bLx2VOuVhF6CQL7f0qkn5kmXKM"
	const payload = "{\"expectedAgreementVersion\":3,\"decision\":\"APPROVE\",\"reason\":\"reviewed agreed financial rates\",\"rootOwnerSelfApproval\":true,\"rootOwnerApprovalProof\":\"" + vector + "\",\"currentStorePartnerActorId\":\"partner-5\",\"currentFulfillmentModes\":[\"PARTNER_CAPTAIN\",\"CUSTOMER_PICKUP\"]}"
	server := &Server{rootApprovalProofSecret: []byte(strings.Repeat("S", 40))}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /wlt/v1/operator/store-commercial-agreements/{agreementId}/decision", func(w http.ResponseWriter, r *http.Request) {
		var input storeCommercialAgreementDecisionRequest
		if !decodeJSON(w, r, &input) {
			return
		}
		if !server.verifyRootOwnerApprovalProof(w, r.PathValue("agreementId"), input, "root-operator", "root-approval-operation", "root-correlation") {
			return
		}
		w.WriteHeader(http.StatusNoContent) // Storage deliberately not invoked.
	})
	for _, tc := range []struct {
		name, body string
		status     int
	}{
		{"canonical DSH-to-WLT wire proof", payload, http.StatusNoContent},
		{"forged Partner in signed request", strings.Replace(payload, "partner-5", "partner-6", 1), http.StatusForbidden},
		{"forged fulfillment policy", strings.Replace(payload, "PARTNER_CAPTAIN", "BTHWANI_CAPTAIN", 1), http.StatusForbidden},
		{"forged signature", strings.Replace(payload, vector, "invalid", 1), http.StatusForbidden},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := httptest.NewRequest(http.MethodPost, "/wlt/v1/operator/store-commercial-agreements/agreement-123/decision", strings.NewReader(tc.body))
			r.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()
			mux.ServeHTTP(w, r)
			if w.Code != tc.status {
				t.Fatalf("WLT wire response = %d, want %d: %s", w.Code, tc.status, w.Body.String())
			}
		})
	}
}
