package identityboundary

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestWorkforceIdentityBoundaryPinsCallerContextAndRoles(t *testing.T) {
	t.Parallel()

	for _, role := range []string{"captain", "field"} {
		role := role
		t.Run(role, func(t *testing.T) {
			t.Parallel()

			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != "/internal/actors/provision" || r.Method != http.MethodPost {
					t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
				}
				if got := r.Header.Get("X-Service-Caller"); got != "workforce" {
					t.Fatalf("caller=%q", got)
				}
				if got := r.Header.Get("X-Operator-Context-ID"); got != "operator-ctx" {
					t.Fatalf("operator context=%q", got)
				}
				if got := r.Header.Get("Authorization"); got != "Bearer workforce-service-token-123456" {
					t.Fatalf("authorization=%q", got)
				}
				var body struct {
					ActorID   string `json:"actorId"`
					Username  string `json:"username"`
					PhoneE164 string `json:"phoneE164"`
					Role      string `json:"role"`
				}
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
					t.Fatal(err)
				}
				if body.Role != role {
					t.Fatalf("role=%q want=%q", body.Role, role)
				}
				_ = json.NewEncoder(w).Encode(map[string]any{
					"actorId": "actor-1", "username": body.Username, "phoneE164": body.PhoneE164,
					"operatorContextId": "operator-ctx", "roles": []string{role}, "status": "PROVISIONED", "version": 1,
				})
			}))
			defer server.Close()

			client, err := New(server.URL, "workforce-service-token-123456")
			if err != nil {
				t.Fatal(err)
			}
			input := ActorInput{Username: "user.one", PhoneE164: "+967777000001"}

			if role == "captain" {
				_, err = client.ProvisionCaptain(context.Background(), "operator-ctx", input)
			} else {
				_, err = client.ProvisionField(context.Background(), "operator-ctx", input)
			}
			if err != nil {
				t.Fatal(err)
			}
		})
	}
}
