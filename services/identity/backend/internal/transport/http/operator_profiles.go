package identityhttp

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/bthwani2-boop/samrim/services/identity/backend/internal/domain"
)

func (s *Server) listOperatorProfiles(w http.ResponseWriter, r *http.Request, caller string) {
	limit := 25
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil {
			writeDomainError(w, domain.ErrInvalidInput)
			return
		}
		limit = parsed
	}
	page, err := s.actors.ListOperatorProfiles(r.Context(), caller, strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID")), r.URL.Query().Get("q"), r.URL.Query().Get("state"), r.URL.Query().Get("sort"), limit, r.URL.Query().Get("cursor"))
	if err != nil {
		writeDomainError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, page)
}

func (s *Server) createOperatorProfile(w http.ResponseWriter, r *http.Request, caller string) {
	var input domain.OperatorProfileCreateRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	result, err := s.actors.CreateOperatorProfile(r.Context(), caller, strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID")), strings.TrimSpace(r.Header.Get("X-Correlation-ID")), strings.TrimSpace(r.Header.Get("Idempotency-Key")), input)
	if err != nil {
		writeDomainError(w, err)
		return
	}
	status := http.StatusCreated
	if result.IdempotentReplay {
		status = http.StatusOK
	}
	writeJSON(w, status, result)
}

func (s *Server) updateOperatorProfile(w http.ResponseWriter, r *http.Request, caller string) {
	var input domain.OperatorProfileUpdateRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	result, err := s.actors.UpdateOperatorProfile(r.Context(), caller, strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID")), strings.TrimSpace(r.Header.Get("X-Correlation-ID")), strings.TrimSpace(r.Header.Get("Idempotency-Key")), r.PathValue("profileId"), input)
	if err != nil {
		writeDomainError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) approveOperatorProfile(w http.ResponseWriter, r *http.Request, caller string) {
	var input domain.OperatorProfileMutationRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	result, err := s.actors.ApproveOperatorProfile(r.Context(), caller, strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID")), strings.TrimSpace(r.Header.Get("X-Correlation-ID")), strings.TrimSpace(r.Header.Get("Idempotency-Key")), r.PathValue("profileId"), input.ExpectedVersion)
	if err != nil {
		writeDomainError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) grantOperatorProfile(w http.ResponseWriter, r *http.Request, caller string) {
	var input domain.OperatorProfileMutationRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	result, err := s.actors.GrantOperatorProfile(r.Context(), caller, strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID")), strings.TrimSpace(r.Header.Get("X-Correlation-ID")), strings.TrimSpace(r.Header.Get("Idempotency-Key")), r.PathValue("profileId"), input.ExpectedVersion)
	if err != nil {
		writeDomainError(w, err)
		return
	}
	status := http.StatusOK
	if result.Role.RoleCreated || result.Role.ActorCreated {
		status = http.StatusCreated
	}
	writeJSON(w, status, result)
}

func (s *Server) issueOperatorProfileInvitation(w http.ResponseWriter, r *http.Request, caller string) {
	actingActorID := strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID"))
	profile, err := s.actors.ReadOperatorProfile(r.Context(), caller, actingActorID, r.PathValue("profileId"))
	if err != nil {
		writeDomainError(w, err)
		return
	}
	if profile.State != "admitted" || profile.ActorID == "" || profile.PhoneE164 == "" {
		writeDomainError(w, domain.ErrConflict)
		return
	}
	role, err := s.actors.ReadOperatorProfileRole(r.Context(), caller, actingActorID, profile.ActorID)
	if err != nil {
		writeDomainError(w, err)
		return
	}
	if role.Role != "operator" || !role.Enabled || !role.SecurityEnabled || role.ActivatedAt != nil {
		writeDomainError(w, domain.ErrConflict)
		return
	}
	token, err := s.challenges.IssueOperatorEnrollmentToken(r.Context(), domain.OperatorEnrollmentTokenIssueRequest{PhoneE164: role.PhoneE164, Role: "operator"}, caller, actingActorID, strings.TrimSpace(r.Header.Get("X-Correlation-ID")))
	if err != nil {
		writeDomainError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"profile": profile, "enrollmentToken": token})
}
