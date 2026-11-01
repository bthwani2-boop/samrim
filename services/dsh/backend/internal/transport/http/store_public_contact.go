package transporthttp

import (
	"errors"
	"net/http"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storeaccess"
)

func (s *StoreAccessServer) readStorePublicContactForPartner(w http.ResponseWriter, r *http.Request) {
	record, err := s.service.ReadPublicContactForOwner(r.Context(), bearerToken(r), r.PathValue("storeId"))
	if err != nil { writeStorePublicContactError(w, err); return }
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{"contact": record})
}

func (s *StoreAccessServer) updateStorePublicContactForPartner(w http.ResponseWriter, r *http.Request) {
	correlationID, key, ok := storeAccessMutationHeaders(w, r)
	if !ok { return }
	var input postgres.StorePublicContactInput
	if !decodeJSON(w, r, &input) { return }
	record, replay, err := s.service.UpdatePublicContactForOwner(r.Context(), bearerToken(r), r.PathValue("storeId"), input, key, correlationID)
	if err != nil { writeStorePublicContactError(w, err); return }
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{"contact": record, "idempotentReplay": replay})
}

func (s *StoreAccessServer) readStorePublicContactForOperator(w http.ResponseWriter, r *http.Request) {
	operatorID, ok := storeAccessOperatorActor(w, r, s.operatorAuth)
	if !ok { return }
	record, err := s.service.ReadPublicContactForOperator(r.Context(), operatorID, r.PathValue("storeId"))
	if err != nil { writeStorePublicContactError(w, err); return }
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{"contact": record})
}

func (s *StoreAccessServer) readPublishedStorePublicContact(w http.ResponseWriter, r *http.Request) {
	record, err := s.service.ReadPublishedPublicContact(r.Context(), r.PathValue("storeId"))
	if err != nil { writeStorePublicContactError(w, err); return }
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{"contact": record})
}

func writeStorePublicContactError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, storeaccess.ErrPartnerSession), errors.Is(err, storeaccess.ErrOperatorPermission),
		errors.Is(err, postgres.ErrStorePublicContactForbidden):
		writeError(w, http.StatusForbidden, "FORBIDDEN", "Store contact settings are not available to this actor")
	case errors.Is(err, postgres.ErrStorePublicContactNotFound):
		writeError(w, http.StatusNotFound, "NOT_FOUND", "published Store contact not found")
	case errors.Is(err, postgres.ErrStorePublicContactInput):
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "Store contact values are invalid")
	case errors.Is(err, postgres.ErrStorePublicContactVersion):
		writeError(w, http.StatusConflict, "VERSION_CONFLICT", "Store contact settings changed; reload before retry")
	case errors.Is(err, postgres.ErrStorePublicContactIdempotency):
		writeError(w, http.StatusConflict, "IDEMPOTENCY_CONFLICT", "mutation key has already been used for different Store contact facts")
	default:
		writeStoreAccessError(w, err)
	}
}
