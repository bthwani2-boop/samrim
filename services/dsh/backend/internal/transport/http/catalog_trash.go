package transporthttp

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

func (s *CatalogServer) listProductTrash(w http.ResponseWriter, r *http.Request) {
	if !s.auth.Authorized(r) {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "service authentication is required")
		return
	}
	actor := strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID"))
	if actor == "" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "acting operator is required")
		return
	}
	limit := 50
	if text := r.URL.Query().Get("limit"); text != "" {
		n, err := strconv.Atoi(text)
		if err != nil || n < 1 || n > 100 {
			writeError(w, http.StatusBadRequest, "INVALID_INPUT", "limit must be between 1 and 100")
			return
		}
		limit = n
	}
	page, err := s.service.ListDeletedProductsForOperator(r.Context(), actor, limit, r.URL.Query().Get("cursor"))
	if err != nil {
		writeCatalogError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, page)
}

func (s *CatalogServer) trashProduct(w http.ResponseWriter, r *http.Request) {
	s.mutateProductTrash(w, r, "trash")
}

func (s *CatalogServer) restoreProduct(w http.ResponseWriter, r *http.Request) {
	s.mutateProductTrash(w, r, "restore")
}

func (s *CatalogServer) mutateProductTrash(w http.ResponseWriter, r *http.Request, action string) {
	if !s.auth.Authorized(r) {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "service authentication is required")
		return
	}
	actor, _, key, expected, ok := requiredVersionedCaseHeaders(w, r)
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
	product, replayed, err := s.service.SetProductTrashedForOperator(r.Context(), actor, r.PathValue("productId"), input.Reason, action, key, expected)
	if err != nil {
		writeCatalogError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, struct {
		Product          postgres.DeletedCatalogProduct `json:"product"`
		IdempotentReplay bool                           `json:"idempotentReplay"`
	}{Product: product, IdempotentReplay: replayed})
}

func (s *CatalogServer) listStoreProductTrash(w http.ResponseWriter, r *http.Request) {
	if bearerToken(r) == "" {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "partner session is required")
		return
	}
	limit := 50
	if raw := r.URL.Query().Get("limit"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 1 || n > 100 {
			writeCatalogError(w, postgres.ErrCatalogTrashInvalid)
			return
		}
		limit = n
	}
	page, err := s.service.ListDeletedProductsForStore(r.Context(), bearerToken(r), r.PathValue("storeId"), limit, r.URL.Query().Get("cursor"))
	if err != nil {
		writeCatalogError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, page)
}

func (s *CatalogServer) trashStoreProduct(w http.ResponseWriter, r *http.Request) {
	s.mutateStoreProductTrash(w, r, "trash")
}

func (s *CatalogServer) restoreStoreProduct(w http.ResponseWriter, r *http.Request) {
	s.mutateStoreProductTrash(w, r, "restore")
}

func (s *CatalogServer) mutateStoreProductTrash(w http.ResponseWriter, r *http.Request, action string) {
	_, key, expected, ok := requiredPartnerOfferHeaders(w, r, true)
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
	product, replayed, err := s.service.SetStoreProductTrashed(r.Context(), bearerToken(r), r.PathValue("storeId"), r.PathValue("productId"), input.Reason, action, key, expected)
	if err != nil {
		writeCatalogError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, struct {
		Product          postgres.DeletedCatalogProduct `json:"product"`
		IdempotentReplay bool                           `json:"idempotentReplay"`
	}{Product: product, IdempotentReplay: replayed})
}
