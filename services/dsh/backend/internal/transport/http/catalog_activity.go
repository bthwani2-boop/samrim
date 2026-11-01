package transporthttp

import (
	"errors"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	"net/http"
	"strconv"
	"strings"
)

func catalogActivityFilters(w http.ResponseWriter, r *http.Request) (postgres.CatalogActivityFilter, bool) {
	query := r.URL.Query()
	filter := postgres.CatalogActivityFilter{
		StoreID: strings.TrimSpace(query.Get("storeId")), Query: strings.TrimSpace(query.Get("q")),
		Kind: strings.TrimSpace(query.Get("kind")), Action: strings.TrimSpace(query.Get("action")),
		From: strings.TrimSpace(query.Get("from")), To: strings.TrimSpace(query.Get("to")),
		Cursor: strings.TrimSpace(query.Get("cursor")), Limit: 20,
	}
	if raw := strings.TrimSpace(query.Get("limit")); raw != "" {
		limit, err := strconv.Atoi(raw)
		if err != nil || limit < 1 || limit > 50 {
			writeError(w, http.StatusBadRequest, "INVALID_INPUT", "limit must be between 1 and 50")
			return filter, false
		}
		filter.Limit = limit
	}
	if len(filter.Query) > 120 || len(filter.Cursor) > 2048 || len(filter.StoreID) > 128 ||
		(filter.Kind != "" && filter.Kind != "product" && filter.Kind != "offer") ||
		(filter.Action != "" && filter.Action != "created" && filter.Action != "updated" && filter.Action != "migrated") {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "activity filters are invalid")
		return filter, false
	}
	return filter, true
}

func writeCatalogActivityError(w http.ResponseWriter, err error) {
	if errors.Is(err, postgres.ErrCatalogActivityFilter) {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "activity filters or cursor are invalid")
		return
	}
	writeCatalogError(w, err)
}

func (s *CatalogServer) listOperatorCatalogActivity(w http.ResponseWriter, r *http.Request) {
	if !s.auth.Authorized(r) {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "service authentication is required")
		return
	}
	actor := strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID"))
	if actor == "" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "operator actor is required")
		return
	}
	filter, ok := catalogActivityFilters(w, r)
	if !ok {
		return
	}
	page, err := s.service.ListActivityForOperator(r.Context(), actor, filter)
	if err != nil {
		writeCatalogActivityError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, page)
}

func (s *CatalogServer) listPartnerCatalogActivity(w http.ResponseWriter, r *http.Request) {
	if bearerToken(r) == "" {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "partner session is required")
		return
	}
	if r.Header.Get("X-Acting-Actor-ID") != "" || r.Header.Get("X-Actor-ID") != "" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "actor identity comes from the session")
		return
	}
	filter, ok := catalogActivityFilters(w, r)
	if !ok {
		return
	}
	if filter.StoreID != "" || filter.Kind != "" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "partner activity scope is set by the store route")
		return
	}
	page, err := s.service.ListActivityForPartner(r.Context(), bearerToken(r), r.PathValue("storeId"), filter)
	if err != nil {
		writeCatalogActivityError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, page)
}
