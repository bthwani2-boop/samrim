package storeavailability

import (
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func testOpaqueIdentityToken() string {
	return base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{0x25}, 32))
}

type unavailableIdentitySession struct{}

func (unavailableIdentitySession) ResolveCurrentSession(context.Context, string) (VerifiedActor, error) {
	return VerifiedActor{}, ErrIdentityUnavailable
}
func (unavailableIdentitySession) RequireOperatorPermission(context.Context, string, string, string) error {
	return ErrIdentityUnavailable
}

func TestIdentityOutageCannotMutateStoreAndReturns503(t *testing.T) {
	count := 0
	svc, err := NewService(unavailableIdentitySession{}, fakeGrant{}, fakePolicy{}, fakeRepo{applies: &count})
	if err != nil {
		t.Fatal(err)
	}
	_, _, err = svc.Change(context.Background(), "token", validChange())
	if !errors.Is(err, ErrIdentityUnavailable) || count != 0 {
		t.Fatalf("Identity unavailable mutating Store: count=%d err=%v", count, err)
	}
	handler, _ := NewHandler(svc)
	request := httptest.NewRequest(http.MethodGet, "/v1/stores/store-one/availability", nil)
	request.Header.Set("Authorization", "Bearer opaque-token")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusServiceUnavailable || !strings.Contains(response.Body.String(), "IDENTITY_OWNER_UNAVAILABLE") {
		t.Fatalf("Identity outage not surfaced safely: %d %s", response.Code, response.Body.String())
	}
}
