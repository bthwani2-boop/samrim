package transporthttp

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	"testing"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/auth"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/contract"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storeaccess"
)

func TestIndependentCustomerPolicyDraftPrivateRouteGuards(t *testing.T) {
	operatorAuth, err := auth.NewServiceToken("independent-policy-test-service-authentication-key")
	if err != nil {
		t.Fatal(err)
	}
	server := &StoreAccessServer{operatorAuth: operatorAuth, service: &storeaccess.Service{}}
	mux := http.NewServeMux()
	server.Register(mux)
	path := "/dsh/partner/stores/store-a/independent-customer-policy/draft"
	validBody := `{"expectedVersion":0,"cancellationTerms":"Cancellation terms","returnsTerms":"Returns terms","fulfillmentTerms":"Pickup fulfillment","collectionTerms":"Collection terms"}`
	cases := []struct {
		name, method, body, header string
		validHeaders               bool
		want                       int
	}{
		{"read without Partner session", "GET", "", "", false, http.StatusForbidden},
		{"read forged owner", "GET", "", "X-Actor-ID", false, http.StatusBadRequest},
		{"read forged operator", "GET", "", "X-Acting-Actor-ID", false, http.StatusBadRequest},
		{"mutation no retry headers", "PUT", validBody, "", false, http.StatusBadRequest},
		{"mutation forged actor", "PUT", validBody, "X-Actor-ID", true, http.StatusBadRequest},
		{"mutation forged operator", "PUT", validBody, "X-Acting-Actor-ID", true, http.StatusBadRequest},
		{"mutation with too short idempotency key", "PUT", validBody, "short-key", true, http.StatusBadRequest},
		{"mutation cannot set review state", "PUT", `{"expectedVersion":0,"cancellationTerms":"Cancellation terms","returnsTerms":"Returns terms","fulfillmentTerms":"Pickup fulfillment","collectionTerms":"Collection terms","reviewState":"PASSED"}`, "", true, http.StatusBadRequest},
		{"mutation cannot publish", "PUT", `{"expectedVersion":0,"cancellationTerms":"Cancellation terms","returnsTerms":"Returns terms","fulfillmentTerms":"Pickup fulfillment","collectionTerms":"Collection terms","publishedAt":"2026-11-08T00:00:00Z"}`, "", true, http.StatusBadRequest},
		{"mutation without Partner session", "PUT", validBody, "", true, http.StatusForbidden},
		{"mutation wrong method", "POST", validBody, "", true, http.StatusMethodNotAllowed},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(tc.method, path, strings.NewReader(tc.body))
			if tc.validHeaders {
				req.Header.Set("Idempotency-Key", "independent-policy-attempt-0000001")
				req.Header.Set("X-Correlation-ID", "independent-policy-correlation-0000001")
			}
			if tc.header == "X-Actor-ID" || tc.header == "X-Acting-Actor-ID" {
				req.Header.Set(tc.header, "foreign-owner-actor")
			} else if tc.header == "short-key" {
				req.Header.Set("Idempotency-Key", "short-key")
			}
			rec := httptest.NewRecorder()
			mux.ServeHTTP(rec, req)
			if rec.Code != tc.want {
				t.Fatalf("status=%d want=%d body=%s", rec.Code, tc.want, rec.Body.String())
			}
			if tc.want != http.StatusMethodNotAllowed {
				if !strings.Contains(rec.Header().Get("Cache-Control"), "no-store") || rec.Header().Get("X-Robots-Tag") != "noindex, nofollow" {
					t.Fatalf("private draft must never be cached or indexed: %+v", rec.Header())
				}
			}
			for _, forbidden := range []string{"Cancellation terms", "Pickup fulfillment", "foreign-owner-actor", "policyVersion", "PASSED", "publishedAt"} {
				if strings.Contains(rec.Body.String(), forbidden) {
					t.Fatalf("private or approval facts leaked: %s", rec.Body.String())
				}
			}
		})
	}
}

func TestIndependentCustomerPolicyErrorResponsesClassifyConflictWithoutLeakingTerms(t *testing.T) {
	tests := []struct {
		name   string
		err    error
		status int
		code   string
	}{
		{"wrong session", storeaccess.ErrPartnerSession, http.StatusForbidden, "FORBIDDEN"},
		{"foreign owner", postgres.ErrStoreNotFound, http.StatusNotFound, "NOT_FOUND"},
		{"invalid policy", postgres.ErrIndependentCustomerPolicyInvalid, http.StatusBadRequest, "INVALID_INPUT"},
		{"stale version", postgres.ErrIndependentCustomerPolicyVersion, http.StatusConflict, "VERSION_CONFLICT"},
		{"same key changed facts", postgres.ErrIndependentCustomerPolicyConflict, http.StatusConflict, "IDEMPOTENCY_CONFLICT"},
		{"unexpected storage failure", errors.New("private QA policy terms must not leak"), http.StatusBadGateway, "DSH_STORAGE_UNAVAILABLE"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			writeIndependentCustomerPolicyError(rec, tt.err)
			if rec.Code != tt.status || !strings.Contains(rec.Body.String(), tt.code) {
				t.Fatalf("status=%d want=%d code=%s body=%s", rec.Code, tt.status, tt.code, rec.Body.String())
			}
			if !strings.Contains(rec.Header().Get("Cache-Control"), "no-store") {
				t.Fatalf("private error response could be cached: %v", rec.Header())
			}
			for _, secret := range []string{"private QA policy terms", "Cancellation terms", "Pickup fulfillment", "foreign-owner-actor"} {
				if strings.Contains(rec.Body.String(), secret) {
					t.Fatalf("internal policy or owner data leaked through error response: %s", rec.Body.String())
				}
			}
		})
	}
}

func TestIndependentCustomerPolicyDraftResponsesDecodeIntoGeneratedGoContract(t *testing.T) {
	// The DSH OpenAPI uses a boolean literal for draftOnly. The generated
	// Go contract must decode the exact JSON shape emitted by the handlers,
	// rather than drifting to a string when enum: [true] is regenerated.
	policy := postgres.IndependentCustomerPolicyRecord{
		StoreID:           "independent-qa-store",
		Version:           2,
		PolicyVersion:     "v2",
		ReviewState:       "NOT_CHECKED",
		CancellationTerms: "Cancel at the merchant",
		ReturnsTerms:      "Return to merchant",
		FulfillmentTerms:  "Pickup from merchant",
		CollectionTerms:   "Pay at merchant",
	}
	t.Run("read", func(t *testing.T) {
		response := httptest.NewRecorder()
		writeJSON(response, http.StatusOK, map[string]any{"policy": policy, "draftOnly": true})
		var decoded contract.IndependentCustomerPolicyDraftResponse
		if err := json.Unmarshal(response.Body.Bytes(), &decoded); err != nil {
			t.Fatalf("generated Go draft GET response does not accept real handler JSON: %v", err)
		}
		if !decoded.DraftOnly || decoded.Policy.StoreID != policy.StoreID ||
			decoded.Policy.Version != policy.Version || decoded.Policy.CancellationTerms != policy.CancellationTerms {
			t.Fatalf("generated Go draft GET response discarded canonical policy facts: %+v", decoded)
		}
	})
	t.Run("mutation replay", func(t *testing.T) {
		response := httptest.NewRecorder()
		writeJSON(response, http.StatusOK, map[string]any{"policy": policy, "draftOnly": true, "idempotentReplay": true})
		var decoded contract.IndependentCustomerPolicyDraftMutationResponse
		if err := json.Unmarshal(response.Body.Bytes(), &decoded); err != nil {
			t.Fatalf("generated Go draft PUT response does not accept real handler JSON: %v", err)
		}
		if !decoded.DraftOnly || !decoded.IdempotentReplay ||
			decoded.Policy.StoreID != policy.StoreID || decoded.Policy.ReviewState != "NOT_CHECKED" {
			t.Fatalf("generated Go draft PUT response discarded safe replay/private draft facts: %+v", decoded)
		}
	})
}
