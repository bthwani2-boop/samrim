package session

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

type persistentFake struct {
	startCalls, rotateCalls, endCalls int
	rotationErr                       error
}

func (f *persistentFake) StartPersistent(_ context.Context, _ [32]byte) (PersistentGrant, error) {
	f.startCalls++
	return PersistentGrant{RefreshToken: "redacted", RefreshExpiresAt: time.Now().Add(time.Hour)}, nil
}
func (f *persistentFake) RotatePersistent(_ context.Context, _ [32]byte) (PersistentRotation, error) {
	f.rotateCalls++
	if f.rotationErr != nil {
		return PersistentRotation{}, f.rotationErr
	}
	return PersistentRotation{}, ErrUnauthorized
}
func (f *persistentFake) EndPersistent(_ context.Context, _ [32]byte) error { f.endCalls++; return nil }
func TestPersistentHTTPRejectsBadCredentialsAndBody(t *testing.T) {
	f := &persistentFake{}
	h := NewPersistentSessionHandler(f)
	secret := sha256.Sum256([]byte("synthetic-local-secret"))
	token := base64.RawURLEncoding.EncodeToString(secret[:])
	cases := []struct {
		method, path, authorization, body string
		status                            int
	}{
		{"GET", PersistentStartPath, "Bearer " + token, "", 405},
		{"POST", PersistentStartPath, "", "", 401},
		{"POST", PersistentStartPath, "Bearer fake", "", 401},
		{"POST", PersistentStartPath, "Bearer " + token, "{}", 400},
		{"POST", PersistentStartPath + "?actorId=other", "Bearer " + token, "", 400},
		{"POST", PersistentStartPath, "Bearer " + token, "", 201},
		{"POST", PersistentRefreshPath, "Bearer " + token, "", 401},
		{"DELETE", PersistentRefreshPath, "Bearer " + token, "", 204},
	}
	for _, tc := range cases {
		req := httptest.NewRequest(tc.method, tc.path, strings.NewReader(tc.body))
		req.Header.Set("Authorization", tc.authorization)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != tc.status {
			t.Fatalf("%s %s got %d want %d: %s", tc.method, tc.path, rec.Code, tc.status, rec.Body.String())
		}
		if rec.Header().Get("Cache-Control") != "no-store" {
			t.Fatal("auth response may be cached")
		}
	}
	if f.startCalls != 1 || f.rotateCalls != 1 || f.endCalls != 1 {
		t.Fatalf("unexpected owner calls %+v", f)
	}
}
func TestPersistentHTTPRecentDuplicateIsConflictWithoutNewCredential(t *testing.T) {
	f := &persistentFake{rotationErr: ErrRecentRefreshConflict}
	h := NewPersistentSessionHandler(f)
	secret := sha256.Sum256([]byte("independent-refresh-test"))
	token := base64.RawURLEncoding.EncodeToString(secret[:])
	request := httptest.NewRequest("POST", PersistentRefreshPath, nil)
	request.Header.Set("Authorization", "Bearer "+token)
	response := httptest.NewRecorder()
	h.ServeHTTP(response, request)
	if response.Code != 409 || response.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("recent duplicate status=%d, cache=%q", response.Code, response.Header().Get("Cache-Control"))
	}
	if f.rotateCalls != 1 || strings.Contains(response.Body.String(), token) {
		t.Fatal("duplicate response leaked a credential or skipped owner")
	}
}

func TestPersistentLifetimeRoleBoundary(t *testing.T) {
	for _, tc := range []struct {
		role           string
		idle, absolute int
	}{
		{"customer", 30 * 24 * 60, 90 * 24 * 60},
		{"merchant", 30 * 24 * 60, 90 * 24 * 60},
		{"captain", 30 * 24 * 60, 90 * 24 * 60},
		{"operator", 8 * 60, 12 * 60},
	} {
		idle, absolute := persistentLifetime(tc.role)
		if idle != tc.idle || absolute != tc.absolute {
			t.Fatal("incorrect bounded lifetime", tc.role)
		}
	}
	if !errors.Is(ErrPersistenceExists, ErrPersistenceExists) {
		t.Fatal("unexpected sentinel")
	}
}
