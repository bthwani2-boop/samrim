package transporthttp

import (
	"net/http"
	"strings"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/joiningcase"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

func (s *JoiningCaseServer) attributeFieldAcquisition(w http.ResponseWriter, r *http.Request) {
	if !s.auth.Authorized(r) {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "service authentication is required")
		return
	}
	acting, correlation, idempotency, expectedVersion, ok := requiredVersionedCaseHeaders(w, r)
	if !ok {
		return
	}
	if r.Header.Get("X-Actor-ID") != "" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "X-Actor-ID is forbidden")
		return
	}
	var input struct {
		FieldActorID string `json:"fieldActorId"`
		Reason       string `json:"reason"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	result, err := s.service.AttributeFieldAcquisitionForOperator(r.Context(), r.PathValue("caseId"), input.FieldActorID, input.Reason, expectedVersion, idempotency, correlation, acting)
	if err != nil {
		switch {
		case err == postgres.ErrFieldAdmissionNotEligible || err == postgres.ErrFieldAdmissionNotFound:
			writeError(w, http.StatusForbidden, "FIELD_NOT_ELIGIBLE", "the Field representative is not eligible in this Service City")
		case err == joiningcase.ErrInvalidInput || strings.TrimSpace(input.FieldActorID) == "":
			writeError(w, http.StatusBadRequest, "INVALID_INPUT", "acquisition attribution is invalid")
		default:
			writeJoiningCaseError(w, err)
		}
		return
	}
	s.writeResult(w, r, responseStatus(result.Replayed), result)
}
