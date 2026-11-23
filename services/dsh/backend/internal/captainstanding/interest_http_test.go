package captainstanding

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type memoryInterestRepo struct {
	inserts []InterestSubmission
	entries []Interest
}

func (r *memoryInterestRepo) Insert(_ context.Context, submission InterestSubmission) error {
	r.inserts = append(r.inserts, submission)
	return nil
}
func (r *memoryInterestRepo) List(_ context.Context, filter InterestFilter) (InterestPage, error) {
	return InterestPage{Items: r.entries}, nil
}
func (r *memoryInterestRepo) MarkContacted(_ context.Context, id int64, actorID string) (Interest, error) {
	for i := range r.entries {
		if r.entries[i].ID == id {
			r.entries[i].Contacted = true
			return r.entries[i], nil
		}
	}
	return Interest{}, ErrNotFound
}

type interestIdentity struct{ allow bool }

func (i interestIdentity) Resolve(_ context.Context, bearer string) (Actor, error) {
	if bearer != "operator-test-token" {
		return Actor{}, ErrUnauthorized
	}
	return Actor{ID: "operator-1", Role: "operator"}, nil
}
func (i interestIdentity) RequireOperations(_ context.Context, _ string, _ string) error {
	if !i.allow {
		return ErrForbidden
	}
	return nil
}

const validInterestJSON = `{"name":"محمد أحمد","phone":"771234567","city":"صنعاء","district":"التحرير","vehicleType":"MOTORCYCLE","plateRegistered":true,"phoneType":"SMART","experienced":false}`

func interestCall(h http.Handler, method, path, body, bearer string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	if bearer != "" {
		req.Header.Set("Authorization", "Bearer "+bearer)
	}
	result := httptest.NewRecorder()
	h.ServeHTTP(result, req)
	return result
}

func TestPublicCaptainInterestIsAnonymousOneWayIntake(t *testing.T) {
	repo := &memoryInterestRepo{}
	h := NewInterestHTTPHandler(NewInterestService(nil, repo))
	result := interestCall(h, http.MethodPost, CaptainInterestPath, validInterestJSON, "")
	if result.Code != http.StatusAccepted {
		t.Fatalf("expected 202, got %d: %s", result.Code, result.Body)
	}
	if len(repo.inserts) != 1 || repo.inserts[0].Phone != "771234567" {
		t.Fatalf("submission was not forwarded to DSH owner: %#v", repo.inserts)
	}
	var response map[string]any
	if err := json.Unmarshal(result.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if response["received"] != true || len(response) != 1 {
		t.Fatalf("one way response leaked status or role: %#v", response)
	}
	if result.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("privacy headers missing")
	}
}

func TestPublicCaptainInterestRejectsInvalidOrExcessiveSubmissions(t *testing.T) {
	repo := &memoryInterestRepo{}
	h := NewInterestHTTPHandler(NewInterestService(nil, repo))
	cases := []string{
		`{"name":"م","phone":"771234567","city":"صنعاء","district":"التحرير","vehicleType":"MOTORCYCLE","plateRegistered":true,"phoneType":"SMART","experienced":false}`,
		strings.Replace(validInterestJSON, `"phone":"771234567"`, `"phone":"111111111"`, 1),
		strings.Replace(validInterestJSON, `"phoneType":"SMART"`, `"phoneType":"SMART","status":"APPROVED"`, 1),
		strings.Replace(validInterestJSON, `"phone":"771234567"`, `"phone":"771234567","phone":"778888888"`, 1),
		strings.Repeat("x", 4096),
	}
	for _, body := range cases {
		result := interestCall(h, http.MethodPost, CaptainInterestPath, body, "")
		if result.Code != http.StatusBadRequest {
			t.Fatalf("expected invalid request 400 for %q, got %d", body[:min(len(body), 60)], result.Code)
		}
	}
	if len(repo.inserts) != 0 {
		t.Fatal("invalid submissions persisted")
	}
}

func TestCaptainInterestReviewRequiresCurrentOperationsPermission(t *testing.T) {
	repo := &memoryInterestRepo{entries: []Interest{{ID: 42, Name: "محمد أحمد", Phone: "771234567"}}}
	h := NewInterestHTTPHandler(NewInterestService(interestIdentity{allow: false}, repo))
	for _, bearer := range []string{"", "operator-test-token"} {
		got := interestCall(h, http.MethodGet, OperatorCaptainInterestPath, "", bearer)
		expected := http.StatusUnauthorized
		if bearer != "" {
			expected = http.StatusForbidden
		}
		if got.Code != expected {
			t.Fatalf("got %d expected %d for %q", got.Code, expected, bearer)
		}
	}
	allowed := NewInterestHTTPHandler(NewInterestService(interestIdentity{allow: true}, repo))
	got := interestCall(allowed, http.MethodGet, OperatorCaptainInterestPath, "", "operator-test-token")
	if got.Code != http.StatusOK {
		t.Fatalf("authorized operator review failed: %d %s", got.Code, got.Body)
	}
	changed := interestCall(allowed, http.MethodPatch, OperatorCaptainInterestPath+"/42/contact", `{"contacted":true}`, "operator-test-token")
	if changed.Code != http.StatusOK || !repo.entries[0].Contacted {
		t.Fatalf("contact flag not persisted: %d", changed.Code)
	}
}
