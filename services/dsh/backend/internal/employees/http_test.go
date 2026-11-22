package employees

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storeavailability"
)

type employeeRecheckIdentity struct {
	actor    storeavailability.VerifiedActor
	readErr  error
	grantErr error
}

func (fake employeeRecheckIdentity) ResolveCurrentSession(context.Context, string) (storeavailability.VerifiedActor, error) {
	return fake.actor, fake.readErr
}

func (fake employeeRecheckIdentity) RequireOperatorPermission(context.Context, string, string, string) error {
	return fake.grantErr
}

func TestEmployeeReadRequiresCurrentSameActorAndHRGrant(t *testing.T) {
	operator := storeavailability.VerifiedActor{Subject: "operator-a", Role: storeavailability.OperatorRole}
	tests := []struct {
		name   string
		state  employeeRecheckIdentity
		want   int
		permit bool
	}{
		{"current authorized operator", employeeRecheckIdentity{actor: operator}, 200, true},
		{"session revoked while reading", employeeRecheckIdentity{readErr: storeavailability.ErrUnauthorized}, 401, false},
		{"identity owner unavailable", employeeRecheckIdentity{readErr: storeavailability.ErrIdentityUnavailable}, 503, false},
		{"token changed actor", employeeRecheckIdentity{actor: storeavailability.VerifiedActor{Subject: "operator-b", Role: storeavailability.OperatorRole}}, 401, false},
		{"operator role revoked", employeeRecheckIdentity{actor: storeavailability.VerifiedActor{Subject: "operator-a", Role: storeavailability.MerchantRole}}, 403, false},
		{"HR grant revoked", employeeRecheckIdentity{actor: operator, grantErr: storeavailability.ErrForbidden}, 403, false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodGet, "/v1/operators/employees", nil)
			request.Header.Set("Authorization", "Bearer source-token")
			request = request.WithContext(context.WithValue(request.Context(), employeeReadActorKey{}, operator.Subject))
			recorder := httptest.NewRecorder()
			got := verifyEmployeeReadAuthorization(recorder, request, tc.state)
			if got != tc.permit {
				t.Fatalf("authorized=%t, want %t", got, tc.permit)
			}
			if !got && (recorder.Code != tc.want || strings.Contains(recorder.Body.String(), "operator-a")) {
				t.Fatalf("read rejection: status=%d body=%s", recorder.Code, recorder.Body.String())
			}
		})
	}
	t.Run("missing initial Identity actor fails closed", func(t *testing.T) {
		recorder := httptest.NewRecorder()
		if verifyEmployeeReadAuthorization(recorder,
			httptest.NewRequest(http.MethodGet, "/v1/operators/employees", nil),
			employeeRecheckIdentity{actor: operator}) || recorder.Code != http.StatusServiceUnavailable {
			t.Fatal("read without an initial verified actor was not rejected")
		}
	})
	t.Run("unexpected Identity failure does not disclose records", func(t *testing.T) {
		recorder := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodGet, "/v1/operators/employees", nil)
		request = request.WithContext(context.WithValue(request.Context(), employeeReadActorKey{}, operator.Subject))
		if verifyEmployeeReadAuthorization(recorder, request, employeeRecheckIdentity{readErr: errors.New("internal failure")}) ||
			recorder.Code != http.StatusServiceUnavailable {
			t.Fatal("unexpected Identity read failure did not fail closed")
		}
	})
}
