package transporthttp

import (
	"net/http"
	"strings"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

type shoppingShortcutMutationRequest struct {
	VerticalID      string   `json:"verticalId"`
	TitleAr         string   `json:"titleAr"`
	Ordinal         int      `json:"ordinal"`
	Active          bool     `json:"active"`
	ExpectedVersion int      `json:"expectedVersion"`
	StoreTypeIDs    []string `json:"storeTypeIds"`
	CategoryIDs     []string `json:"categoryIds"`
	Reason          string   `json:"reason"`
}

func (s *CatalogServer) listShoppingShortcuts(w http.ResponseWriter, r *http.Request) {
	if !s.auth.Authorized(r) {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "service authentication is required")
		return
	}
	acting := strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID"))
	vertical := strings.TrimSpace(r.URL.Query().Get("verticalId"))
	if acting == "" || vertical == "" || len(vertical) > 128 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "acting actor and verticalId are required")
		return
	}
	values, err := s.service.ListShoppingShortcutsForOperator(r.Context(), acting, vertical)
	if err != nil {
		writeCatalogError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, struct {
		Shortcuts []postgres.ShoppingShortcutRecord `json:"shortcuts"`
	}{Shortcuts: values})
}

func (s *CatalogServer) createShoppingShortcut(w http.ResponseWriter, r *http.Request) {
	s.mutateShoppingShortcut(w, r, false)
}

func (s *CatalogServer) updateShoppingShortcut(w http.ResponseWriter, r *http.Request) {
	s.mutateShoppingShortcut(w, r, true)
}

func (s *CatalogServer) mutateShoppingShortcut(w http.ResponseWriter, r *http.Request, update bool) {
	if !s.auth.Authorized(r) {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "service authentication is required")
		return
	}
	acting, correlation, idempotency, ok := requiredMutationHeaders(w, r)
	if !ok {
		return
	}
	var req shoppingShortcutMutationRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	if (!update && req.ExpectedVersion != 0) || (update && req.ExpectedVersion < 1) {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "expectedVersion must match the mutation")
		return
	}
	shortcutID := ""
	if update {
		shortcutID = strings.TrimSpace(r.PathValue("shortcutId"))
	}
	result, err := s.service.MutateShoppingShortcut(r.Context(), acting, postgres.ShoppingShortcutInput{
		ID: shortcutID, VerticalID: req.VerticalID, TitleAr: req.TitleAr, Ordinal: req.Ordinal,
		Active: req.Active, ExpectedVersion: req.ExpectedVersion,
		StoreTypeIDs: req.StoreTypeIDs, CategoryIDs: req.CategoryIDs,
	}, idempotency, correlation, req.Reason)
	if err != nil {
		writeCatalogError(w, err)
		return
	}
	code := http.StatusOK
	if !update {
		code = responseStatus(result.Replayed)
	}
	writeJSON(w, code, result)
}
