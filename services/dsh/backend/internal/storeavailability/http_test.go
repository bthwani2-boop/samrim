package storeavailability

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestHTTPRequiresVerifiedAuthAndRejectsUnknownInput(t *testing.T) {
	count := 0
	s, _ := NewService(fakeIdentity{actor: VerifiedActor{Subject: "merchant-a", Role: MerchantRole}}, fakeGrant{}, fakePolicy{}, fakeRepo{&count})
	handler, err := NewHandler(s)
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name, method, body, token string
		want                      int
	}{
		{"unauthenticated GET", "GET", "", "", 401},
		{"unauthenticated PATCH", "PATCH", `{}`, "", 401},
		{"invalid JWT header", "GET", "", "Bearer whitespace token", 401},
		{"unknown field", "PATCH", `{"operationId":"merchant-0001","admin":true}`, "Bearer valid-token", 400},
		{"invalid JSON", "PATCH", `{"operationId":`, "Bearer valid-token", 400},
		{"oversized request", "PATCH", strings.Repeat("x", 20*1024), "Bearer valid-token", 400},
		{"JSON trailing text", "PATCH", `{}{"another":1}`, "Bearer valid-token", 400},
		{"missing version", "PATCH", `{}`, "Bearer valid-token", 400},
		{"unsupported content type", "PATCH", `{}`, "Bearer valid-token", 400},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(tc.method, "/v1/stores/store-one/availability", strings.NewReader(tc.body))
			if tc.token != "" {
				req.Header.Set("Authorization", tc.token)
			}
			if tc.method == "PATCH" && tc.name != "unsupported content type" {
				req.Header.Set("Content-Type", "application/json")
			}
			w := httptest.NewRecorder()
			handler.ServeHTTP(w, req)
			if w.Code != tc.want {
				t.Fatalf("got %d want %d body %s", w.Code, tc.want, w.Body.String())
			}
			if got := w.Header().Get("Cache-Control"); got != "no-store" {
				t.Errorf("expected no-store, got %q", got)
			}
		})
	}
	if count != 0 {
		t.Fatalf("unauthorized input mutated owner %d times", count)
	}
	duplicate := httptest.NewRequest("GET", "/v1/stores/store-one/availability", nil)
	duplicate.Header.Add("Authorization", "Bearer token-one")
	duplicate.Header.Add("Authorization", "Bearer token-two")
	duplicateResult := httptest.NewRecorder()
	handler.ServeHTTP(duplicateResult, duplicate)
	if duplicateResult.Code != http.StatusUnauthorized {
		t.Fatalf("duplicate authorization header returned %d", duplicateResult.Code)
	}
}

func TestHTTPResponseUsesStableNoSecretErrorCodes(t *testing.T) {
	deny := fakeIdentity{actor: VerifiedActor{Subject: "merchant-a", Role: MerchantRole}}
	count := 0
	s, _ := NewService(deny, fakeGrant{denied: true}, fakePolicy{}, fakeRepo{&count})
	handler, _ := NewHandler(s)
	req := httptest.NewRequest("GET", "/v1/stores/not-owned/availability", nil)
	req.Header.Set("Authorization", "Bearer sentinel")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	if w.Code != http.StatusForbidden {
		t.Fatal(w.Code)
	}
	var resp struct {
		Code string `json:"code"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil || resp.Code != "STORE_OPERATION_FORBIDDEN" {
		t.Fatalf("resp %+v err %v", resp, err)
	}
	if bytes.Contains(w.Body.Bytes(), []byte("sentinel")) {
		t.Fatal("secret leaked")
	}
	if _, err := NewHandler(nil); err == nil {
		t.Fatal("handler started without owner service")
	}
}

func TestHTTPAcceptsOneScopedValidatedUpdate(t *testing.T) {
	count := 0
	s, _ := NewService(fakeIdentity{actor: VerifiedActor{Subject: "merchant-a", Role: MerchantRole}}, fakeGrant{}, fakePolicy{}, fakeRepo{&count})
	handler, _ := NewHandler(s)
	body := `{"operationId":"merchant-0001","expectedVersion":1,"weekly":[{"weekday":1,"opens":600,"closes":1200}],"preparationMinutes":25,"reason":"Schedule update"}`
	for _, contentType := range []string{"application/json", "application/json; charset=utf-8"} {
		req := httptest.NewRequest("PATCH", "/v1/stores/store-one/availability", strings.NewReader(body))
		req.Header.Set("Authorization", "Bearer validated-token")
		req.Header.Set("Content-Type", contentType)
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("content type %s got %d body %s", contentType, w.Code, w.Body.String())
		}
		var result struct {
			Availability Snapshot `json:"availability"`
			Replay       bool     `json:"replay"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil || result.Replay || result.Availability.Version != 2 {
			t.Fatalf("%+v %v", result, err)
		}
	}
	if count != 2 {
		t.Fatalf("expected two validated changes, count %d", count)
	}
}
