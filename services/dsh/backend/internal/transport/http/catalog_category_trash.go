package transporthttp

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

func (s *CatalogServer) listCategoryTrash(w http.ResponseWriter, r *http.Request) {
	if !s.auth.Authorized(r) {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "service authentication is required")
		return
	}
	actor := strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID"))
	if actor == "" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "operator is required")
		return
	}
	limit := 50
	if raw := r.URL.Query().Get("limit"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 || parsed > 100 {
			writeCatalogError(w, postgres.ErrCatalogTrashInvalid)
			return
		}
		limit = parsed
	}
	page, err := s.service.ListDeletedCategoriesForOperator(r.Context(), actor, limit, r.URL.Query().Get("cursor"))
	if err != nil {
		writeCatalogError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, page)
}
func (s *CatalogServer) trashCategory(w http.ResponseWriter, r *http.Request) {
	s.mutateCategoryTrash(w, r, "trash")
}
func (s *CatalogServer) restoreCategory(w http.ResponseWriter, r *http.Request) {
	s.mutateCategoryTrash(w, r, "restore")
}
func (s *CatalogServer) mutateCategoryTrash(w http.ResponseWriter, r *http.Request, action string) {
	if !s.auth.Authorized(r) {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "service authentication is required")
		return
	}
	actor, _, key, version, ok := requiredVersionedCaseHeaders(w, r)
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
		writeCatalogError(w, postgres.ErrCatalogTrashInvalid)
		return
	}
	item, replay, err := s.service.SetCategoryTrashedForOperator(r.Context(), actor, r.PathValue("categoryId"), input.Reason, action, key, version)
	if err != nil {
		writeCatalogError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, struct {
		Category         postgres.DeletedCatalogCategory `json:"category"`
		IdempotentReplay bool                            `json:"idempotentReplay"`
	}{Category: item, IdempotentReplay: replay})
}
