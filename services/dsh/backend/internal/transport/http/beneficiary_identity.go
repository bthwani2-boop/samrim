package transporthttp

import (
	"net/http"
	"strconv"
	"strings"

	identityclient "github.com/bthwani2-boop/samrim/services/identity/clients/go"
)

func (s *BeneficiaryFinanceServer) readOperatorPendingActorLegalName(w http.ResponseWriter, r *http.Request) {
	if !s.authorizeAndRequireOperations(w, r) {
		return
	}
	item, err := s.identity.ReadPendingActorLegalName(r.Context(), strings.TrimSpace(r.PathValue("actorId")), strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID")))
	if err != nil {
		writeIdentityError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{"legalName": item})
}

func (s *BeneficiaryFinanceServer) submitOperatorActorLegalName(w http.ResponseWriter, r *http.Request) {
	acting, correlation, idempotency, ok := requiredMutationHeaders(w, r)
	if !ok || !s.authorizeAndRequireOperations(w, r) {
		return
	}
	actorID := strings.TrimSpace(r.PathValue("actorId"))
	var input identityclient.SubmitActorLegalNameRequest
	if actorID == "" || !decodeJSON(w, r, &input) {
		return
	}
	item, err := s.identity.SubmitActorLegalName(r.Context(), actorID, input, correlation, idempotency, acting)
	if err != nil {
		writeIdentityError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusCreated, map[string]any{"legalName": item})
}

func (s *BeneficiaryFinanceServer) verifyOperatorActorLegalName(w http.ResponseWriter, r *http.Request) {
	acting, correlation, idempotency, ok := requiredMutationHeaders(w, r)
	if !ok || !s.authorizeAndRequireOperations(w, r) {
		return
	}
	actorID := strings.TrimSpace(r.PathValue("actorId"))
	version, err := strconv.Atoi(strings.TrimSpace(r.PathValue("version")))
	if actorID == "" || err != nil || version < 1 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "actor and legal-name version are required")
		return
	}
	var input identityclient.VerifyActorLegalNameRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	item, err := s.identity.VerifyActorLegalName(r.Context(), actorID, version, input, correlation, idempotency, acting)
	if err != nil {
		writeIdentityError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{"legalName": item})
}

func (s *BeneficiaryFinanceServer) authorizeAndRequireOperations(w http.ResponseWriter, r *http.Request) bool {
	if !s.authorize(w, r) {
		return false
	}
	actorID := strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID"))
	return s.requireOperator(w, r.Context(), actorID) && s.requirePermission(w, r.Context(), actorID, "operations")
}
