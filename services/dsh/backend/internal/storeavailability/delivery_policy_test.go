package storeavailability

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http/httptest"
	"testing"
	"time"
)

type deliveryPolicyTestReader struct {
	recordedCityPolicyReader
	readsDelivery int
	fail          bool
}

func (r *deliveryPolicyTestReader) ReadCityDeliveryPolicy(_ context.Context, city string) (CityDeliveryPolicy, error) {
	r.readsDelivery++
	if r.fail {
		return CityDeliveryPolicy{}, ErrPolicyUnavailable
	}
	return CityDeliveryPolicy{CityID: city, Version: 2, RadiusMetres: 30000, UpdatedAt: time.Date(2026, 11, 24, 0, 0, 0, 0, time.UTC)}, nil
}
func TestDeliveryPolicyReadBoundary(t *testing.T) {
	for _, tc := range []struct {
		name, method, suffix, token string
		identity                    fakeIdentity
		fail                        bool
		status, reads               int
	}{
		{"current", "GET", "", "verified", fakeIdentity{actor: VerifiedActor{Subject: "operator-a", Role: OperatorRole}}, false, 200, 1},
		{"missing", "GET", "", "verified", fakeIdentity{actor: VerifiedActor{Subject: "operator-a", Role: OperatorRole}}, true, 503, 1},
		{"no token", "GET", "", "", fakeIdentity{}, false, 401, 0},
		{"wrong role", "GET", "", "verified", fakeIdentity{actor: VerifiedActor{Subject: "merchant-a", Role: MerchantRole}}, false, 403, 0},
		{"no grant", "GET", "", "verified", fakeIdentity{actor: VerifiedActor{Subject: "operator-a", Role: OperatorRole}, permissionDenied: true}, false, 403, 0},
		{"foreign selector", "GET", "?actorId=other", "verified", fakeIdentity{actor: VerifiedActor{Subject: "operator-a", Role: OperatorRole}}, false, 400, 0},
		{"write forbidden", "PATCH", "", "verified", fakeIdentity{actor: VerifiedActor{Subject: "operator-a", Role: OperatorRole}}, false, 405, 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			reader := &deliveryPolicyTestReader{fail: tc.fail}
			handler, err := NewCityPolicyHandler(tc.identity, reader)
			if err != nil {
				t.Fatal(err)
			}
			req := httptest.NewRequest(tc.method, "/v1/operators/cities/sanaa/delivery-policy"+tc.suffix, nil)
			if tc.token != "" {
				req.Header.Set("Authorization", "Bearer "+tc.token)
			}
			w := httptest.NewRecorder()
			handler.ServeHTTP(w, req)
			if w.Code != tc.status || reader.readsDelivery != tc.reads {
				t.Fatalf("status=%d reads=%d body=%s", w.Code, reader.readsDelivery, w.Body.String())
			}
			if tc.status == 200 && w.Header().Get("Cache-Control") != "no-store" {
				t.Fatal("cacheable policy")
			}
		})
	}
}

func TestDeliveryPolicyRevokedDuringRead(t *testing.T) {
	reader := &deliveryPolicyTestReader{}
	identity := &cityPolicyAuditIdentity{fakeIdentity: fakeIdentity{actor: VerifiedActor{Subject: "operator-a", Role: OperatorRole}}, revokeAfterFirst: true}
	h, err := NewCityPolicyHandler(identity, reader)
	if err != nil {
		t.Fatal(err)
	}
	w := cityAuditRequest(h, "GET", "/v1/operators/cities/sanaa/delivery-policy", "verified")
	if w.Code != 403 || reader.readsDelivery != 1 || identity.calls != 2 {
		t.Fatalf("status=%d reads=%d checks=%d", w.Code, reader.readsDelivery, identity.calls)
	}
}

func TestDeliveryPolicyPreviewBoundary(t *testing.T) {
	const body = `{"expectedVersion":2,"radiusMetres":30000,"distanceMetres":2001,"distanceBands":[{"upToMeters":2000,"ratePerKmMinor":300},{"upToMeters":null,"ratePerKmMinor":200}]}`
	for _, tc := range []struct {
		name, body, token string
		identity          fakeIdentity
		want, reads       int
	}{
		{"valid", body, "verified", fakeIdentity{actor: VerifiedActor{Subject: "operator-a", Role: OperatorRole}}, 200, 1},
		{"stale", `{"expectedVersion":1,"radiusMetres":30000,"distanceMetres":1000,"distanceBands":[{"upToMeters":null,"ratePerKmMinor":200}]}`, "verified", fakeIdentity{actor: VerifiedActor{Subject: "operator-a", Role: OperatorRole}}, 409, 1},
		{"out of radius", `{"expectedVersion":2,"radiusMetres":1000,"distanceMetres":1001,"distanceBands":[{"upToMeters":null,"ratePerKmMinor":200}]}`, "verified", fakeIdentity{actor: VerifiedActor{Subject: "operator-a", Role: OperatorRole}}, 400, 0},
		{"bad band", `{"expectedVersion":2,"radiusMetres":30000,"distanceMetres":1000,"distanceBands":[{"ratePerKmMinor":200}]}`, "verified", fakeIdentity{actor: VerifiedActor{Subject: "operator-a", Role: OperatorRole}}, 400, 0},
		{"no grant", body, "verified", fakeIdentity{actor: VerifiedActor{Subject: "operator-a", Role: OperatorRole}, permissionDenied: true}, 403, 0},
		{"no bearer", body, "", fakeIdentity{}, 401, 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			reader := &deliveryPolicyTestReader{}
			h, err := NewCityPolicyHandler(tc.identity, reader)
			if err != nil {
				t.Fatal(err)
			}
			req := httptest.NewRequest("POST", "/v1/operators/cities/sanaa/delivery-policy/preview", bytes.NewBufferString(tc.body))
			req.Header.Set("Content-Type", "application/json")
			if tc.token != "" {
				req.Header.Set("Authorization", "Bearer "+tc.token)
			}
			w := httptest.NewRecorder()
			h.ServeHTTP(w, req)
			if w.Code != tc.want || reader.readsDelivery != tc.reads {
				t.Fatalf("status=%d reads=%d body=%s", w.Code, reader.readsDelivery, w.Body.String())
			}
			if tc.want == 200 {
				var result map[string]any
				if json.Unmarshal(w.Body.Bytes(), &result) != nil || result["feeYer"] != "601" || result["cityId"] != "sanaa" || result["version"] != float64(2) || result["payable"] != false || len(result) != 6 {
					t.Fatalf("invalid preview: %s", w.Body.String())
				}
			}
		})
	}
}
