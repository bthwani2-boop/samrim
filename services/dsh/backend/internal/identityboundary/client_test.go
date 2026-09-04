package identityboundary

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestDSHIdentityBoundaryPinsPartnerCallerAndContext(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/internal/actors/provision" || r.Method != http.MethodPost {
			t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
		}
		if got := r.Header.Get("X-Service-Caller"); got != "dsh" {
			t.Fatalf("caller=%q", got)
		}
		if got := r.Header.Get("X-Operator-Context-ID"); got != "partner-ctx" {
			t.Fatalf("operator context=%q", got)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer dsh-service-token-1234567890" {
			t.Fatalf("authorization=%q", got)
		}
		var body struct {
			Username  string `json:"username"`
			PhoneE164 string `json:"phoneE164"`
			Role      string `json:"role"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if body.Role != "partner" {
			t.Fatalf("role=%q", body.Role)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"actorId": "partner-1", "username": body.Username, "phoneE164": body.PhoneE164,
			"operatorContextId": "partner-ctx", "roles": []string{"partner"}, "status": "PROVISIONED", "version": 1,
		})
	}))
	defer server.Close()

	client, err := New(server.URL, "dsh-service-token-1234567890")
	if err != nil {
		t.Fatal(err)
	}
	_, err = client.ProvisionPartner(context.Background(), "partner-ctx", PartnerInput{
		Username: "partner.one", PhoneE164: "+967777000002",
	})
	if err != nil {
		t.Fatal(err)
	}
}
