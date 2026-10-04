package http

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestOfficialWalletDestinationCreationRejectsMissingOrMismatchedIdentityFactsBeforePersistence(t *testing.T) {
	cases := []struct {
		name string
		body string
		code string
	}{
		{
			name: "missing identity facts",
			body: `{"actorType":"partner","actorId":"partner-1","providerKey":"wallet-provider","identityFacts":{},"changeReason":"partner destination update","verificationEvidenceReference":"evidence-1","changeEvidenceReference":"evidence-1"}`,
			code: "REVERIFICATION_REQUIRED",
		},
		{
			name: "facts belong to a different actor",
			body: `{"actorType":"partner","actorId":"partner-1","providerKey":"wallet-provider","identityFacts":{"actorType":"partner","actorId":"partner-2","phoneE164":"+967777000002","actorVersion":2,"roleVersion":3,"roleEnabled":true,"securityEnabled":true,"officialName":"Canonical Partner","officialNameVersion":4,"officialNameStatus":"VERIFIED"},"changeReason":"partner destination update","verificationEvidenceReference":"evidence-1","changeEvidenceReference":"evidence-1"}`,
			code: "REVERIFICATION_REQUIRED",
		},
		{
			name: "client cannot provide an independent wallet number",
			body: `{"actorType":"partner","actorId":"partner-1","providerKey":"wallet-provider","walletIdentifier":"+967777000001","identityFacts":{},"changeReason":"partner destination update","verificationEvidenceReference":"evidence-1","changeEvidenceReference":"evidence-1"}`,
			code: "INVALID_INPUT",
		},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodPost, "/wlt/v1/operator/official-wallet-destinations", strings.NewReader(test.body))
			request.Header.Set("Authorization", "Bearer service-token")
			request.Header.Set("X-Acting-Actor-ID", "operator-1")
			request.Header.Set("X-Correlation-ID", "correlation-123")
			request.Header.Set("Idempotency-Key", "identity-facts-123")
			response := httptest.NewRecorder()
			(&Server{serviceToken: "service-token"}).createOfficialWalletDestination(response, request)
			if response.Code != http.StatusConflict && test.code == "REVERIFICATION_REQUIRED" {
				t.Fatalf("destination creation status = %d body=%s, want 409 %s", response.Code, response.Body.String(), test.code)
			}
			if test.code == "INVALID_INPUT" && response.Code != http.StatusBadRequest {
				t.Fatalf("independent wallet input status = %d body=%s, want 400", response.Code, response.Body.String())
			}
			if !strings.Contains(response.Body.String(), test.code) {
				t.Fatalf("destination creation body = %s, want code %s", response.Body.String(), test.code)
			}
		})
	}
}

func TestPayoutIntentCreationRequiresMatchingCurrentIdentityFactsBeforePersistence(t *testing.T) {
	request := httptest.NewRequest(http.MethodPost, "/wlt/v1/payout-intents", strings.NewReader(`{"actorType":"partner","actorId":"partner-1","amountMode":"FULL_AVAILABLE"}`))
	request.Header.Set("Authorization", "Bearer service-token")
	request.Header.Set("X-Correlation-ID", "correlation-123")
	request.Header.Set("Idempotency-Key", "payout-identity-123")
	response := httptest.NewRecorder()
	(&Server{serviceToken: "service-token"}).createPayoutIntent(response, request)
	if response.Code != http.StatusConflict || !strings.Contains(response.Body.String(), "REVERIFICATION_REQUIRED") {
		t.Fatalf("payout creation without Identity facts = %d %s, want 409 REVERIFICATION_REQUIRED", response.Code, response.Body.String())
	}
}
