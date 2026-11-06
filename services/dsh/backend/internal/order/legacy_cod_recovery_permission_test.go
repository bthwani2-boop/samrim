package order

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	identityintegration "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/identity"
	identityclient "github.com/bthwani2-boop/samrim/services/identity/clients/go"
)

func TestLegacyCODFinanceRoutesRejectMissingOrUnverifiableFinancePermissionBeforeWLT(t *testing.T) {
	for _, tc := range []struct {
		name        string
		roleActive  bool
		denied      bool
		unavailable bool
		wantCalls   int
		wantStatus  int
	}{
		{name: "finance denied", roleActive: true, denied: true, wantCalls: 2, wantStatus: http.StatusForbidden},
		{name: "identity unavailable", roleActive: true, unavailable: true, wantCalls: 2, wantStatus: http.StatusServiceUnavailable},
		{name: "inactive operator", wantCalls: 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			calls := 0
			identity := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls++
				w.Header().Set("Content-Type", "application/json")
				switch r.URL.Path {
				case "/internal/actors/actor_finance_denied/roles/operator":
					if tc.roleActive {
						_, _ = w.Write([]byte(`{"actorId":"actor_finance_denied","role":"operator","enabled":true,"securityEnabled":true,"activatedAt":"2026-10-01T00:00:00Z"}`))
					} else {
						_, _ = w.Write([]byte(`{"actorId":"actor_finance_denied","role":"operator","enabled":false,"securityEnabled":true,"activatedAt":"2026-10-01T00:00:00Z"}`))
					}
				case "/internal/operators/actor_finance_denied/permissions/finance":
					if tc.unavailable {
						w.WriteHeader(http.StatusServiceUnavailable)
						_, _ = w.Write([]byte(`{"error":{"code":"UNAVAILABLE"}}`))
					} else {
						_, _ = w.Write([]byte(`{"actorId":"actor_finance_denied","permission":"finance","enabled":false}`))
					}
				default:
					t.Errorf("unexpected Identity path: %s", r.URL.Path)
					w.WriteHeader(http.StatusNotFound)
				}
			}))
			defer identity.Close()
			endpoint, err := identityintegration.ResolveBaseURL(identity.URL, "test")
			if err != nil {
				t.Fatal(err)
			}
			client, err := identityintegration.New(endpoint, strings.Repeat("i", 24))
			if err != nil {
				t.Fatal(err)
			}

			// The nil WLT client deliberately turns any auth bypass into a failing panic.
			service := &Service{identity: client}
			operations := []struct {
				name   string
				invoke func() error
			}{
				{"submit", func() error {
					_, err := service.SubmitLegacyCODRecovery(context.Background(), "actor_finance_denied", "payment-1", "document-1", "finance-submit-key", "finance-submit-correlation")
					return err
				}},
				{"read", func() error {
					_, err := service.ReadLegacyCODRecoveryByPayment(context.Background(), "actor_finance_denied", "payment-1")
					return err
				}},
				{"approve", func() error {
					_, err := service.ApproveLegacyCODRecovery(context.Background(), "actor_finance_denied", "review-1", "finance-approve-key", "finance-approve-correlation")
					return err
				}},
			}
			for _, operation := range operations {
				t.Run(operation.name, func(t *testing.T) {
					before := calls
					err := operation.invoke()
					if err == nil || calls-before != tc.wantCalls {
						t.Fatalf("operation passed Finance boundary: err=%v Identity calls=%d, want=%d", err, calls-before, tc.wantCalls)
					}
					if !tc.roleActive {
						if !errors.Is(err, ErrOperatorNotActive) {
							t.Fatalf("expected inactive operator rejection, got %v", err)
						}
						return
					}
					var remote *identityclient.Error
					if !errors.As(err, &remote) || remote.Status != tc.wantStatus {
						t.Fatalf("want Identity status %d, got %v", tc.wantStatus, err)
					}
				})
			}
		})
	}
}
