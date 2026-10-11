package transporthttp

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

func (s *StorePublicationServer) listStoreTrash(w http.ResponseWriter, r *http.Request) {
	if !s.auth.Authorized(r) {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "service authentication is required")
		return
	}
	actor := strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID"))
	if actor == "" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "operator is required")
		return
	}
	limit := 25
	if raw := r.URL.Query().Get("limit"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 1 || n > 50 {
			writeStorePublicationError(w, postgres.ErrStoreTrashInvalid)
			return
		}
		limit = n
	}
	page, err := s.service.ListDeletedStores(r.Context(), actor, limit, r.URL.Query().Get("cursor"))
	if err != nil {
		writeStorePublicationError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, page)
}

func (s *StorePublicationServer) trashStore(w http.ResponseWriter, r *http.Request) {
	s.mutateStoreTrash(w, r, "trash")
}
func (s *StorePublicationServer) restoreStore(w http.ResponseWriter, r *http.Request) {
	s.mutateStoreTrash(w, r, "restore")
}

func (s *StorePublicationServer) mutateStoreTrash(w http.ResponseWriter, r *http.Request, action string) {
	if !s.auth.Authorized(r) {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "service authentication is required")
		return
	}
	if r.Header.Get(forbiddenActorIDHeader) != "" || r.Header.Get(forbiddenIfMatchHeader) != "" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", forbiddenLegacyHeadersError)
		return
	}
	actor, _, key, version, ok := requiredPublicationHeaders(w, r)
	if !ok {
		return
	}
	var input struct {
		Reason string `json:"reason"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	if (action == "trash" && strings.TrimSpace(input.Reason) == "") || (action == "restore" && input.Reason != "") {
		writeStorePublicationError(w, postgres.ErrStoreTrashInvalid)
		return
	}
	item, replay, err := s.service.SetStoreTrash(r.Context(), actor, r.PathValue("storeId"), action, input.Reason, key, version)
	if err != nil {
		writeStorePublicationError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, struct {
		Store            postgres.DeletedStore `json:"store"`
		IdempotentReplay bool                  `json:"idempotentReplay"`
	}{Store: item, IdempotentReplay: replay})
}
