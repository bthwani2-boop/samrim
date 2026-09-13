package transporthttp

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/catalog"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/contract"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/identity"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

type CatalogServer struct{ service *catalog.Service }

func NewCatalog(identityClient *identity.Client, db *sql.DB) (*CatalogServer, error) {
	service, err := catalog.New(identityClient, db)
	if err != nil {
		return nil, err
	}
	return &CatalogServer{service: service}, nil
}

func (s *CatalogServer) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /dsh/stores/{storeId}/catalog", s.list)
	mux.HandleFunc("POST /dsh/stores/{storeId}/catalog/items", s.create)
	mux.HandleFunc("POST /dsh/stores/{storeId}/catalog/items/{itemId}", s.update)
}

func (s *CatalogServer) list(w http.ResponseWriter, r *http.Request) {
	items, err := s.service.ListForPartner(r.Context(), bearerToken(r), r.PathValue("storeId"))
	if err != nil {
		writeCatalogError(w, err)
		return
	}
	writeCatalogItems(w, http.StatusOK, items)
}

func (s *CatalogServer) create(w http.ResponseWriter, r *http.Request) {
	correlation, idempotency, _, ok := requiredPartnerCatalogHeaders(w, r, false)
	if !ok {
		return
	}
	var input contract.CreateCatalogItemRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	result, err := s.service.Create(r.Context(), bearerToken(r), r.PathValue("storeId"), input.Name, idempotency, correlation)
	if err != nil {
		writeCatalogError(w, err)
		return
	}
	writeCatalogItem(w, responseStatus(result.Replayed), result)
}

func (s *CatalogServer) update(w http.ResponseWriter, r *http.Request) {
	correlation, idempotency, expected, ok := requiredPartnerCatalogHeaders(w, r, true)
	if !ok {
		return
	}
	var input contract.UpdateCatalogItemRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	result, err := s.service.Update(r.Context(), bearerToken(r), r.PathValue("storeId"), r.PathValue("itemId"), input.Name, string(input.PublicationState), input.Availability, expected, idempotency, correlation)
	if err != nil {
		writeCatalogError(w, err)
		return
	}
	writeCatalogItem(w, http.StatusOK, result)
}

func requiredPartnerCatalogHeaders(w http.ResponseWriter, r *http.Request, versioned bool) (string, string, int, bool) {
	if bearerToken(r) == "" {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "partner session is required")
		return "", "", 0, false
	}
	if r.Header.Get("X-Actor-ID") != "" || r.Header.Get("X-Acting-Actor-ID") != "" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "catalog ownership comes from the canonical partner session")
		return "", "", 0, false
	}
	correlation := strings.TrimSpace(r.Header.Get("X-Correlation-ID"))
	idempotency := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	if len(correlation) < 8 || len(correlation) > 128 || len(idempotency) < 8 || len(idempotency) > 128 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "X-Correlation-ID and Idempotency-Key are required")
		return "", "", 0, false
	}
	if !versioned {
		return correlation, idempotency, 0, true
	}
	expected, err := strconv.Atoi(strings.TrimSpace(r.Header.Get("X-Expected-Version")))
	if err != nil || expected < 1 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "X-Expected-Version must be a positive integer")
		return "", "", 0, false
	}
	return correlation, idempotency, expected, true
}

func writeCatalogItems(w http.ResponseWriter, status int, items []postgres.CatalogItemRecord) {
	views := make([]contract.CatalogItem, 0, len(items))
	for _, item := range items {
		views = append(views, toCatalogItem(item))
	}
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(contract.CatalogItemListResponse{Items: views})
}

func writeCatalogItem(w http.ResponseWriter, status int, result postgres.CatalogItemResult) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(contract.CatalogItemResponse{Item: toCatalogItem(result.Item), IdempotentReplay: result.Replayed})
}

func toCatalogItem(item postgres.CatalogItemRecord) contract.CatalogItem {
	return contract.CatalogItem{ItemID: item.ID, StoreID: item.StoreID, Name: item.Name, PublicationState: contract.CatalogPublicationState(item.PublicationState), Availability: item.Availability, Version: item.Version, CreatedAt: item.CreatedAt, UpdatedAt: item.UpdatedAt}
}

func writeCatalogError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, postgres.ErrCatalogItemNotFound), errors.Is(err, postgres.ErrCatalogStoreNotFound):
		writeError(w, http.StatusNotFound, "NOT_FOUND", "catalog record was not found")
	case errors.Is(err, postgres.ErrCatalogIdempotency):
		writeError(w, http.StatusConflict, "IDEMPOTENCY_CONFLICT", "Idempotency-Key was already used with different catalog facts")
	case errors.Is(err, postgres.ErrCatalogVersion):
		writeError(w, http.StatusConflict, "VERSION_CONFLICT", "catalog item version is stale")
	case errors.Is(err, catalog.ErrPartnerSessionForbidden):
		writeError(w, http.StatusForbidden, "FORBIDDEN", "an active app-partner session is required")
	case errors.Is(err, catalog.ErrStoreOwnershipForbidden):
		writeError(w, http.StatusForbidden, "FORBIDDEN", "partner store ownership is required")
	case errors.Is(err, postgres.ErrCatalogInvalidState):
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "catalog publication state is invalid")
	default:
		writeError(w, http.StatusBadGateway, "DSH_STORAGE_UNAVAILABLE", "DSH persistence or Identity is unavailable")
	}
}
