package transporthttp

import (
	"database/sql"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strconv"
	"strings"

	"github.com/lib/pq"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/auth"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/contract"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/identity"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/wlt"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storepublication"
	identityclient "github.com/bthwani2-boop/samrim/services/identity/clients/go"
)

type StorePublicationServer struct {
	auth    *auth.ServiceToken
	service *storepublication.Service
	db      *sql.DB
}

func NewStorePublication(identityClient *identity.Client, accessToken string, db *sql.DB, wltClient *wlt.Client) (*StorePublicationServer, error) {
	authorizer, err := auth.NewServiceToken(accessToken)
	if err != nil {
		return nil, err
	}
	service, err := storepublication.New(identityClient, db, wltClient)
	if err != nil {
		return nil, err
	}
	return &StorePublicationServer{auth: authorizer, service: service, db: db}, nil
}

func (s *StorePublicationServer) serviceDB() *sql.DB { return s.db }

func (s *StorePublicationServer) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /dsh/stores", s.listForOperator)
	mux.HandleFunc("POST /dsh/stores/{storeId}/publication", s.publish)
	mux.HandleFunc("POST /dsh/stores/{storeId}/fulfillment-modes", s.setFulfillmentModes)
	mux.HandleFunc("GET /dsh/stores/{storeId}/publication", s.readForOperator)
	mux.HandleFunc("GET /dsh/public/stores", s.listPublic)
	mux.HandleFunc("GET /dsh/public/stores/{storeId}", s.readPublic)
	mux.HandleFunc("GET /dsh/public/stores/{storeId}/catalog", s.readPublicCatalog)
	mux.HandleFunc("GET /dsh/public/catalog/search", s.searchPublicCatalog)
}

func (s *StorePublicationServer) listForOperator(w http.ResponseWriter, r *http.Request) {
	if !s.auth.Authorized(r) {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "service authentication is required")
		return
	}
	actingActorID := strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID"))
	limit := 25
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil {
			writeStorePublicationError(w, postgres.ErrOperatorStoreInvalidLimit)
			return
		}
		limit = parsed
	}
	page, err := s.service.ListForOperator(r.Context(), r.URL.Query().Get("state"), r.URL.Query().Get("q"), r.URL.Query().Get("sort"), actingActorID, limit, r.URL.Query().Get("cursor"))
	if err != nil {
		writeStorePublicationError(w, err)
		return
	}
	stores := make([]contract.OperatorStoreSummary, 0, len(page.Stores))
	for _, store := range page.Stores {
		stores = append(stores, contract.OperatorStoreSummary{ID: store.ID, PartnerActorID: store.PartnerActorID, Name: store.Name, ServiceCityID: store.ServiceCityID, PrimaryVerticalID: store.PrimaryVerticalID, Version: store.Version, PublicationState: contract.PublicationState(store.PublicationState), FulfillmentModes: toStoreFulfillmentModes(store.FulfillmentModes), CreatedAt: store.CreatedAt, UpdatedAt: store.UpdatedAt})
	}
	writeJSON(w, http.StatusOK, contract.OperatorStoreListResponse{Stores: stores, NextCursor: page.NextCursor})
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
		logStorePublicationFailure(correlation, err)
		writeStorePublicationError(w, err)
		return
	}
	writeStorePublication(w, http.StatusOK, result, readiness)
}

func (s *StorePublicationServer) setFulfillmentModes(w http.ResponseWriter, r *http.Request) {
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
	var input contract.SetStoreFulfillmentModesRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	modes := make([]string, 0, len(input.FulfillmentModes))
	for _, mode := range input.FulfillmentModes {
		modes = append(modes, string(mode))
	}
	result, err := s.service.SetFulfillmentModes(r.Context(), r.PathValue("storeId"), modes, expectedVersion, idempotency, acting, correlation)
	if err != nil {
		logStorePublicationFailure(correlation, err)
		writeStorePublicationError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, contract.StoreFulfillmentModesResponse{StoreID: result.StoreID, Version: result.Version, FulfillmentModes: toStoreFulfillmentModes(result.FulfillmentModes), IdempotentReplay: result.Replayed})
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
	writeStorePublication(w, http.StatusOK, postgres.PublicationResult{Store: store}, readiness)
}

func (s *StorePublicationServer) listPublic(w http.ResponseWriter, r *http.Request) {
	serviceCityID := strings.TrimSpace(r.URL.Query().Get("serviceCityId"))
	if serviceCityID == "" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "serviceCityId is required for scoped discovery")
		return
	}
	var latitude, longitude *float64
	rawLatitude, rawLongitude := strings.TrimSpace(r.URL.Query().Get("latitude")), strings.TrimSpace(r.URL.Query().Get("longitude"))
	if rawLatitude != "" || rawLongitude != "" {
		parsedLatitude, latitudeErr := strconv.ParseFloat(rawLatitude, 64)
		parsedLongitude, longitudeErr := strconv.ParseFloat(rawLongitude, 64)
		if latitudeErr != nil || longitudeErr != nil || parsedLatitude < -90 || parsedLatitude > 90 || parsedLongitude < -180 || parsedLongitude > 180 {
			writeError(w, http.StatusBadRequest, "INVALID_INPUT", "latitude and longitude must be valid coordinates")
			return
		}
		latitude, longitude = &parsedLatitude, &parsedLongitude
	}
	stores, err := s.service.ListPublished(r.Context(), serviceCityID, latitude, longitude)
	if err != nil {
		writeStorePublicationError(w, err)
		return
	}
	values := make([]contract.PublicStoreView, 0, len(stores))
	categoryIDs := make([]string, 0)
	for _, store := range stores {
		values = append(values, toPublicStoreView(store))
		categoryIDs = append(categoryIDs, store.CategoryIDs...)
	}
	categoryRecords, err := postgres.ListPublicCatalogCategories(r.Context(), s.db, categoryIDs)
	if err != nil {
		writeStorageError(w, err)
		return
	}
	categories := make([]contract.CatalogCategory, 0, len(categoryRecords))
	for _, category := range categoryRecords {
		categories = append(categories, toCatalogCategory(category))
	}
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	_ = json.NewEncoder(w).Encode(contract.PublishedStoreListResponse{Stores: values, Categories: categories})
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

func (s *StorePublicationServer) readPublicCatalog(w http.ResponseWriter, r *http.Request) {
	serviceCityID := strings.TrimSpace(r.URL.Query().Get("serviceCityId"))
	categoryID := strings.TrimSpace(r.URL.Query().Get("categoryId"))
	query := strings.TrimSpace(r.URL.Query().Get("q"))
	cursor := strings.TrimSpace(r.URL.Query().Get("cursor"))
	limit := 100
	if rawLimit := strings.TrimSpace(r.URL.Query().Get("limit")); rawLimit != "" {
		parsed, parseErr := strconv.Atoi(rawLimit)
		if parseErr != nil || parsed < 1 || parsed > 100 {
			writeError(w, http.StatusBadRequest, "INVALID_INPUT", "limit must be between 1 and 100")
			return
		}
		limit = parsed
	}
	if serviceCityID == "" || len(categoryID) > 128 || len(query) > 160 || len(cursor) > 512 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "catalog scope or filter is invalid")
		return
	}
	if _, err := s.service.ReadPublished(r.Context(), r.PathValue("storeId"), serviceCityID); err != nil {
		if errors.Is(err, postgres.ErrStoreNotFound) {
			writeError(w, http.StatusNotFound, "NOT_FOUND", "published store catalog was not found")
			return
		}
		writeStorePublicationError(w, err)
		return
	}
	result, err := postgres.ReadPublicCatalog(r.Context(), s.db, r.PathValue("storeId"), serviceCityID, categoryID, query, limit, cursor)
	if errors.Is(err, postgres.ErrStoreNotFound) {
		writeError(w, http.StatusNotFound, "NOT_FOUND", "published store catalog was not found")
		return
	}
	if err != nil {
		writeStorageError(w, err)
		return
	}
	categories := make([]contract.CatalogCategory, 0, len(result.Categories))
	for _, category := range result.Categories {
		categories = append(categories, toCatalogCategory(category))
	}
	offers := make([]contract.CatalogStoreOffer, 0, len(result.Offers))
	for _, offer := range result.Offers {
		offers = append(offers, toStoreOffer(offer))
	}
	sections := make([]contract.CatalogStorefrontSection, 0, len(result.Sections))
	for _, section := range result.Sections {
		nameEn := ""
		if section.NameEn != nil {
			nameEn = *section.NameEn
		}
		sections = append(sections, contract.CatalogStorefrontSection{ID: section.ID, StoreID: section.StoreID, NameAr: section.NameAr, NameEn: nameEn, Ordinal: section.Ordinal, Active: section.Active, Version: section.Version, OfferIds: section.OfferIDs, CreatedAt: section.CreatedAt, UpdatedAt: section.UpdatedAt})
	}
	nextCursor := ""
	if result.NextCursor != nil {
		nextCursor = *result.NextCursor
	}
	writeJSON(w, http.StatusOK, contract.PublicCatalogResponse{StoreID: result.StoreID, VerticalID: result.VerticalID, Categories: categories, Sections: sections, Offers: offers, NextCursor: nextCursor})
}

func (s *StorePublicationServer) searchPublicCatalog(w http.ResponseWriter, r *http.Request) {
	serviceCityID := strings.TrimSpace(r.URL.Query().Get("serviceCityId"))
	categoryID := strings.TrimSpace(r.URL.Query().Get("categoryId"))
	query := strings.TrimSpace(r.URL.Query().Get("q"))
	cursor := strings.TrimSpace(r.URL.Query().Get("cursor"))
	limit := 20
	if rawLimit := strings.TrimSpace(r.URL.Query().Get("limit")); rawLimit != "" {
		parsed, parseErr := strconv.Atoi(rawLimit)
		if parseErr != nil || parsed < 1 || parsed > 50 {
			writeError(w, http.StatusBadRequest, "INVALID_INPUT", "limit must be between 1 and 50")
			return
		}
		limit = parsed
	}
	if serviceCityID == "" || len(categoryID) > 128 || query == "" || len(query) > 160 || len(cursor) > 512 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "catalog search scope or query is invalid")
		return
	}
	result, err := postgres.SearchPublicCatalog(r.Context(), s.db, serviceCityID, categoryID, query, limit, cursor)
	if err != nil {
		writeStorageError(w, err)
		return
	}
	offers := make([]contract.CatalogStoreOffer, 0, len(result.Offers))
	for _, offer := range result.Offers {
		offers = append(offers, toStoreOffer(offer))
	}
	nextCursor := ""
	if result.NextCursor != nil {
		nextCursor = *result.NextCursor
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, contract.PublicCatalogSearchResponse{Offers: offers, NextCursor: nextCursor})
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

func logStorePublicationFailure(correlationID string, err error) {
	switch {
	case errors.Is(err, storepublication.ErrOperatorNotActive),
		errors.Is(err, storepublication.ErrPublicationReadinessBlocked),
		errors.Is(err, storepublication.ErrPartnerIdentityUnavailable),
		errors.Is(err, postgres.ErrStoreNotFound),
		errors.Is(err, postgres.ErrServiceCityNotFound),
		errors.Is(err, postgres.ErrPublicationIdempotencyConflict),
		errors.Is(err, postgres.ErrPublicationVersionConflict),
		errors.Is(err, postgres.ErrInvalidPublicationState):
		return
	}
	var identityErr *identityclient.Error
	if errors.As(err, &identityErr) {
		return
	}
	var databaseErr *pq.Error
	if errors.As(err, &databaseErr) {
		log.Printf("store publication persistence failure correlation_id=%q sqlstate=%q schema=%q table=%q column=%q constraint=%q", correlationID, string(databaseErr.Code), databaseErr.Schema, databaseErr.Table, databaseErr.Column, databaseErr.Constraint)
		return
	}
	cause := err
	for errors.Unwrap(cause) != nil {
		cause = errors.Unwrap(cause)
	}
	log.Printf("store publication internal failure correlation_id=%q cause_type=%T cause=%q", correlationID, cause, cause.Error())
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
	case errors.Is(err, postgres.ErrOperatorStoreInvalidLimit), errors.Is(err, postgres.ErrOperatorStoreInvalidActor), errors.Is(err, postgres.ErrOperatorStoreInvalidQuery), errors.Is(err, postgres.ErrOperatorStoreInvalidState), errors.Is(err, postgres.ErrOperatorStoreInvalidSort), errors.Is(err, postgres.ErrOperatorStoreInvalidCursor):
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "store filters, sort, limit, or cursor are invalid")
	case errors.Is(err, postgres.ErrServiceCityNotFound):
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "serviceCityId must identify an active service city")
	case errors.Is(err, postgres.ErrPublicationIdempotencyConflict):
		writeError(w, http.StatusConflict, "IDEMPOTENCY_CONFLICT", "Idempotency-Key was already used with different publication facts")
	case errors.Is(err, postgres.ErrPublicationVersionConflict):
		writeError(w, http.StatusConflict, "VERSION_CONFLICT", "store publication version is stale")
	case errors.Is(err, postgres.ErrInvalidPublicationState):
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "publication state must be published or hidden")
	case errors.Is(err, postgres.ErrFulfillmentModesInvalid):
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "one or more fulfillment modes are invalid")
	case errors.Is(err, postgres.ErrStoreFulfillmentModesNotFound):
		writeError(w, http.StatusNotFound, "NOT_FOUND", "store was not found")
	case errors.Is(err, postgres.ErrStoreFulfillmentModesIdempotency):
		writeError(w, http.StatusConflict, "IDEMPOTENCY_CONFLICT", "Idempotency-Key was already used with different fulfillment mode facts")
	case errors.Is(err, postgres.ErrStoreFulfillmentModesVersion):
		writeError(w, http.StatusConflict, "VERSION_CONFLICT", "store version is stale")
	default:
		var identityErr *identityclient.Error
		if errors.As(err, &identityErr) {
			writeIdentityError(w, err)
			return
		}
		writeError(w, http.StatusBadGateway, "DSH_STORAGE_UNAVAILABLE", "DSH persistence is unavailable")
	}
}

func toStoreFulfillmentModes(values []string) []contract.StoreFulfillmentMode {
	modes := make([]contract.StoreFulfillmentMode, 0, len(values))
	for _, mode := range values {
		modes = append(modes, contract.StoreFulfillmentMode(mode))
	}
	return modes
}

func writeStorePublication(w http.ResponseWriter, status int, result postgres.PublicationResult, readiness storepublication.PublicationReadiness) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(contract.StorePublicationResponse{
		Store:            toStoreView(result.Store, readiness),
		IdempotentReplay: result.Replayed,
	})
}

func toPublicStoreView(store postgres.PublicStoreRecord) contract.PublicStoreView {
	return contract.PublicStoreView{
		ID: store.ID, Name: store.Name, Version: store.Version, PublishedAt: store.PublishedAt,
		RatingAverage:     store.RatingAverage,
		RatingCount:       store.RatingCount,
		StoreProfileImage: toStoreProfileImage(store.StoreProfileImage),
		ServiceCity:       toServiceCityRecord(store.ServiceCity),
		PrimaryVerticalID: store.PrimaryVerticalID,
		DistanceMeters:    optionalDistanceValue(store.DistanceMeters),
		FulfillmentModes:  toFulfillmentModes(store.FulfillmentModes),
		CategoryIds:       store.CategoryIDs,
		CreatedAt:         store.CreatedAt, UpdatedAt: store.UpdatedAt,
	}
}

func optionalDistanceValue(value *int) int {
	if value == nil {
		return 0
	}
	return *value
}
