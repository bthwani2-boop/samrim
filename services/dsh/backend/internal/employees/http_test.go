package employees

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/identityaccess"
)

type employeeRecheckIdentity struct {
	actor    identityaccess.VerifiedActor
	readErr  error
	grantErr error
}

func (fake employeeRecheckIdentity) ResolveCurrentSession(context.Context, string) (identityaccess.VerifiedActor, error) {
	return fake.actor, fake.readErr
}

func (fake employeeRecheckIdentity) RequireOperatorPermission(context.Context, string, string, string) error {
	return fake.grantErr
}

func TestEmployeeReadRequiresCurrentSameActorAndHRGrant(t *testing.T) {
	operator := identityaccess.VerifiedActor{Subject: "operator-a", Role: identityaccess.OperatorRole}
	tests := []struct {
		name   string
		state  employeeRecheckIdentity
		want   int
		permit bool
	}{
		{"current authorized operator", employeeRecheckIdentity{actor: operator}, 200, true},
		{"session revoked while reading", employeeRecheckIdentity{readErr: identityaccess.ErrUnauthorized}, 401, false},
		{"identity owner unavailable", employeeRecheckIdentity{readErr: identityaccess.ErrIdentityUnavailable}, 503, false},
		{"token changed actor", employeeRecheckIdentity{actor: identityaccess.VerifiedActor{Subject: "operator-b", Role: identityaccess.OperatorRole}}, 401, false},
		{"operator role revoked", employeeRecheckIdentity{actor: identityaccess.VerifiedActor{Subject: "operator-a", Role: identityaccess.MerchantRole}}, 403, false},
		{"HR grant revoked", employeeRecheckIdentity{actor: operator, grantErr: identityaccess.ErrForbidden}, 403, false},
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

func TestMerchantEmployeeReadAuthorization(t *testing.T) {
	const merchantRoot = "/v1/stores/store-a/employees"
	for _, tc := range []struct {
		name  string
		actor identityaccess.VerifiedActor
		err   error
		want  int
	}{
		{"same merchant", identityaccess.VerifiedActor{Subject: "merchant-a", Role: identityaccess.MerchantRole}, nil, 200},
		{"other actor", identityaccess.VerifiedActor{Subject: "merchant-b", Role: identityaccess.MerchantRole}, nil, 401},
		{"operator cannot use merchant route", identityaccess.VerifiedActor{Subject: "merchant-a", Role: identityaccess.OperatorRole}, nil, 403},
		{"revoked", identityaccess.VerifiedActor{}, identityaccess.ErrUnauthorized, 401},
	} {
		t.Run(tc.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodGet, merchantRoot, nil)
			request.SetPathValue("storeID", "store-a")
			request.Header.Set("Authorization", "Bearer source-token")
			request = request.WithContext(context.WithValue(request.Context(), employeeReadActorKey{}, "merchant-a"))
			response := httptest.NewRecorder()
			permitted := verifyEmployeeReadAuthorization(response, request, employeeRecheckIdentity{actor: tc.actor, readErr: tc.err})
			if response.Code != tc.want || permitted != (tc.want == 200) {
				t.Fatalf("merchant authorization permitted=%t status=%d want=%d", permitted, response.Code, tc.want)
			}
		})
	}
}
