package captainstanding

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// A successful application readback must be a current DSH fact for the
// authenticated Customer, not a replay of a client-supplied actor ID.
func TestCustomerCaptainApplicationOwnerReadbackAfterPOST(t *testing.T) {
	repo := &fakeStandingRepository{}
	identity := &fakeIdentity{actor: Actor{ID: "actor-17", Role: "customer"}}
	handler := NewHTTPHandler(NewService(identity, repo))
	call := func(method, path string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, path, nil)
		req.Header.Set("Authorization", "Bearer verified-customer")
		req.Header.Set("X-Actor-ID", "forged-other-actor")
		req.Header.Set("X-Role", "operator")
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, req)
		return w
	}
	post := call(http.MethodPost, CaptainApplicationPath)
	if post.Code != http.StatusOK || !strings.Contains(post.Body.String(), `"status":"PENDING"`) {
		t.Fatalf("initial pending application rejected: %d %s", post.Code, post.Body.String())
	}
	read := call(http.MethodGet, CaptainApplicationPath)
	if read.Code != http.StatusOK || !strings.Contains(read.Body.String(), `"actorId":"actor-17"`) ||
		!strings.Contains(read.Body.String(), `"status":"PENDING"`) ||
		read.Header().Get("Cache-Control") != "no-store" || read.Header().Get("Allow") != "GET, POST" {
		t.Fatalf("readback did not show owner pending fact: %d %s", read.Code, read.Body.String())
	}
	if repo.standing.ActorID != "actor-17" || repo.standing.Version != 1 {
		t.Fatal("readback silently wrote or changed an application")
	}
	read = call(http.MethodGet, CaptainApplicationPath+"?actorId=someone-else")
	if read.Code != http.StatusBadRequest {
		t.Fatalf("query actor override admitted: %d", read.Code)
	}
	identity.actor.Role = "captain"
	read = call(http.MethodGet, CaptainApplicationPath)
	if read.Code != http.StatusForbidden {
		t.Fatalf("Captain role bypassed Customer own readback: %d", read.Code)
	}
}

func TestCustomerApplicationReadbackRejectsInactiveMissingCrossActorAndOwnerOutage(t *testing.T) {
	for _, tc := range []struct {
		name     string
		standing Standing
		err      error
		want     int
	}{
		{"pending", Standing{ActorID: "actor-17", Status: Pending, Version: 1}, nil, http.StatusOK},
		{"approved", Standing{ActorID: "actor-17", Status: Approved, Version: 2}, nil, http.StatusOK},
		{"suspended", Standing{ActorID: "actor-17", Status: Suspended, Version: 3}, nil, http.StatusForbidden},
		{"revoked", Standing{ActorID: "actor-17", Status: Revoked, Version: 4}, nil, http.StatusForbidden},
		{"not-found", Standing{}, ErrNotEligible, http.StatusNotFound},
		{"not-found-empty", Standing{}, nil, http.StatusNotFound},
		{"foreign-record", Standing{ActorID: "actor-18", Status: Pending, Version: 1}, nil, http.StatusServiceUnavailable},
		{"owner-error", Standing{}, ErrOwnerUnavailable, http.StatusServiceUnavailable},
		{"owner-error-generic", Standing{}, errors.New("db down"), http.StatusServiceUnavailable},
	} {
		t.Run(tc.name, func(t *testing.T) {
			repo := &fakeStandingRepository{standing: tc.standing, err: tc.err}
			handler := NewHTTPHandler(NewService(&fakeIdentity{
				actor: Actor{ID: "actor-17", Role: "customer"},
			}, repo))
			req := httptest.NewRequest(http.MethodGet, CaptainApplicationPath, nil)
			req.Header.Set("Authorization", "Bearer verified-customer")
			resp := httptest.NewRecorder()
			handler.ServeHTTP(resp, req)
			if resp.Code != tc.want {
				t.Fatalf("status=%d want=%d body=%s", resp.Code, tc.want, resp.Body.String())
			}
			if tc.want != http.StatusOK &&
				(strings.Contains(resp.Body.String(), "actor-17") || strings.Contains(resp.Body.String(), "actor-18")) {
				t.Fatal("private application identity leaked in denial")
			}
		})
	}
}

func TestReadCurrentCustomerApplicationCannotReadForeignActor(t *testing.T) {
	repo := &fakeStandingRepository{standing: Standing{ActorID: "other-actor", Status: Approved, Version: 5}}
	svc := NewService(&fakeIdentity{actor: Actor{ID: "verified-customer", Role: "customer"}}, repo)
	if _, err := svc.ReadSelfApplication(context.Background(), "real-bearer"); !errors.Is(err, ErrOwnerUnavailable) {
		t.Fatalf("cross-actor read incorrectly succeeded: %v", err)
	}
}
