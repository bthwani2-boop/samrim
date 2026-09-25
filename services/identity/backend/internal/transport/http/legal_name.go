package identityhttp

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/bthwani2-boop/samrim/services/identity/backend/internal/actor"
	"github.com/bthwani2-boop/samrim/services/identity/backend/internal/domain"
)

func (s *Server) submitActorLegalName(w http.ResponseWriter, r *http.Request, caller string) {
	if !legalNameCallerAllowed(caller) || r.Header.Get("X-Actor-ID") != "" {
		writeJSON(w, http.StatusForbidden, errorBody("FORBIDDEN", "Identity legal-name submission is restricted to authorized services and Operators"))
		return
	}
	actingActorID := strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID"))
	correlationID, idempotencyKey := strings.TrimSpace(r.Header.Get("X-Correlation-ID")), strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	if actingActorID == "" || len(correlationID) < 8 || len(idempotencyKey) < 8 {
		writeDomainError(w, domain.ErrInvalidInput)
		return
	}
	var input struct {
		GivenName         string `json:"givenName"`
		SecondName        string `json:"secondName"`
		ThirdName         string `json:"thirdName"`
		FamilyName        string `json:"familyName"`
		EvidenceReference string `json:"evidenceReference"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	item, replayed, err := s.actors.SubmitLegalName(r.Context(), actor.SubmitLegalNameInput{
		ActorID: r.PathValue("actorId"), GivenName: input.GivenName, SecondName: input.SecondName, ThirdName: input.ThirdName, FamilyName: input.FamilyName,
		EvidenceReference: input.EvidenceReference, ActingActorID: actingActorID, IdempotencyKey: idempotencyKey, CorrelationID: correlationID,
	})
	if err != nil {
		writeDomainError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	status := http.StatusCreated
	if replayed {
		status = http.StatusOK
	}
	writeJSON(w, status, item)
}

func (s *Server) verifyActorLegalName(w http.ResponseWriter, r *http.Request, caller string) {
	if !legalNameCallerAllowed(caller) || r.Header.Get("X-Actor-ID") != "" {
		writeJSON(w, http.StatusForbidden, errorBody("FORBIDDEN", "Identity legal-name verification is restricted to authorized services and Operators"))
		return
	}
	version, err := strconv.Atoi(strings.TrimSpace(r.PathValue("version")))
	if err != nil || version < 1 {
		writeDomainError(w, domain.ErrInvalidInput)
		return
	}
	actingActorID := strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID"))
	correlationID, idempotencyKey := strings.TrimSpace(r.Header.Get("X-Correlation-ID")), strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	if actingActorID == "" || len(correlationID) < 8 || len(idempotencyKey) < 8 {
		writeDomainError(w, domain.ErrInvalidInput)
		return
	}
	var input struct {
		EvidenceReference string `json:"evidenceReference"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	item, _, err := s.actors.VerifyLegalName(r.Context(), actor.VerifyLegalNameInput{
		ActorID: r.PathValue("actorId"), Version: version, VerificationEvidenceReference: input.EvidenceReference,
		ActingActorID: actingActorID, IdempotencyKey: idempotencyKey, CorrelationID: correlationID,
	})
	if err != nil {
		writeDomainError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) readVerifiedActorLegalName(w http.ResponseWriter, r *http.Request, caller string) {
	if !legalNameCallerAllowed(caller) || r.Header.Get("X-Actor-ID") != "" {
		writeJSON(w, http.StatusForbidden, errorBody("FORBIDDEN", "Identity legal-name read is restricted to authorized services"))
		return
	}
	actingActorID := strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID"))
	if caller == "control-panel" {
		if actingActorID == "" || s.actors.RequireOperatorOperations(r.Context(), actingActorID) != nil {
			writeJSON(w, http.StatusForbidden, errorBody("FORBIDDEN", "Operations permission is required"))
			return
		}
	}
	item, err := s.actors.ReadVerifiedLegalName(r.Context(), r.PathValue("actorId"))
	if errors.Is(err, actor.ErrLegalNameNotFound) {
		writeJSON(w, http.StatusNotFound, errorBody("NOT_FOUND", "verified actor legal name was not found"))
		return
	}
	if err != nil {
		writeDomainError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) readPendingActorLegalName(w http.ResponseWriter, r *http.Request, caller string) {
	if !legalNameCallerAllowed(caller) || r.Header.Get("X-Actor-ID") != "" {
		writeJSON(w, http.StatusForbidden, errorBody("FORBIDDEN", "pending legal-name review is restricted to authorized Operations staff"))
		return
	}
	actingActorID := strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID"))
	if caller == "control-panel" && (actingActorID == "" || s.actors.RequireOperatorOperations(r.Context(), actingActorID) != nil) {
		writeJSON(w, http.StatusForbidden, errorBody("FORBIDDEN", "Operations permission is required"))
		return
	}
	item, err := s.actors.ReadPendingLegalName(r.Context(), r.PathValue("actorId"))
	if errors.Is(err, actor.ErrLegalNameNotFound) {
		writeJSON(w, http.StatusNotFound, errorBody("NOT_FOUND", "pending actor legal name was not found"))
		return
	}
	if err != nil {
		writeDomainError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, item)
}

func legalNameCallerAllowed(caller string) bool {
	return caller == "control-panel" || caller == "dsh"
}
