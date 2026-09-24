package transporthttp

import (
	"database/sql"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/contract"
	identityintegration "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/identity"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	identityclient "github.com/bthwani2-boop/samrim/services/identity/clients/go"
)

type ClientFavoritesServer struct {
	identity *identityintegration.Client
	db       *sql.DB
}

func NewClientFavorites(identityClient *identityintegration.Client, db *sql.DB) (*ClientFavoritesServer, error) {
	if identityClient == nil || db == nil {
		return nil, errors.New("client favorites configuration is invalid")
	}
	return &ClientFavoritesServer{identity: identityClient, db: db}, nil
}

func (s *ClientFavoritesServer) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /dsh/client/favorite-stores", s.list)
	mux.HandleFunc("PUT /dsh/client/favorite-stores/{storeId}", s.add)
	mux.HandleFunc("DELETE /dsh/client/favorite-stores/{storeId}", s.remove)
	mux.HandleFunc("GET /dsh/client/favorite-store-offers", s.listOffers)
	mux.HandleFunc("PUT /dsh/client/favorite-store-offers/{storeOfferId}", s.addOffer)
	mux.HandleFunc("DELETE /dsh/client/favorite-store-offers/{storeOfferId}", s.removeOffer)
	mux.HandleFunc("GET /dsh/client/favorite-store-catalog", s.readFavoriteCatalog)
}

func (s *ClientFavoritesServer) list(w http.ResponseWriter, r *http.Request) {
	actorID, ok := s.requireClient(w, r)
	if !ok {
		return
	}
	storeIDs, err := postgres.ListClientFavoriteStoreIDs(r.Context(), s.db, actorID)
	if err != nil {
		writeClientFavoriteStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, contract.FavoriteStoreListResponse{StoreIds: storeIDs})
}

func (s *ClientFavoritesServer) listOffers(w http.ResponseWriter, r *http.Request) {
	actorID, ok := s.requireClient(w, r)
	if !ok {
		return
	}
	storeID := strings.TrimSpace(r.URL.Query().Get("storeId"))
	if storeID == "" || len(storeID) > 128 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "storeId is required for favorite offers")
		return
	}
	offerIDs, err := postgres.ListClientFavoriteStoreOfferIDs(r.Context(), s.db, actorID, storeID)
	if err != nil {
		writeClientFavoriteStoreOfferError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, contract.FavoriteStoreOfferListResponse{OfferIds: offerIDs})
}

func (s *ClientFavoritesServer) readFavoriteCatalog(w http.ResponseWriter, r *http.Request) {
	actorID, ok := s.requireClient(w, r)
	if !ok {
		return
	}
	storeID := strings.TrimSpace(r.URL.Query().Get("storeId"))
	serviceCityID := strings.TrimSpace(r.URL.Query().Get("serviceCityId"))
	cursor := strings.TrimSpace(r.URL.Query().Get("cursor"))
	limit := 20
	if rawLimit := strings.TrimSpace(r.URL.Query().Get("limit")); rawLimit != "" {
		parsed, err := strconv.Atoi(rawLimit)
		if err != nil || parsed < 1 || parsed > 100 {
			writeError(w, http.StatusBadRequest, "INVALID_INPUT", "limit must be between 1 and 100")
			return
		}
		limit = parsed
	}
	if storeID == "" || len(storeID) > 128 || serviceCityID == "" || len(serviceCityID) > 128 || len(cursor) > 1024 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "favorite store catalog scope or cursor is invalid")
		return
	}
	result, err := postgres.ReadPublicFavoriteStoreCatalog(r.Context(), s.db, storeID, serviceCityID, actorID, limit, cursor)
	if err != nil {
		writeClientFavoriteStoreOfferError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, toPublicCatalogResponse(result))
}

func (s *ClientFavoritesServer) addOffer(w http.ResponseWriter, r *http.Request) {
	s.mutateOffer(w, r, "add")
}

func (s *ClientFavoritesServer) removeOffer(w http.ResponseWriter, r *http.Request) {
	s.mutateOffer(w, r, "remove")
}

func (s *ClientFavoritesServer) mutateOffer(w http.ResponseWriter, r *http.Request, operation string) {
	actorID, ok := s.requireClient(w, r)
	if !ok {
		return
	}
	storeOfferID := strings.TrimSpace(r.PathValue("storeOfferId"))
	correlationID := strings.TrimSpace(r.Header.Get("X-Correlation-ID"))
	idempotencyKey := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	if storeOfferID == "" || len(storeOfferID) > 128 || len(correlationID) < 8 || len(correlationID) > 128 || len(idempotencyKey) < 8 || len(idempotencyKey) > 128 || r.Header.Get("X-Actor-ID") != "" || r.Header.Get("X-Acting-Actor-ID") != "" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "favorite store offer mutation attribution and storeOfferId are invalid")
		return
	}
	result, err := postgres.SetClientFavoriteStoreOffer(r.Context(), s.db, actorID, storeOfferID, operation, idempotencyKey, postgres.HashClientFavoriteStoreOfferMutation(operation, storeOfferID), correlationID)
	if err != nil {
		writeClientFavoriteStoreOfferError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, contract.FavoriteStoreOfferResponse{StoreOfferID: result.StoreOfferID, IsFavorite: result.IsFavorite, IdempotentReplay: result.Replayed})
}

func (s *ClientFavoritesServer) add(w http.ResponseWriter, r *http.Request) {
	s.mutate(w, r, "add")
}

func (s *ClientFavoritesServer) remove(w http.ResponseWriter, r *http.Request) {
	s.mutate(w, r, "remove")
}

func (s *ClientFavoritesServer) mutate(w http.ResponseWriter, r *http.Request, operation string) {
	actorID, ok := s.requireClient(w, r)
	if !ok {
		return
	}
	storeID := strings.TrimSpace(r.PathValue("storeId"))
	correlationID := strings.TrimSpace(r.Header.Get("X-Correlation-ID"))
	idempotencyKey := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	if storeID == "" || len(storeID) > 128 || len(correlationID) < 8 || len(correlationID) > 128 || len(idempotencyKey) < 8 || len(idempotencyKey) > 128 || r.Header.Get("X-Actor-ID") != "" || r.Header.Get("X-Acting-Actor-ID") != "" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "favorite store mutation attribution and storeId are invalid")
		return
	}
	result, err := postgres.SetClientFavoriteStore(r.Context(), s.db, actorID, storeID, operation, idempotencyKey, postgres.HashClientFavoriteStoreMutation(operation, storeID), correlationID)
	if err != nil {
		writeClientFavoriteStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, contract.FavoriteStoreResponse{StoreID: result.StoreID, IsFavorite: result.IsFavorite, IdempotentReplay: result.Replayed})
}

func (s *ClientFavoritesServer) requireClient(w http.ResponseWriter, r *http.Request) (string, bool) {
	token := bearerToken(r)
	if token == "" {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "client session is required")
		return "", false
	}
	identity, err := s.identity.ReadSession(r.Context(), token)
	if err != nil {
		var identityErr *identityclient.Error
		if errors.As(err, &identityErr) {
			writeIdentityError(w, err)
		} else {
			writeError(w, http.StatusBadGateway, "IDENTITY_UNAVAILABLE", "identity service is unavailable")
		}
		return "", false
	}
	if identity.Role != "client" || identity.Surface != "app-client" || strings.TrimSpace(identity.Subject) == "" {
		writeError(w, http.StatusForbidden, "FORBIDDEN", "an active app-client session is required")
		return "", false
	}
	return identity.Subject, true
}

func writeClientFavoriteStoreOfferError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, postgres.ErrFavoriteStoreOfferIdempotencyConflict):
		writeError(w, http.StatusConflict, "IDEMPOTENCY_CONFLICT", "Idempotency-Key was already used with different favorite-offer facts")
	case errors.Is(err, postgres.ErrFavoriteStoreOfferUnavailable):
		writeError(w, http.StatusConflict, "OFFER_UNAVAILABLE", "the StoreOffer is not currently available for favorites")
	case errors.Is(err, postgres.ErrCatalogOfferNotFound):
		writeError(w, http.StatusNotFound, "NOT_FOUND", "StoreOffer was not found")
	case errors.Is(err, postgres.ErrStoreNotFound):
		writeError(w, http.StatusNotFound, "NOT_FOUND", "published Store catalog was not found")
	default:
		var identityErr *identityclient.Error
		if errors.As(err, &identityErr) {
			writeIdentityError(w, err)
			return
		}
		writeError(w, http.StatusBadGateway, "DSH_STORAGE_UNAVAILABLE", "DSH persistence is unavailable")
	}
}

func writeClientFavoriteStoreError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, postgres.ErrFavoriteStoreIdempotencyConflict):
		writeError(w, http.StatusConflict, "IDEMPOTENCY_CONFLICT", "Idempotency-Key was already used with different favorite-store facts")
	case errors.Is(err, postgres.ErrFavoriteStoreUnavailable):
		writeError(w, http.StatusConflict, "STORE_UNAVAILABLE", "the Store is not currently available for favorites")
	case errors.Is(err, postgres.ErrStoreNotFound):
		writeError(w, http.StatusNotFound, "NOT_FOUND", "store was not found")
	default:
		var identityErr *identityclient.Error
		if errors.As(err, &identityErr) {
			writeIdentityError(w, err)
			return
		}
		writeError(w, http.StatusBadGateway, "DSH_STORAGE_UNAVAILABLE", "DSH persistence is unavailable")
	}
}
