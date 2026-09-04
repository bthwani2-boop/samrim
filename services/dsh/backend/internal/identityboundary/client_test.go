package identityboundary

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestDSHIdentityBoundaryPinsRoleAndUsesCredentialAsCallerIdentity(t *testing.T) {
	t.Parallel()

	for _, tc := range []struct {
		name string
		role string
		call func(*Client, context.Context, ActorInput) error
	}{
		{name: "partner", role: "partner", call: func(c *Client, ctx context.Context, input ActorInput) error { _, err := c.ProvisionPartner(ctx, input); return err }},
		{name: "captain", role: "captain", call: func(c *Client, ctx context.Context, input ActorInput) error { _, err := c.ProvisionCaptain(ctx, input); return err }},
		{name: "field", role: "field", call: func(c *Client, ctx context.Context, input ActorInput) error { _, err := c.ProvisionField(ctx, input); return err }},
	} {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != "/internal/actor-roles/provision" || r.Method != http.MethodPost {
					t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
				}
				if got := r.Header.Get("Authorization"); got != "Bearer dsh-service-token-1234567890" {
					t.Fatalf("authorization=%q", got)
				}
				if got := r.Header.Get("X-Service-Caller"); got != "" {
					t.Fatalf("redundant service caller header leaked: %q", got)
				}
				if got := r.Header.Get("X-Operator-Context-ID"); got != "" {
					t.Fatalf("premature operator context header leaked: %q", got)
				}
				var body struct {
					PhoneE164 string `json:"phoneE164"`
					Role      string `json:"role"`
					ActorID   string `json:"actorId"`
					Username  string `json:"username"`
				}
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
					t.Fatal(err)
				}
				if body.Role != tc.role {
					t.Fatalf("role=%q", body.Role)
				}
				if body.ActorID != "" || body.Username != "" {
					t.Fatalf("DSH attempted to author actor identity: actorId=%q username=%q", body.ActorID, body.Username)
				}
				_ = json.NewEncoder(w).Encode(map[string]any{
					"actorId": "act_shared", "phoneE164": body.PhoneE164, "role": tc.role,
					"enabled": true, "actorVersion": 1, "roleVersion": 1,
				})
			}))
			defer server.Close()

			client, err := New(server.URL, "dsh-service-token-1234567890")
			if err != nil {
				t.Fatal(err)
			}
			if err := tc.call(client, context.Background(), ActorInput{PhoneE164: "+967777000002"}); err != nil {
				t.Fatal(err)
			}
		})
	}
}
