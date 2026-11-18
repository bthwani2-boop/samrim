package session

import (
	"bytes"
	"database/sql"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestOperatorPasskeyNewRequiresExplicitTrustedRPAndCanonicalOwner(t *testing.T) {
	if _, err := NewOperatorPasskeyAuth(nil, OperatorPasskeyOriginPolicy{
		RPID: "localhost", Origins: []string{"http://localhost:13000"},
	}, true); err == nil {
		t.Fatal("nil Identity owner permitted")
	}
	owner := &PostgresReader{db: &sql.DB{}, schema: "identity_test_passkey_only"}
	if _, err := NewOperatorPasskeyAuth(owner, OperatorPasskeyOriginPolicy{
		RPID: "bthwani.com", Origins: []string{"http://operator.bthwani.com"},
	}, true); err == nil {
		t.Fatal("unsafe RP origin configured")
	}
	if _, err := NewOperatorPasskeyAuth(owner, OperatorPasskeyOriginPolicy{
		RPID: "localhost", Origins: []string{"http://localhost:13000"},
	}, false); err == nil {
		t.Fatal("local HTTP outside isolated env")
	}
	if svc, err := NewOperatorPasskeyAuth(owner, OperatorPasskeyOriginPolicy{
		RPID: "localhost", Origins: []string{"http://localhost:13000"},
	}, true); err != nil || svc == nil {
		t.Fatalf("isolated FIDO2 config failed: %v", err)
	}
}

func TestOperatorPasskeyHTTPRejectsMaliciousRequestBeforeOwner(t *testing.T) {
	owner := NewOperatorPasskeyHandler(&OperatorPasskeyAuth{})
	begin := OperatorPasskeyOptionsPath
	finish := OperatorPasskeyFinishPath
	cases := []struct {
		name, path, method, body, contentType string
		modify                                func(*http.Request)
		code                                  int
	}{
		{"unknown route", "/v1/operators/passkey/authorize", "POST", "", "", nil, 404},
		{"wrong method", begin, "GET", "", "", nil, 405},
		{"query actor spoof", begin + "?actorId=original", "POST", "", "", nil, 400},
		{"body on options", begin, "POST", "{}", "application/json", nil, 400},
		{"auth header on options", begin, "POST", "", "", func(r *http.Request) { r.Header.Set("Authorization", "Bearer forged") }, 400},
		{"forged actor header", begin, "POST", "", "", func(r *http.Request) { r.Header.Set("X-Actor-ID", "original") }, 400},
		{"no finish body", finish, "POST", "", "application/json", nil, 400},
		{"wrong content type", finish, "POST", "{}", "text/plain", nil, 400},
		{"unknown field", finish, "POST", `{"ceremonyId":"abc","credential":{},"role":"operator"}`, "application/json", nil, 400},
		{"duplicate ceremony field", finish, "POST", `{"ceremonyId":"abc","ceremonyId":"def","credential":{}}`, "application/json", nil, 400},
		{"missing credential", finish, "POST", `{"ceremonyId":"abc"}`, "application/json", nil, 400},
		{"two concatenated objects", finish, "POST", `{"ceremonyId":"abc","credential":{}} {}`, "application/json", nil, 400},
		{"body over 64KB", finish, "POST", strings.Repeat(" ", 65537), "application/json", nil, 400},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(tc.method, tc.path, bytes.NewBufferString(tc.body))
			if tc.contentType != "" {
				req.Header.Set("Content-Type", tc.contentType)
			}
			if tc.modify != nil {
				tc.modify(req)
			}
			recorder := httptest.NewRecorder()
			owner.ServeHTTP(recorder, req)
			if recorder.Header().Get("Cache-Control") != "no-store" {
				t.Fatal("credential or challenge response cacheable")
			}
			expected := tc.code

			if recorder.Code != expected {
				t.Fatalf("unexpected status %d (expected %d)", recorder.Code, expected)
			}
			if bytes.Contains(recorder.Body.Bytes(), []byte("Bearer forged")) {
				t.Fatal("private authorization echoed")
			}
		})
	}
}
