package http

import (
	"net/http"
	"strings"

	"github.com/bthwani2-boop/samrim/services/wlt/backend/internal/storage/postgres"
)

func (s *Server) createOfficialWalletDestination(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	correlation, idempotency, ok := mutationHeaders(w, r)
	if !ok {
		return
	}
	var input createOfficialWalletDestinationRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	actor := strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID"))
	if actor == "" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "X-Acting-Actor-ID is required")
		return
	}
	result, replayed, err := postgres.CreateOfficialWalletDestination(r.Context(), s.db, s.destinationEncryptionKey, postgres.CreateOfficialWalletDestinationInput{ActorType: input.ActorType, ActorID: input.ActorID, ProviderKey: input.ProviderKey, IdentityFacts: input.IdentityFacts, ChangeReason: input.ChangeReason, VerificationEvidenceReference: input.VerificationEvidenceReference, ChangeEvidenceReference: input.ChangeEvidenceReference, SubmittedBy: actor, IdempotencyKey: idempotency, CorrelationID: correlation})
	if err != nil {
		writeDestinationError(w, err)
		return
	}
	status := http.StatusCreated
	if replayed {
		status = http.StatusOK
	}
	writeJSON(w, status, officialWalletDestinationResponse{Destination: toOfficialWalletDestination(result), IdempotentReplay: replayed})
}

func (s *Server) verifyOfficialWalletDestination(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	correlation, idempotency, ok := mutationHeaders(w, r)
	if !ok {
		return
	}
	actor := strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID"))
	if actor == "" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "X-Acting-Actor-ID is required")
		return
	}
	var input transitionOfficialWalletDestinationRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	result, err := postgres.VerifyOfficialWalletDestination(r.Context(), s.db, s.destinationEncryptionKey, r.PathValue("destinationId"), actor, input.EvidenceReference, input.IdentityFacts, idempotency, correlation)
	if err != nil {
		writeDestinationError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, officialWalletDestinationResponse{Destination: toOfficialWalletDestination(result)})
}

func (s *Server) activateOfficialWalletDestination(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	correlation, idempotency, ok := mutationHeaders(w, r)
	if !ok {
		return
	}
	actor := strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID"))
	if actor == "" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "X-Acting-Actor-ID is required")
		return
	}
	var input transitionOfficialWalletDestinationRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	result, err := postgres.ActivateOfficialWalletDestination(r.Context(), s.db, s.destinationEncryptionKey, r.PathValue("destinationId"), actor, input.IdentityFacts, idempotency, correlation)
	if err != nil {
		writeDestinationError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, officialWalletDestinationResponse{Destination: toOfficialWalletDestination(result)})
}

func (s *Server) readOfficialWalletDestination(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	result, err := postgres.ReadOfficialWalletDestination(r.Context(), s.db, r.PathValue("actorType"), r.PathValue("actorId"))
	if err != nil {
		writeDestinationError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, officialWalletDestinationResponse{Destination: toOfficialWalletDestination(result)})
}

func (s *Server) readOfficialWalletDestinationByID(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	result, err := postgres.ReadOfficialWalletDestinationByID(r.Context(), s.db, r.PathValue("destinationId"))
	if err != nil {
		writeDestinationError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, officialWalletDestinationResponse{Destination: toOfficialWalletDestination(result)})
}
