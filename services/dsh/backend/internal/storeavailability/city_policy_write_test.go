package storeavailability

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"go/ast"
	"go/parser"
	"go/token"
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
		{"duplicate policy amount", fakeIdentity{actor: VerifiedActor{Subject: "operator-one", Role: OperatorRole}}, "token", `{"operationId":"city-policyaaa","expectedVersion":0,"maxPauseSeconds":0,"MaxPauseSeconds":900,"maxPreparationMinutes":0,"reason":"Reviewed"}`, nil, 400, 0},
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

func TestFulfillmentPolicyUsesLiteralBoundSQL(t *testing.T) {
	// The schema is bound by dbscope; no dynamically assembled statements
	// should enter the owner transaction, including a constant projection.
	file, err := parser.ParseFile(token.NewFileSet(), "fulfillment_policy.go", nil, 0)
	if err != nil {
		t.Fatal(err)
	}
	checked := 0
	ast.Inspect(file, func(node ast.Node) bool {
		call, ok := node.(*ast.CallExpr)
		if !ok {
			return true
		}
		method, ok := call.Fun.(*ast.SelectorExpr)
		if !ok || (method.Sel.Name != "QueryRowContext" && method.Sel.Name != "QueryContext" && method.Sel.Name != "ExecContext") {
			return true
		}
		checked++
		if len(call.Args) < 2 {
			t.Error("SQL statement missing")
			return true
		}
		statement, ok := call.Args[1].(*ast.BasicLit)
		if !ok || statement.Kind != token.STRING {
			t.Errorf("%s must use a literal parameterized statement", method.Sel.Name)
		}
		return true
	})
	if checked == 0 {
		t.Fatal("no owner SQL statements checked")
	}
}

type fulfillmentTransportIdentity struct {
	resolves, permissions                 int
	secondActor                           string
	secondResolveErr, secondPermissionErr error
}

func (i *fulfillmentTransportIdentity) ResolveCurrentSession(_ context.Context, token string) (VerifiedActor, error) {
	i.resolves++
	if token != "verified" {
		return VerifiedActor{}, ErrUnauthorized
	}
	if i.resolves == 2 {
		if i.secondResolveErr != nil {
			return VerifiedActor{}, i.secondResolveErr
		}
		if i.secondActor != "" {
			return VerifiedActor{Subject: i.secondActor, Role: OperatorRole}, nil
		}
	}
	return VerifiedActor{Subject: "operator-a", Role: OperatorRole}, nil
}

func (i *fulfillmentTransportIdentity) RequireOperatorPermission(_ context.Context, token, actor, permission string) error {
	i.permissions++
	if token != "verified" || permission != "platform_policies" || (actor != "operator-a" && actor != i.secondActor) {
		return ErrForbidden
	}
	if i.permissions == 2 {
		return i.secondPermissionErr
	}
	return nil
}

type fulfillmentTransportOwner struct {
	recordedCityPolicyReader
	reads, writes                            int
	city, relation, actor, operation, reason string
	expected                                 int64
	modes                                    []string
	readErr, writeErr                        error
	replay                                   bool
}

func (o *fulfillmentTransportOwner) ReadCityFulfillmentPolicy(_ context.Context, city, relation string) (CityFulfillmentPolicy, error) {
	o.reads++
	o.city, o.relation = city, relation
	if o.readErr != nil {
		return CityFulfillmentPolicy{}, o.readErr
	}
	return CityFulfillmentPolicy{CityID: city, Relation: relation, Version: 2, AllowedModes: []string{"CUSTOMER_PICKUP"}}, nil
}

func (o *fulfillmentTransportOwner) ApplyCityFulfillmentPolicy(_ context.Context, actor, city, relation, operation string, expected int64, modes []string, reason string) (CityFulfillmentPolicy, bool, error) {
	o.writes++
	o.actor, o.city, o.relation, o.operation, o.expected, o.modes, o.reason = actor, city, relation, operation, expected, modes, reason
	if o.writeErr != nil {
		return CityFulfillmentPolicy{}, false, o.writeErr
	}
	return CityFulfillmentPolicy{CityID: city, Relation: relation, Version: expected + 1, AllowedModes: modes}, o.replay, nil
}

// These tests exercise the HTTP contract without a database. The existing
// TestRealCustomerCartPostgres suite separately proves durable owner behavior.
func TestFulfillmentPolicyTransportContract(t *testing.T) {
	const path = "/v1/operators/cities/city-a/fulfillment-policy/DIRECT"
	const command = `{"operationId":"mode-policy-001","expectedVersion":2,"allowedModes":[],"reason":"Reviewed limits"}`
	for _, tc := range []struct {
		name, method, suffix, body, token, contentType, encoding string
		identity                                                 fulfillmentTransportIdentity
		owner                                                    fulfillmentTransportOwner
		status, reads, writes, resolves, permissions             int
	}{
		{name: "read", method: "GET", token: "verified", status: 200, reads: 1, resolves: 2, permissions: 2},
		{name: "read anonymous", method: "GET", status: 401},
		{name: "read revoked", method: "GET", token: "verified", identity: fulfillmentTransportIdentity{secondResolveErr: ErrUnauthorized}, status: 401, reads: 1, resolves: 2, permissions: 1},
		{name: "read permission revoked", method: "GET", token: "verified", identity: fulfillmentTransportIdentity{secondPermissionErr: ErrForbidden}, status: 403, reads: 1, resolves: 2, permissions: 2},
		{name: "read actor changed", method: "GET", token: "verified", identity: fulfillmentTransportIdentity{secondActor: "operator-b"}, status: 403, reads: 1, resolves: 2, permissions: 2},
		{name: "read identity unavailable", method: "GET", token: "verified", identity: fulfillmentTransportIdentity{secondResolveErr: ErrIdentityUnavailable}, status: 503, reads: 1, resolves: 2, permissions: 1},
		{name: "read owner unavailable", method: "GET", token: "verified", owner: fulfillmentTransportOwner{readErr: ErrPolicyUnavailable}, status: 503, reads: 1, resolves: 1, permissions: 1},
		{name: "read body forbidden", method: "GET", token: "verified", body: "{}", status: 400, resolves: 1, permissions: 1},
		{name: "read empty query forbidden", method: "GET", token: "verified", suffix: "?", status: 400},
		{name: "read query forbidden", method: "GET", token: "verified", suffix: "?actorId=other", status: 400},
		{name: "head forbidden", method: "HEAD", token: "verified", status: 405},
		{name: "write explicit deny all", method: "PATCH", token: "verified", body: command, contentType: "application/json", status: 200, writes: 1, resolves: 2, permissions: 2},
		{name: "write replay", method: "PATCH", token: "verified", body: command, contentType: "application/json", owner: fulfillmentTransportOwner{replay: true}, status: 200, writes: 1, resolves: 2, permissions: 2},
		{name: "write actor changed", method: "PATCH", token: "verified", body: command, contentType: "application/json", identity: fulfillmentTransportIdentity{secondActor: "operator-b"}, status: 403, resolves: 2, permissions: 2},
		{name: "write permission revoked", method: "PATCH", token: "verified", body: command, contentType: "application/json", identity: fulfillmentTransportIdentity{secondPermissionErr: ErrForbidden}, status: 403, resolves: 2, permissions: 2},
		{name: "write session revoked", method: "PATCH", token: "verified", body: command, contentType: "application/json", identity: fulfillmentTransportIdentity{secondResolveErr: ErrUnauthorized}, status: 401, resolves: 2, permissions: 1},
		{name: "write duplicate key", method: "PATCH", token: "verified", contentType: "application/json", body: `{"operationId":"mode-policy-001","expectedVersion":2,"ExpectedVersion":3,"allowedModes":[],"reason":"Reviewed limits"}`, status: 400, resolves: 1, permissions: 1},
		{name: "write missing modes", method: "PATCH", token: "verified", contentType: "application/json", body: `{"operationId":"mode-policy-001","expectedVersion":2,"reason":"Reviewed limits"}`, status: 400, resolves: 1, permissions: 1},
		{name: "write null modes", method: "PATCH", token: "verified", contentType: "application/json", body: `{"operationId":"mode-policy-001","expectedVersion":2,"allowedModes":null,"reason":"Reviewed limits"}`, status: 400, resolves: 1, permissions: 1},
		{name: "write wrong media", method: "PATCH", token: "verified", body: command, contentType: "text/plain", status: 400, resolves: 1, permissions: 1},
		{name: "write encoded body", method: "PATCH", token: "verified", body: command, contentType: "application/json", encoding: "gzip", status: 400, resolves: 1, permissions: 1},
		{name: "write stale version", method: "PATCH", token: "verified", body: command, contentType: "application/json", owner: fulfillmentTransportOwner{writeErr: ErrPolicyVersionConflict}, status: 409, writes: 1, resolves: 2, permissions: 2},
		{name: "write conflicting receipt", method: "PATCH", token: "verified", body: command, contentType: "application/json", owner: fulfillmentTransportOwner{writeErr: ErrOperationConflict}, status: 409, writes: 1, resolves: 2, permissions: 2},
		{name: "write unknown result", method: "PATCH", token: "verified", body: command, contentType: "application/json", owner: fulfillmentTransportOwner{writeErr: ErrUnknownResult}, status: 503, writes: 1, resolves: 2, permissions: 2},
	} {
		t.Run(tc.name, func(t *testing.T) {
			identity, owner := tc.identity, tc.owner
			handler, err := NewCityPolicyHandler(&identity, &owner, &recordingPolicyWriter{})
			if err != nil {
				t.Fatal(err)
			}
			req := httptest.NewRequest(tc.method, path+tc.suffix, bytes.NewBufferString(tc.body))
			if tc.token != "" {
				req.Header.Set("Authorization", "Bearer "+tc.token)
			}
			if tc.contentType != "" {
				req.Header.Set("Content-Type", tc.contentType)
			}
			if tc.encoding != "" {
				req.Header.Set("Content-Encoding", tc.encoding)
			}
			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, req)
			if rec.Code != tc.status || owner.reads != tc.reads || owner.writes != tc.writes || identity.resolves != tc.resolves || identity.permissions != tc.permissions {
				t.Fatalf("status=%d reads=%d writes=%d resolves=%d permissions=%d; expected %d/%d/%d/%d/%d", rec.Code, owner.reads, owner.writes, identity.resolves, identity.permissions, tc.status, tc.reads, tc.writes, tc.resolves, tc.permissions)
			}
			if rec.Header().Get("Cache-Control") != "no-store" {
				t.Fatal("policy response cacheable")
			}
			if tc.status != 200 && bytes.Contains(rec.Body.Bytes(), []byte("allowedModes")) {
				t.Fatal("policy data exposed on failure")
			}
			if tc.reads+tc.writes > 0 && (owner.city != "city-a" || owner.relation != "DIRECT") {
				t.Fatal("wrong owner scope")
			}
			if tc.writes > 0 && (owner.actor != "operator-a" || owner.operation != "mode-policy-001" || owner.expected != 2 || owner.modes == nil || len(owner.modes) != 0 || owner.reason != "Reviewed limits") {
				t.Fatal("owner command changed")
			}
			if tc.status == 200 {
				if tc.method == "GET" {
					var result CityFulfillmentPolicy
					if err := json.Unmarshal(rec.Body.Bytes(), &result); err != nil || result.CityID != "city-a" || result.Relation != "DIRECT" || result.Version != 2 || len(result.AllowedModes) != 1 || result.AllowedModes[0] != "CUSTOMER_PICKUP" {
						t.Fatalf("invalid policy readback: %+v %v", result, err)
					}
				} else {
					var result struct {
						Policy CityFulfillmentPolicy `json:"policy"`
						Replay bool                  `json:"replay"`
					}
					if err := json.Unmarshal(rec.Body.Bytes(), &result); err != nil || result.Policy.Version != 3 || result.Policy.AllowedModes == nil || len(result.Policy.AllowedModes) != 0 || result.Replay != owner.replay {
						t.Fatalf("invalid policy receipt: %+v %v", result, err)
					}
				}
			}
		})
	}
}
