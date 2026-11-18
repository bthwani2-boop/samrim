package session

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type operatorPermissionManagerSpy struct {
	called int
	last   OperatorPermissionCommand
	err    error
}

func (s *operatorPermissionManagerSpy) ManageOperatorPermission(_ context.Context, _ string, c OperatorPermissionCommand) (OperatorPermissionResult, error) {
	s.called++
	s.last = c
	if s.err != nil {
		return OperatorPermissionResult{}, s.err
	}
	return OperatorPermissionResult{TargetActorID: c.TargetActorID, Permission: c.Permission, State: c.State, Version: 1}, nil
}
func validOperatorAdminBody() string {
	return `{"state":"ACTIVE","expectedVersion":0,"operationId":"synthetic-operator-grant-001","reason":"Explicit isolated Operator permission grant"}`
}
func canonicalTestBearer(t *testing.T) string {
	t.Helper()
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		t.Fatal(err)
	}
	return "Bearer " + base64.RawURLEncoding.EncodeToString(raw)
}
func operatorAdminTestRequest(t *testing.T, path, body string) *http.Request {
	t.Helper()
	req := httptest.NewRequest(http.MethodPatch, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", canonicalTestBearer(t))
	return req
}
func TestOperatorPermissionManagementHTTPRejectsUnsafeRequestsBeforeOwnerRead(t *testing.T) {
	path := "/v1/operators/synthetic-operator-b/permissions/operations"
	for _, tc := range []struct {
		name      string
		prepare   func(*http.Request)
		url, body string
		status    int
	}{
		{"no bearer", func(r *http.Request) { r.Header.Del("Authorization") }, path, validOperatorAdminBody(), 401},
		{"malformed bearer", func(r *http.Request) { r.Header.Set("Authorization", "Bearer forged") }, path, validOperatorAdminBody(), 401},
		{"duplicate bearer", func(r *http.Request) { r.Header.Add("Authorization", "Bearer another") }, path, validOperatorAdminBody(), 401},
		{"forged actor query", nil, path + "?actorId=original-operator", validOperatorAdminBody(), 400},
		{"unknown permission", nil, "/v1/operators/synthetic-operator-b/permissions/root", validOperatorAdminBody(), 404},
		{"path traversal", nil, "/v1/operators/../permissions/operations", validOperatorAdminBody(), 404},
		{"missing required expected version", nil, path, `{"state":"ACTIVE","operationId":"synthetic-op-001","reason":"Sample explicit grant reason"}`, 400},
		{"unknown extra field", nil, path, `{"state":"ACTIVE","expectedVersion":0,"operationId":"synthetic-op-001","reason":"Sample explicit grant reason","actorId":"forged"}`, 400},
		{"duplicate field", nil, path, `{"state":"REVOKED","state":"ACTIVE","expectedVersion":0,"operationId":"synthetic-op-001","reason":"Sample explicit grant reason"}`, 400},
		{"two JSON objects", nil, path, validOperatorAdminBody() + " {}", 400},
		{"insufficient reason", nil, path, `{"state":"ACTIVE","expectedVersion":0,"operationId":"synthetic-op-001","reason":"ok"}`, 400},
		{"missing JSON content-type", func(r *http.Request) { r.Header.Del("Content-Type") }, path, validOperatorAdminBody(), 400},
		{"body exceeds 2048", nil, path, validOperatorAdminBody() + strings.Repeat(" ", 2200), 400},
	} {
		t.Run(tc.name, func(t *testing.T) {
			spy := &operatorPermissionManagerSpy{}
			request := operatorAdminTestRequest(t, tc.url, tc.body)
			if tc.prepare != nil {
				tc.prepare(request)
			}
			recorder := httptest.NewRecorder()
			NewOperatorPermissionManagementHandler(spy).ServeHTTP(recorder, request)
			if recorder.Code != tc.status {
				t.Fatalf("status=%d want=%d", recorder.Code, tc.status)
			}
			if spy.called != 0 {
				t.Fatal("unsafe mutation reached Identity writer")
			}
			if recorder.Header().Get("Cache-Control") != "no-store" {
				t.Fatal("missing private no-store")
			}
			if authorization := request.Header.Get("Authorization"); authorization != "" && strings.Contains(recorder.Body.String(), authorization) {
				t.Fatal("credential echoed in response")
			}
		})
	}
}

func TestOperatorPermissionManagementHTTPOwnershipTransport(t *testing.T) {
	spy := &operatorPermissionManagerSpy{}
	req := operatorAdminTestRequest(t, "/v1/operators/synthetic-operator-b/permissions/operations", validOperatorAdminBody())
	req.Header.Set("X-Actor-ID", "forged-original-root")
	req.Header.Set("X-Role", "operator")
	rr := httptest.NewRecorder()
	NewOperatorPermissionManagementHandler(spy).ServeHTTP(rr, req)
	if rr.Code != 200 || spy.called != 1 {
		t.Fatalf("expected one verified transport call: status=%d count=%d", rr.Code, spy.called)
	}
	if spy.last.TargetActorID != "synthetic-operator-b" || spy.last.Permission != "operations" || spy.last.ExpectedVersion != 0 || spy.last.State != "ACTIVE" {
		t.Fatalf("command unexpectedly sourced from forged headers: %+v", spy.last)
	}
	if rr.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("missing no-store")
	}
}
func TestOperatorPermissionManagementHTTPMapsOwnerFailuresWithoutLeaks(t *testing.T) {
	path := "/v1/operators/synthetic-operator-b/permissions/operations"
	for _, tc := range []struct {
		err      error
		code     int
		expected string
	}{
		{ErrUnauthorized, 401, "UNAUTHORIZED"},
		{ErrOperatorAdminForbidden, 403, "FORBIDDEN"},
		{ErrOperatorAdminTargetNotFound, 404, "NOT_FOUND"},
		{ErrOperatorAdminConflict, 409, "CONFLICT"},
		{errors.New("sensitive SQL diagnosis secret"), 503, "OWNER_UNAVAILABLE"},
	} {
		spy := &operatorPermissionManagerSpy{err: tc.err}
		rr := httptest.NewRecorder()
		NewOperatorPermissionManagementHandler(spy).ServeHTTP(rr, operatorAdminTestRequest(t, path, validOperatorAdminBody()))
		if rr.Code != tc.code || !strings.Contains(rr.Body.String(), tc.expected) || strings.Contains(rr.Body.String(), "sensitive SQL diagnosis") {
			t.Fatalf("owner failure leaked or mapped incorrectly: status=%d body=%s", rr.Code, rr.Body.String())
		}
	}
}

func TestOperatorPermissionManagementHTTPAcceptsBoundedChunkedBody(t *testing.T) {
	spy := &operatorPermissionManagerSpy{}
	req := operatorAdminTestRequest(t,
		"/v1/operators/synthetic-operator-b/permissions/operations", validOperatorAdminBody())
	req.ContentLength = -1
	req.TransferEncoding = []string{"chunked"}
	rr := httptest.NewRecorder()
	NewOperatorPermissionManagementHandler(spy).ServeHTTP(rr, req)
	if rr.Code != 200 || spy.called != 1 {
		t.Fatalf("bounded HTTP chunked JSON rejected: status=%d count=%d", rr.Code, spy.called)
	}
}

func TestOperatorPermissionManagementHTTPRejectsWrongMethodsAndUnavailableOwner(t *testing.T) {
	path := "/v1/operators/synthetic-operator-b/permissions/operations"
	for _, method := range []string{http.MethodGet, http.MethodPost, http.MethodPut, http.MethodDelete} {
		t.Run(method, func(t *testing.T) {
			spy := &operatorPermissionManagerSpy{}
			req := operatorAdminTestRequest(t, path, validOperatorAdminBody())
			req.Method = method
			rr := httptest.NewRecorder()
			NewOperatorPermissionManagementHandler(spy).ServeHTTP(rr, req)
			if rr.Code != 405 || spy.called != 0 || rr.Header().Get("Allow") != "PATCH" {
				t.Fatalf("incorrect method guard for %s: %d calls=%d", method, rr.Code, spy.called)
			}
		})
	}
	req := operatorAdminTestRequest(t, path, validOperatorAdminBody())
	rr := httptest.NewRecorder()
	NewOperatorPermissionManagementHandler(nil).ServeHTTP(rr, req)
	if rr.Code != 503 || !strings.Contains(rr.Body.String(), "OWNER_UNAVAILABLE") {
		t.Fatalf("missing Identity owner must fail closed, got %d", rr.Code)
	}
}
