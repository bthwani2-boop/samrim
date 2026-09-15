package transporthttp

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/auth"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/contract"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/identity"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storepublication"
	identityclient "github.com/bthwani2-boop/samrim/services/identity/clients/go"
)

type StorePublicationServer struct {
	auth    *auth.ServiceToken
	service *storepublication.Service
	db      *sql.DB
}

func NewStorePublication(identityClient *identity.Client, accessToken string, db *sql.DB) (*StorePublicationServer, error) {
	authorizer, err := auth.NewServiceToken(accessToken)
	if err != nil {
		return nil, err
	}
	service, err := storepublication.New(identityClient, db)
	if err != nil {
		return nil, err
	}
	return &StorePublicationServer{auth: authorizer, service: service, db: db}, nil
}

func (s *StorePublicationServer) serviceDB() *sql.DB { return s.db }

func (s *StorePublicationServer) Register(mux *http.ServeMux) {
	mux.HandleFunc("POST /dsh/stores/{storeId}/publication", s.publish)
	mux.HandleFunc("GET /dsh/stores/{storeId}/publication", s.readForOperator)
	mux.HandleFunc("GET /dsh/public/stores", s.listPublic)
	mux.HandleFunc("GET /dsh/public/stores/{storeId}", s.readPublic)
}

func (s *StorePublicationServer) publish(w http.ResponseWriter, r *http.Request) {
	if !s.auth.Authorized(r) {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "service authentication is required")
		return
	}
	if r.Header.Get("X-Actor-ID") != "" || r.Header.Get("If-Match") != "" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "X-Actor-ID and If-Match are forbidden")
		return
	}
	acting, correlation, idempotency, expectedVersion, ok := requiredPublicationHeaders(w, r)
	if !ok {
		return
	}
	var input contract.StorePublicationRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	if strings.TrimSpace(r.PathValue("storeId")) == "" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "storeId is required")
		return
	}
	result, readiness, err := s.service.Publish(r.Context(), r.PathValue("storeId"), string(input.State), expectedVersion, idempotency, acting, correlation)
	if err != nil {
		writeStorePublicationError(w, err)
		return
	}
	assortments, err := postgres.ListStoreAssortments(r.Context(), s.serviceDB(), result.Store.ID, false)
	if err != nil {
		writeStorageError(w, err)
		return
	}
	writeStorePublication(w, http.StatusOK, result, readiness, assortments)
}

func (s *StorePublicationServer) readForOperator(w http.ResponseWriter, r *http.Request) {
	if !s.auth.Authorized(r) {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "service authentication is required")
		return
	}
	acting := strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID"))
	if acting == "" || len(acting) > 128 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "X-Acting-Actor-ID is required")
		return
	}
	store, readiness, err := s.service.ReadForOperator(r.Context(), r.PathValue("storeId"), acting)
	if err != nil {
		writeStorePublicationError(w, err)
		return
	}
	assortments, err := postgres.ListStoreAssortments(r.Context(), s.serviceDB(), store.ID, false)
	if err != nil {
		writeStorageError(w, err)
		return
	}
	writeStorePublication(w, http.StatusOK, postgres.PublicationResult{Store: store}, readiness, assortments)
}

func (s *StorePublicationServer) listPublic(w http.ResponseWriter, r *http.Request) {
	serviceCityID := strings.TrimSpace(r.URL.Query().Get("serviceCityId"))
	if serviceCityID == "" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "serviceCityId is required for scoped discovery")
		return
	}
	stores, err := s.service.ListPublished(r.Context(), serviceCityID)
	if err != nil {
		writeStorePublicationError(w, err)
		return
	}
	values := make([]contract.PublicStoreView, 0, len(stores))
	for _, store := range stores {
		values = append(values, toPublicStoreView(store))
	}
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	_ = json.NewEncoder(w).Encode(contract.PublishedStoreListResponse{Stores: values})
}

func (s *StorePublicationServer) readPublic(w http.ResponseWriter, r *http.Request) {
	serviceCityID := strings.TrimSpace(r.URL.Query().Get("serviceCityId"))
	if serviceCityID == "" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "serviceCityId is required for scoped discovery")
		return
	}
	store, err := s.service.ReadPublished(r.Context(), r.PathValue("storeId"), serviceCityID)
	if errors.Is(err, postgres.ErrStoreNotFound) {
		writeError(w, http.StatusNotFound, "NOT_FOUND", "published store was not found")
		return
	}
	if err != nil {
		writeStorePublicationError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	_ = json.NewEncoder(w).Encode(toPublicStoreView(store))
}

func requiredPublicationHeaders(w http.ResponseWriter, r *http.Request) (string, string, string, int, bool) {
	acting := strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID"))
	correlation := strings.TrimSpace(r.Header.Get("X-Correlation-ID"))
	idempotency := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	expectedRaw := strings.TrimSpace(r.Header.Get("X-Expected-Version"))
	expectedVersion, err := strconv.Atoi(expectedRaw)
	if len(acting) == 0 || len(acting) > 128 || len(correlation) < 8 || len(correlation) > 128 || len(idempotency) < 8 || len(idempotency) > 128 || err != nil || expectedVersion < 1 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "publication attribution, idempotency, and a positive expected version are required")
		return "", "", "", 0, false
	}
	return acting, correlation, idempotency, expectedVersion, true
}

func writeStorePublicationError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, storepublication.ErrOperatorNotActive):
		writeError(w, http.StatusForbidden, "FORBIDDEN", "an active control operator session is required")
	case errors.Is(err, storepublication.ErrPublicationReadinessBlocked):
		writeError(w, http.StatusConflict, "READINESS_BLOCKED", "store publication readiness gates are not satisfied")
	case errors.Is(err, storepublication.ErrPartnerIdentityUnavailable):
		writeError(w, http.StatusBadGateway, "IDENTITY_UNAVAILABLE", "partner publication eligibility is unavailable")
	case errors.Is(err, postgres.ErrStoreNotFound):
		writeError(w, http.StatusNotFound, "NOT_FOUND", "store was not found")
	case errors.Is(err, postgres.ErrServiceCityNotFound):
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "serviceCityId must identify an active service city")
	case errors.Is(err, postgres.ErrPublicationIdempotencyConflict):
		writeError(w, http.StatusConflict, "IDEMPOTENCY_CONFLICT", "Idempotency-Key was already used with different publication facts")
	case errors.Is(err, postgres.ErrPublicationVersionConflict):
		writeError(w, http.StatusConflict, "VERSION_CONFLICT", "store publication version is stale")
	case errors.Is(err, postgres.ErrInvalidPublicationState):
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "publication state must be published or hidden")
	default:
		var identityErr *identityclient.Error
		if errors.As(err, &identityErr) {
			writeIdentityError(w, err)
			return
		}
		writeError(w, http.StatusBadGateway, "DSH_STORAGE_UNAVAILABLE", "DSH persistence is unavailable")
	}
}

func writeStorePublication(w http.ResponseWriter, status int, result postgres.PublicationResult, readiness storepublication.PublicationReadiness, assortments []postgres.StoreAssortmentRecord) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(contract.StorePublicationResponse{
		Store:            toStoreView(result.Store, readiness, assortments),
		IdempotentReplay: result.Replayed,
	})
}

func toPublicStoreView(store postgres.PublicStoreRecord) contract.PublicStoreView {
	assortments := make([]contract.StoreAssortment, 0, len(store.Assortments))
	for _, assortment := range store.Assortments {
		assortments = append(assortments, toStoreAssortment(assortment))
	}
	return contract.PublicStoreView{
		ID: store.ID, Name: store.Name, Version: store.Version, PublishedAt: store.PublishedAt,
		ServiceCity: toServiceCityRecord(store.ServiceCity),
		Assortments: assortments,
		CreatedAt:   store.CreatedAt, UpdatedAt: store.UpdatedAt,
	}
}
