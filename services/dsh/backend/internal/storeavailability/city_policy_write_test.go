package storeavailability

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

type recordingPolicyWriter struct {
	count      int
	lastActor  string
	lastChange CityPolicyChange
	err        error
}

func (writer *recordingPolicyWriter) ApplyCityPolicy(_ context.Context, actorID string, change CityPolicyChange) (CityPolicy, bool, error) {
	writer.count++
	writer.lastActor, writer.lastChange = actorID, change
	if writer.err != nil {
		return CityPolicy{}, false, writer.err
	}
	return CityPolicy{CityID: change.CityID, Version: change.ExpectedVersion + 1,
		MaxPauseSeconds: change.MaxPauseSeconds, MaxPreparationMinutes: change.MaxPreparationMinutes,
		ChangedByActor: actorID, ChangeReason: change.Reason, UpdatedAt: time.Now().UTC()}, false, nil
}

func TestCityPolicyWriterRequiresExactIdentityScopeAndCompleteChange(t *testing.T) {
	for _, tc := range []struct {
		name               string
		identity           IdentitySessions
		token, payload     string
		writerError        error
		wantStatus, writes int
	}{
		{"authorized zero values", fakeIdentity{actor: VerifiedActor{Subject: "operator-one", Role: OperatorRole}}, "token", `{"operationId":"city-policyaaa","expectedVersion":0,"maxPauseSeconds":0,"maxPreparationMinutes":0,"reason":"Initial reviewed limits"}`, nil, 200, 1},
		{"operator not permitted", fakeIdentity{actor: VerifiedActor{Subject: "operator-one", Role: OperatorRole}, permissionDenied: true}, "token", `{"operationId":"city-policyaaa","expectedVersion":0,"maxPauseSeconds":0,"maxPreparationMinutes":0,"reason":"Reviewed"}`, nil, 403, 0},
		{"merchant denied", fakeIdentity{actor: VerifiedActor{Subject: "merchant-one", Role: MerchantRole}}, "token", `{"operationId":"city-policyaaa","expectedVersion":0,"maxPauseSeconds":0,"maxPreparationMinutes":0,"reason":"Reviewed"}`, nil, 403, 0},
		{"revoked token", fakeIdentity{denied: true}, "token", `{"operationId":"city-policyaaa","expectedVersion":0,"maxPauseSeconds":0,"maxPreparationMinutes":0,"reason":"Reviewed"}`, nil, 401, 0},
		{"no bearer", fakeIdentity{actor: VerifiedActor{Subject: "operator-one", Role: OperatorRole}}, "", `{"operationId":"city-policyaaa","expectedVersion":0,"maxPauseSeconds":0,"maxPreparationMinutes":0,"reason":"Reviewed"}`, nil, 401, 0},
		{"no expected version", fakeIdentity{actor: VerifiedActor{Subject: "operator-one", Role: OperatorRole}}, "token", `{"operationId":"city-policyaaa","maxPauseSeconds":0,"maxPreparationMinutes":0,"reason":"Reviewed"}`, nil, 400, 0},
		{"no max pause", fakeIdentity{actor: VerifiedActor{Subject: "operator-one", Role: OperatorRole}}, "token", `{"operationId":"city-policyaaa","expectedVersion":0,"maxPreparationMinutes":0,"reason":"Reviewed"}`, nil, 400, 0},
		{"no preparation", fakeIdentity{actor: VerifiedActor{Subject: "operator-one", Role: OperatorRole}}, "token", `{"operationId":"city-policyaaa","expectedVersion":0,"maxPauseSeconds":0,"reason":"Reviewed"}`, nil, 400, 0},
		{"unsupported key", fakeIdentity{actor: VerifiedActor{Subject: "operator-one", Role: OperatorRole}}, "token", `{"operationId":"city-policyaaa","expectedVersion":0,"maxPauseSeconds":0,"maxPreparationMinutes":0,"reason":"Reviewed","admin":true}`, nil, 400, 0},
		{"invalid policy bounds", fakeIdentity{actor: VerifiedActor{Subject: "operator-one", Role: OperatorRole}}, "token", `{"operationId":"city-policyaaa","expectedVersion":0,"maxPauseSeconds":31536001,"maxPreparationMinutes":0,"reason":"Reviewed"}`, nil, 400, 0},
		{"owner version conflict", fakeIdentity{actor: VerifiedActor{Subject: "operator-one", Role: OperatorRole}}, "token", `{"operationId":"city-policyaaa","expectedVersion":3,"maxPauseSeconds":15,"maxPreparationMinutes":10,"reason":"Reviewed"}`, ErrPolicyVersionConflict, 409, 1},
		{"key reused", fakeIdentity{actor: VerifiedActor{Subject: "operator-one", Role: OperatorRole}}, "token", `{"operationId":"city-policyaaa","expectedVersion":3,"maxPauseSeconds":15,"maxPreparationMinutes":10,"reason":"Reviewed"}`, ErrOperationConflict, 409, 1},
		{"unknown persisted write result", fakeIdentity{actor: VerifiedActor{Subject: "operator-one", Role: OperatorRole}}, "token", `{"operationId":"city-policyaaa","expectedVersion":3,"maxPauseSeconds":15,"maxPreparationMinutes":10,"reason":"Reviewed"}`, ErrUnknownResult, 503, 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			writer := &recordingPolicyWriter{err: tc.writerError}
			reader := &recordedCityPolicyReader{}
			h, err := NewCityPolicyHandler(tc.identity, reader, writer)
			if err != nil {
				t.Fatal(err)
			}
			req := httptest.NewRequest(http.MethodPatch, "/v1/operators/cities/city-a/store-availability-policy", bytes.NewBufferString(tc.payload))
			req.Header.Set("Content-Type", "application/json")
			if tc.token != "" {
				req.Header.Set("Authorization", "Bearer "+tc.token)
			}
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, req)
			if rec.Code != tc.wantStatus || writer.count != tc.writes || reader.reads != 0 {
				t.Fatalf("status=%d want=%d writes=%d wantWrites=%d reads=%d body=%s", rec.Code, tc.wantStatus, writer.count, tc.writes, reader.reads, rec.Body.String())
			}
			if rec.Header().Get("Cache-Control") != "no-store" {
				t.Fatal("policy response is cacheable")
			}
			if tc.wantStatus == 200 {
				var reply struct {
					Policy CityPolicy `json:"policy"`
					Replay bool       `json:"replay"`
				}
				if err = json.Unmarshal(rec.Body.Bytes(), &reply); err != nil || reply.Policy.Version != 1 || reply.Policy.MaxPauseSeconds != 0 || reply.Replay {
					t.Fatalf("bad policy writer readback: %+v %v", reply, err)
				}
				if writer.lastActor != "operator-one" || writer.lastChange.CityID != "city-a" {
					t.Fatal("unverified actor/city used")
				}
			}
		})
	}
}
func TestCityPolicyWriterCannotAdmitNilWriterOrAdditionalWriters(t *testing.T) {
	id := fakeIdentity{actor: VerifiedActor{Subject: "operator-one", Role: OperatorRole}}
	reader := &recordedCityPolicyReader{}
	if _, err := NewCityPolicyHandler(id, reader, (CityPolicyWriter)(nil)); !errors.Is(err, ErrPolicyUnavailable) {
		t.Fatalf("nil writer admitted %v", err)
	}
	if _, err := NewCityPolicyHandler(id, reader, &recordingPolicyWriter{}, &recordingPolicyWriter{}); !errors.Is(err, ErrPolicyUnavailable) {
		t.Fatalf("duplicate writers admitted %v", err)
	}
}
