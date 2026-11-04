package wlt

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCashInDevelopmentClientSendsVerifiedActorTypeWithServiceRequest(t *testing.T) {
	for _, tc := range []struct {
		name, action string
	}{
		{name: "manual-outcome", action: "simulate"},
		{name: "mock-provider-reconciliation", action: "reconcile"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			requests := 0
			remote := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				requests++
				wantPath := "/wlt/v1/development/funding-intents/funding_test/" + tc.action
				if r.Method != http.MethodPost || r.URL.Path != wantPath ||
					r.Header.Get("Authorization") != "Bearer isolated-service-token" ||
					r.Header.Get("X-Acting-Actor-ID") != "shared-actor" ||
					r.Header.Get("X-Acting-Actor-Type") != "customer" ||
					r.Header.Get("Idempotency-Key") != "isolated-idempotency-key" ||
					r.Header.Get("X-Correlation-ID") != "isolated-correlation-id" {
					t.Errorf("development funding request lost its actor identity: method=%s path=%s actor=%q type=%q", r.Method, r.URL.Path, r.Header.Get("X-Acting-Actor-ID"), r.Header.Get("X-Acting-Actor-Type"))
				}
				w.Header().Set("Content-Type", "application/json")
				_, _ = fmt.Fprint(w, `{"intent":{"actorType":"customer","actorId":"shared-actor","state":"PENDING_PROVIDER"}}`)
			}))
			defer remote.Close()

			client, err := New(remote.URL, "development", "isolated-service-token")
			if err != nil {
				t.Fatal(err)
			}
			if tc.action == "simulate" {
				_, _, err = client.SimulateCashInFundingOutcome(context.Background(), "funding_test", "UNKNOWN", "CUSTOMER", "shared-actor", "isolated-idempotency-key", "isolated-correlation-id")
			} else {
				_, err = client.ReconcileMockCashInFundingIntent(context.Background(), "funding_test", "CUSTOMER", "shared-actor", "isolated-idempotency-key", "isolated-correlation-id")
			}
			if err != nil || requests != 1 {
				t.Fatalf("development funding transport failed: requests=%d err=%v", requests, err)
			}
		})
	}
}
