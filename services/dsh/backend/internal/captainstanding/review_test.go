package captainstanding

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type reviewRepository struct {
	fakeStandingRepository
	items []Standing
	reads int
}

func (r *reviewRepository) List(_ context.Context, status Status, after string, limit int) ([]Standing, error) {
	r.reads++
	var result []Standing
	for _, item := range r.items {
		if item.Status == status && item.ActorID > after {
			result = append(result, item)
		}
	}
	if len(result) > limit {
		result = result[:limit]
	}
	return result, nil
}
func reviewRequest(handler http.Handler, path, token string) *httptest.ResponseRecorder {
	req := httptest.NewRequest("GET", path, nil)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	req.Header.Set("X-Actor-ID", "forged-operator")
	req.Header.Set("X-Role", "operator")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	return w
}
func TestOperatorCaptainReviewQueueAndCurrentDetail(t *testing.T) {
	repo := &reviewRepository{items: []Standing{{ActorID: "applicant-a", Status: Pending, Version: 1}, {ActorID: "applicant-b", Status: Pending, Version: 1}}}
	repo.standing = repo.items[0]
	id := &fakeIdentity{actor: Actor{ID: "reviewer", Role: "operator"}, allow: true}
	h := NewHTTPHandler(NewService(id, repo))
	first := reviewRequest(h, "/v1/operators/captains?limit=1", "current-operator")
	if first.Code != 200 {
		t.Fatalf("queue unavailable: %d %s", first.Code, first.Body.String())
	}
	var page struct {
		Items []Standing `json:"items"`
		Next  string     `json:"nextCursor"`
	}
	if json.Unmarshal(first.Body.Bytes(), &page) != nil || len(page.Items) != 1 || page.Items[0].ActorID != "applicant-a" || page.Next == "" {
		t.Fatalf("invalid queue page: %s", first.Body.String())
	}
	if first.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("private queue cached")
	}
	next := reviewRequest(h, "/v1/operators/captains?limit=1&cursor="+page.Next, "current-operator")
	if next.Code != 200 || !strings.Contains(next.Body.String(), "applicant-b") || strings.Contains(next.Body.String(), "nextCursor") {
		t.Fatalf("keyset page: %d %s", next.Code, next.Body.String())
	}
	detail := reviewRequest(h, "/v1/operators/captains/applicant-a/standing", "current-operator")
	var got map[string]any
	if detail.Code != 200 || json.Unmarshal(detail.Body.Bytes(), &got) != nil || len(got) != 3 || got["status"] != "PENDING" {
		t.Fatalf("private detail shape: %d %s", detail.Code, detail.Body.String())
	}
	if id.permissions != 3 || repo.changes != 0 {
		t.Fatalf("reviews bypassed authorization or wrote data: permissions=%d changes=%d", id.permissions, repo.changes)
	}
}
func TestOperatorCaptainReviewRejectsUntrustedQueries(t *testing.T) {
	repo := &reviewRepository{}
	h := NewHTTPHandler(NewService(&fakeIdentity{actor: Actor{ID: "reviewer", Role: "operator"}, allow: true}, repo))
	crossStatus := base64.RawURLEncoding.EncodeToString([]byte("APPROVED\napplicant-a"))
	for _, query := range []string{"status=PENDING&status=APPROVED", "status=unknown", "limit=0", "limit=51", "limit=01", "limit=1.0", "limit=%FF", "limit=1&limit=2", "actorId=forged", "cursor=", "cursor=not-base64!", "cursor=" + crossStatus, "status=%FF", "status=%D8%A3%D9%87%D9%84%D8%A7", "cursor=" + strings.Repeat("a", 513)} {
		w := reviewRequest(h, "/v1/operators/captains?"+query, "operator")
		if w.Code != 400 {
			t.Errorf("unsafe query %q: status=%d body=%s", query, w.Code, w.Body.String())
		}
	}
	if repo.reads != 0 || repo.changes != 0 {
		t.Fatal("invalid query reached data owner")
	}
}
func TestOperatorCaptainReviewRequiresCurrentOperationsPermission(t *testing.T) {
	for _, role := range []string{"customer", "merchant", "captain", "operator"} {
		id := &fakeIdentity{actor: Actor{ID: "actor", Role: role}}
		repo := &reviewRepository{}
		h := NewHTTPHandler(NewService(id, repo))
		for _, path := range []string{"/v1/operators/captains", "/v1/operators/captains/applicant/standing"} {
			if w := reviewRequest(h, path, "token"); w.Code != 403 {
				t.Errorf("role=%s status=%d", role, w.Code)
			}
			if w := reviewRequest(h, path, ""); w.Code != 401 {
				t.Errorf("noauth status=%d", w.Code)
			}
		}
		if repo.reads != 0 {
			t.Fatal("unauthorized review reached repository")
		}
	}
	id := &fakeIdentity{actor: Actor{ID: "reviewer", Role: "operator"}, allow: true, err: ErrUnauthorized}
	h := NewHTTPHandler(NewService(id, &reviewRepository{}))
	if w := reviewRequest(h, "/v1/operators/captains", "revoked"); w.Code != 401 {
		t.Fatalf("revoked session: %d", w.Code)
	}
}

func TestOperatorCaptainReviewUnicodeDetailAndInactiveStates(t *testing.T) {
	repo := &reviewRepository{}
	id := &fakeIdentity{actor: Actor{ID: "reviewer", Role: "operator"}, allow: true}
	h := NewHTTPHandler(NewService(id, repo))
	for _, status := range []Status{Pending, Approved, Suspended, Revoked} {
		repo.standing = Standing{ActorID: "كابتن-اختبار", Status: status, Version: 3}
		w := reviewRequest(h, "/v1/operators/captains/كابتن-اختبار/standing", "operator")
		if w.Code != 200 || !strings.Contains(w.Body.String(), string(status)) {
			t.Fatalf("Unicode detail/status lost: %d %s", w.Code, w.Body.String())
		}
	}
	repo.err = ErrNotEligible
	if w := reviewRequest(h, "/v1/operators/captains/missing/standing", "operator"); w.Code != 404 {
		t.Fatalf("missing detail status=%d", w.Code)
	}
	for _, actor := range []string{"%FF", "%00", "%5C", ".", ".."} {
		if w := reviewRequest(h, "/v1/operators/captains/"+actor+"/standing", "operator"); w.Code != 404 {
			t.Fatalf("malformed actor %s accepted status=%d", actor, w.Code)
		}
	}
}
