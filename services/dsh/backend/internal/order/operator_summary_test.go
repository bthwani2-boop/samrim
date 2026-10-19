package order

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	identityintegration "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/identity"
	identityclient "github.com/bthwani2-boop/samrim/services/identity/clients/go"
)

func TestOperatorOperationsSummaryRequiresOperationsPermissionBeforeStorage(t *testing.T) {
	for _, unavailable := range []bool{false, true} {
		t.Run(map[bool]string{false: "disabled permission", true: "Identity unavailable"}[unavailable], func(t *testing.T) {
			calls := 0
			identity := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls++
				w.Header().Set("Content-Type", "application/json")
				if r.URL.Path == "/internal/actors/actor_no_operations/roles/operator" {
					_, _ = w.Write([]byte(`{"actorId":"actor_no_operations","role":"operator","enabled":true,"securityEnabled":true,"activatedAt":"2026-10-01T00:00:00Z"}`))
					return
				}
				if r.URL.Path != "/internal/operators/actor_no_operations/permissions/operations" {
					t.Errorf("unexpected authorization path: %s", r.URL.Path)
				}
				if unavailable {
					w.WriteHeader(http.StatusServiceUnavailable)
					_, _ = w.Write([]byte(`{"error":{"code":"UNAVAILABLE"}}`))
					return
				}
				_, _ = w.Write([]byte(`{"actorId":"actor_no_operations","permission":"operations","enabled":false}`))
			}))
			defer identity.Close()
			endpoint, err := identityintegration.ResolveBaseURL(identity.URL, "test")
			if err != nil {
				t.Fatal(err)
			}
			client, err := identityintegration.New(endpoint, "iiiiiiiiiiiiiiiiiiiiiiii")
			if err != nil {
				t.Fatal(err)
			}
			// A nil DB makes an authorization bypass fail rather than produce any counts.
			service := &Service{identity: client}
			result, err := service.ListForOperator(context.Background(), "", "", "updated_desc", "actor_no_operations", false, 2, "")
			if err == nil || calls != 2 || len(result.Operations) != 0 || !result.Summary.MeasuredAt.IsZero() {
				t.Fatalf("unauthorized summary read: result=%+v err=%v calls=%d", result, err, calls)
			}
			if !unavailable {
				var identityErr *identityclient.Error
				if !errors.As(err, &identityErr) || identityErr.Status != http.StatusForbidden {
					t.Fatalf("expected forbidden, got %v", err)
				}
			}
		})
	}
}
