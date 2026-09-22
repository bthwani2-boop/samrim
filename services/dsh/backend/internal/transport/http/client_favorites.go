package transporthttp

import (
	"database/sql"
	"errors"
	"net/http"
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
