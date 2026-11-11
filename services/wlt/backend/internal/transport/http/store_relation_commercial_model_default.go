package http

import (
	"errors"
	"log"
	"net/http"

	"github.com/bthwani2-boop/samrim/services/wlt/backend/internal/storage/postgres"
)

func (s *Server) readStoreRelationCommercialModelDefaults(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	defaults, err := postgres.ReadStoreRelationCommercialModelDefaults(r.Context(), s.db)
	if err != nil {
		log.Printf("WLT Store relation model defaults read failed: %T", err)
		writeError(w, http.StatusBadGateway, "WLT_STORAGE_UNAVAILABLE", "WLT commercial model defaults are unavailable")
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{"defaults": defaults})
}

func (s *Server) updateStoreRelationCommercialModelDefault(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	actorID, correlationID, idempotencyKey, ok := operatorMutationHeaders(w, r)
	if !ok || !s.requireOperatorID(w, actorID) {
		return
	}
	var input struct {
		RelationModel   string `json:"relationModel"`
		CommercialModel string `json:"commercialModel"`
		ExpectedVersion int    `json:"expectedVersion"`
		Reason          string `json:"reason"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	result, replayed, err := postgres.UpdateStoreRelationCommercialModelDefault(r.Context(), s.db, postgres.StoreRelationCommercialModelDefaultUpdate{
		RelationModel: input.RelationModel, CommercialModel: input.CommercialModel,
		ExpectedVersion: input.ExpectedVersion, ActingActorID: actorID,
		Reason: input.Reason, IdempotencyKey: idempotencyKey, CorrelationID: correlationID,
	})
	if err != nil {
		switch {
		case errors.Is(err, postgres.ErrStoreRelationCommercialDefaultInvalid):
			writeError(w, http.StatusBadRequest, "INVALID_INPUT", "Store relation commercial model default input is invalid")
		case errors.Is(err, postgres.ErrStoreRelationCommercialDefaultVersion), errors.Is(err, postgres.ErrStoreRelationCommercialDefaultUnchanged):
			writeError(w, http.StatusConflict, "VERSION_CONFLICT", "Store relation model selection changed; reload before saving")
		case errors.Is(err, postgres.ErrIdempotencyConflict):
			writeError(w, http.StatusConflict, "IDEMPOTENCY_CONFLICT", "Idempotency-Key belongs to a different model selection")
		default:
			log.Printf("WLT Store relation model default persistence failed: %T", err)
			writeError(w, http.StatusBadGateway, "WLT_STORAGE_UNAVAILABLE", "WLT commercial model default persistence unavailable")
		}
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{"default": result, "idempotentReplay": replayed})
}
