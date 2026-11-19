package captainstanding

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestCaptainHTTPNeverReturnsApprovedStandingWithoutCurrentRoleAndDSHRead(t *testing.T) {
	owner := &fakeStandingRepository{standing: Standing{ActorID: "captain-17", Status: Approved, Version: 3}}
	identity := &fakeIdentity{actor: Actor{ID: "captain-17", Role: "captain"}}
	handler := NewHTTPHandler(NewService(identity, owner))
	request := func(method, path, token string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, path, nil)
		if token != "" {
			r.Header.Set("Authorization", "Bearer "+token)
		}
		r.Header.Set("X-Actor-ID", "forged-operator")
		r.Header.Set("X-Role", "operator")
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		return w
	}
	ok := request(http.MethodGet, "/v1/captains/me/standing", "valid-session")
	if ok.Code != http.StatusOK || ok.Header().Get("Cache-Control") != "no-store" ||
		!strings.Contains(ok.Body.String(), `"status":"APPROVED"`) {
		t.Fatalf("authorized standing should be current DSH fact, got %d %s", ok.Code, ok.Body.String())
	}
	identity.actor.Role = "customer"
	denied := request(http.MethodGet, "/v1/captains/me/standing", "valid-customer")
	if denied.Code != http.StatusForbidden {
		t.Fatalf("wrong role read Captain standing: %d", denied.Code)
	}
	identity.actor.Role = "captain"
	owner.standing.Status = Suspended
	denied = request(http.MethodGet, "/v1/captains/me/standing", "valid-session")
	if denied.Code != http.StatusForbidden {
		t.Fatalf("suspended Captain read APPROVED standing: %d", denied.Code)
	}
	denied = request(http.MethodGet, "/v1/captains/me/standing", "")
	if denied.Code != http.StatusUnauthorized {
		t.Fatalf("missing bearer allowed: %d", denied.Code)
	}
	denied = request(http.MethodPost, "/v1/captains/me/standing", "valid-session")
	if denied.Code != http.StatusMethodNotAllowed {
		t.Fatalf("incorrect method allowed: %d", denied.Code)
	}
	denied = request(http.MethodGet, "/v1/captains/other/standing", "valid-session")
	if denied.Code != http.StatusNotFound {
		t.Fatalf("cross-captain path allowed: %d", denied.Code)
	}
}

func TestCustomerCaptainApplicationHTTPIsPendingAndNotSelfApproved(t *testing.T) {
	owner := &fakeStandingRepository{}
	identity := &fakeIdentity{actor: Actor{ID: "captain-17", Role: "customer"}}
	handler := NewHTTPHandler(NewService(identity, owner))
	post := httptest.NewRequest(http.MethodPost, "/v1/actors/me/captain-application", nil)
	post.Header.Set("Authorization", "Bearer verified-customer-session")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, post)
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), `"status":"PENDING"`) {
		t.Fatalf("applicant should remain pending: %d %s", w.Code, w.Body.String())
	}
	identity.actor.Role = "captain"
	w = httptest.NewRecorder()
	post = httptest.NewRequest(http.MethodPost, "/v1/actors/me/captain-application", nil)
	post.Header.Set("Authorization", "Bearer captain-session")
	handler.ServeHTTP(w, post)
	if w.Code != http.StatusForbidden {
		t.Fatalf("Captain session re-applied to self: %d", w.Code)
	}
}

func TestCaptainOperatorStandingPatchRejectsAmbiguousAndForgedInput(t *testing.T) {
	owner := &fakeStandingRepository{standing: Standing{ActorID: "captain-17", Status: Pending, Version: 1}}
	identity := &fakeIdentity{actor: Actor{ID: "operator-1", Role: "operator"}, allow: true}
	handler := NewHTTPHandler(NewService(identity, owner))
	patch := func(body string) int {
		r := httptest.NewRequest(http.MethodPatch, "/v1/operators/captains/captain-17/standing", strings.NewReader(body))
		r.Header.Set("Authorization", "Bearer operator-credential")
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("X-Actor-ID", "captain-18")
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		return w.Code
	}
	bad := []string{
		`{"status":"APPROVED","status":"SUSPENDED","expectedVersion":1,"operationId":"approval-001","reason":"verified"}`,
		`{"status":"APPROVED","expectedVersion":1,"operationId":"approval-001","reason":"verified","actingActorId":"forged"}`,
		`{"status":"APPROVED","expectedVersion":0,"operationId":"approval-001","reason":"verified"}`,
		`{"status":"APPROVED","Status":"REVOKED","expectedVersion":1,"operationId":"approval-001","reason":"verified"}`,
		`{"Status":"APPROVED","expectedVersion":1,"operationId":"approval-001","reason":"verified"}`,
		`{"status":"APPROVED","EXPECTEDVERSION":1,"operationId":"approval-001","reason":"verified"}`,
		`{"status":"APPROVED","expectedVersion":1,"operationID":"approval-001","reason":"verified"}`,
		`{"status":"APPROVED","expectedVersion":1,"operationId":"approval-001","Reason":"verified"}`,
	}
	for _, body := range bad {
		if status := patch(body); status != http.StatusBadRequest || owner.changes != 0 {
			t.Fatalf("unsafe patch accepted: status=%d changes=%d", status, owner.changes)
		}
	}
	good := `{"status":"APPROVED","expectedVersion":1,"operationId":"approval-001","reason":"verified"}`
	if status := patch(good); status != http.StatusOK || owner.changes != 1 {
		t.Fatalf("authorized patch failed status=%d changes=%d", status, owner.changes)
	}
	if owner.lastChange.ActorID != "captain-17" || owner.lastChange.ActingActorID != "operator-1" {
		t.Fatalf("forged actor header influenced command owner binding: %+v", owner.lastChange)
	}
}

func TestInactiveCaptainApplicationHTTPReturnsForbiddenInsteadOfInactiveStanding(t *testing.T) {
	for _, status := range []Status{Suspended, Revoked} {
		t.Run(string(status), func(t *testing.T) {
			owner := &fakeStandingRepository{standing: Standing{ActorID: "captain-17", Status: status, Version: 3}}
			identity := &fakeIdentity{actor: Actor{ID: "captain-17", Role: "customer"}}
			handler := NewHTTPHandler(NewService(identity, owner))
			request := httptest.NewRequest(http.MethodPost, "/v1/actors/me/captain-application", nil)
			request.Header.Set("Authorization", "Bearer verified-customer")
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, request)
			if response.Code != http.StatusForbidden ||
				!strings.Contains(response.Body.String(), "CAPTAIN_NOT_ELIGIBLE") ||
				strings.Contains(response.Body.String(), string(status)) {
				t.Fatalf("inactive applicant leaked status as success: code=%d body=%s", response.Code, response.Body.String())
			}
			if owner.standing.Status != status || owner.standing.Version != 3 {
				t.Fatalf("inactive standing changed during denied application: %+v", owner.standing)
			}
		})
	}
}
