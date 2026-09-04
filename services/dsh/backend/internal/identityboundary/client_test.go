package identityboundary

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestDSHIdentityBoundaryPinsCallerContextAndRole(t *testing.T) {
	t.Parallel()

	for _, tc := range []struct {
		name string
		role string
		call func(*Client, context.Context, string, ActorInput) error
	}{
		{name: "partner", role: "partner", call: func(c *Client, ctx context.Context, scope string, input ActorInput) error { _, err := c.ProvisionPartner(ctx, scope, input); return err }},
		{name: "captain", role: "captain", call: func(c *Client, ctx context.Context, scope string, input ActorInput) error { _, err := c.ProvisionCaptain(ctx, scope, input); return err }},
		{name: "field", role: "field", call: func(c *Client, ctx context.Context, scope string, input ActorInput) error { _, err := c.ProvisionField(ctx, scope, input); return err }},
	} {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != "/internal/actors/provision" || r.Method != http.MethodPost {
					t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
				}
				if got := r.Header.Get("X-Service-Caller"); got != "dsh" {
					t.Fatalf("caller=%q", got)
				}
				if got := r.Header.Get("X-Operator-Context-ID"); got != tc.name+"-ctx" {
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
				if body.Role != tc.role {
					t.Fatalf("role=%q", body.Role)
				}
				_ = json.NewEncoder(w).Encode(map[string]any{
					"actorId": tc.name + "-1", "username": body.Username, "phoneE164": body.PhoneE164,
					"operatorContextId": tc.name + "-ctx", "roles": []string{tc.role}, "status": "PROVISIONED", "version": 1,
				})
			}))
			defer server.Close()

			client, err := New(server.URL, "dsh-service-token-1234567890")
			if err != nil {
				t.Fatal(err)
			}
			if err := tc.call(client, context.Background(), tc.name+"-ctx", ActorInput{
				Username: tc.name + ".one", PhoneE164: "+967777000002",
			}); err != nil {
				t.Fatal(err)
			}
		})
	}
}
