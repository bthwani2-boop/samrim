package storeavailability

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

type recordedCityPolicyReader struct {
	reads int
	value CityPolicy
	err   error
}

func (reader *recordedCityPolicyReader) ReadCityPolicy(_ context.Context, cityID string) (CityPolicy, error) {
	reader.reads++
	if reader.err != nil {
		return CityPolicy{}, reader.err
	}
	result := reader.value
	result.CityID = cityID
	return result, nil
}

func TestCityPolicyReadRequiresCurrentPlatformPoliciesPermission(t *testing.T) {
	for _, tc := range []struct {
		name, token, path, method string
		identity                  IdentitySessions
		sourceErr                 error
		wantStatus, wantReads     int
	}{
		{"authorized operator", "verified", "/v1/operators/cities/city-a/store-availability-policy", "GET", fakeIdentity{actor: VerifiedActor{Subject: "operator-a", Role: OperatorRole}}, nil, 200, 1},
		{"missing session", "", "/v1/operators/cities/city-a/store-availability-policy", "GET", fakeIdentity{actor: VerifiedActor{Subject: "operator-a", Role: OperatorRole}}, nil, 401, 0},
		{"revoked session", "revoked", "/v1/operators/cities/city-a/store-availability-policy", "GET", fakeIdentity{denied: true}, nil, 401, 0},
		{"merchant is not operator", "verified", "/v1/operators/cities/city-a/store-availability-policy", "GET", fakeIdentity{actor: VerifiedActor{Subject: "merchant-a", Role: MerchantRole}}, nil, 403, 0},
		{"operator without platform_policies", "verified", "/v1/operators/cities/city-a/store-availability-policy", "GET", fakeIdentity{actor: VerifiedActor{Subject: "operator-a", Role: OperatorRole}, permissionDenied: true}, nil, 403, 0},
		{"invalid city ID", "verified", "/v1/operators/cities/CITY!/store-availability-policy", "GET", fakeIdentity{actor: VerifiedActor{Subject: "operator-a", Role: OperatorRole}}, nil, 400, 0},
		{"query input forbidden", "verified", "/v1/operators/cities/city-a/store-availability-policy?actorId=other", "GET", fakeIdentity{actor: VerifiedActor{Subject: "operator-a", Role: OperatorRole}}, nil, 400, 0},
		{"no authorized policy default", "verified", "/v1/operators/cities/city-a/store-availability-policy", "GET", fakeIdentity{actor: VerifiedActor{Subject: "operator-a", Role: OperatorRole}}, ErrPolicyUnavailable, 503, 1},
		{"unavailable Identity", "verified", "/v1/operators/cities/city-a/store-availability-policy", "GET", unavailableIdentitySessionAdapter{}, nil, 503, 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			repo := &recordedCityPolicyReader{value: CityPolicy{Version: 2, MaxPauseSeconds: 900, MaxPreparationMinutes: 40, ChangedByActor: "operator-a", ChangeReason: "Reviewed city limits", UpdatedAt: time.Date(2026, 11, 15, 12, 0, 0, 0, time.UTC)}, err: tc.sourceErr}
			handler, err := NewCityPolicyHandler(tc.identity, repo)
			if err != nil {
				t.Fatal(err)
			}
			req := httptest.NewRequest(tc.method, tc.path, nil)
			if tc.token != "" {
				req.Header.Set("Authorization", "Bearer "+tc.token)
			}
			result := httptest.NewRecorder()
			handler.ServeHTTP(result, req)
			if result.Code != tc.wantStatus || repo.reads != tc.wantReads {
				t.Fatalf("status=%d reads=%d wantStatus=%d wantReads=%d body=%s", result.Code, repo.reads, tc.wantStatus, tc.wantReads, result.Body.String())
			}
			if result.Header().Get("Cache-Control") != "no-store" {
				t.Fatal("policy read was cacheable")
			}
			if tc.wantStatus == 200 {
				var got CityPolicy
				if err := json.Unmarshal(result.Body.Bytes(), &got); err != nil {
					t.Fatal(err)
				}
				if got.CityID != "city-a" || got.Version != 2 || got.MaxPauseSeconds != 900 ||
					got.MaxPreparationMinutes != 40 || got.ChangedByActor != "operator-a" {
					t.Fatalf("not canonical city policy: %+v", got)
				}
			}
		})
	}
}

type unavailableIdentitySessionAdapter struct{}

func (unavailableIdentitySessionAdapter) ResolveCurrentSession(context.Context, string) (VerifiedActor, error) {
	return VerifiedActor{}, ErrIdentityUnavailable
}
func (unavailableIdentitySessionAdapter) RequireOperatorPermission(context.Context, string, string, string) error {
	return ErrIdentityUnavailable
}

func TestCityPolicyReadDeniesUnsupportedMethods(t *testing.T) {
	repo := &recordedCityPolicyReader{}
	identity := fakeIdentity{actor: VerifiedActor{Subject: "operator-a", Role: OperatorRole}}
	handler, err := NewCityPolicyHandler(identity, repo)
	if err != nil {
		t.Fatal(err)
	}
	for _, method := range []string{"POST", "PATCH", "DELETE", "HEAD"} {
		req := httptest.NewRequest(method, "/v1/operators/cities/city-a/store-availability-policy", nil)
		req.Header.Set("Authorization", "Bearer verified")
		result := httptest.NewRecorder()
		handler.ServeHTTP(result, req)
		if result.Code != http.StatusMethodNotAllowed || repo.reads != 0 {
			t.Fatalf("%s status=%d reads=%d", method, result.Code, repo.reads)
		}
	}
	if _, err = NewCityPolicyHandler(nil, repo); !errors.Is(err, ErrUnauthorized) {
		t.Fatal("nil Identity source accepted")
	}
	if _, err = NewCityPolicyHandler(identity, nil); !errors.Is(err, ErrPolicyUnavailable) {
		t.Fatal("nil DSH source accepted")
	}
}
