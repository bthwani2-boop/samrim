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
	identityintegration "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/identity"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/joiningcase"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storepublication"
	identityclient "github.com/bthwani2-boop/samrim/services/identity/clients/go"
)

type JoiningCaseServer struct {
	auth        *auth.ServiceToken
	service     *joiningcase.Service
	publication *storepublication.Service
	db          *sql.DB
}

func NewJoiningCase(identityClient *identityintegration.Client, accessToken string, db *sql.DB, publication *storepublication.Service) (*JoiningCaseServer, error) {
	authorizer, err := auth.NewServiceToken(strings.TrimSpace(accessToken))
	if err != nil {
		return nil, err
	}
	service, err := joiningcase.New(identityClient, db)
	if err != nil {
		return nil, err
	}
	if publication == nil {
		return nil, errors.New("joining case publication readiness is invalid")
	}
	return &JoiningCaseServer{auth: authorizer, service: service, publication: publication, db: db}, nil
}

func (s *JoiningCaseServer) Register(mux *http.ServeMux) {
	mux.HandleFunc("POST /dsh/joining-cases", s.create)
	mux.HandleFunc("GET /dsh/joining-cases", s.listForOperator)
	mux.HandleFunc("GET /dsh/joining-cases/self", s.readForPartner)
	mux.HandleFunc("GET /dsh/joining-cases/{caseId}", s.readForOperator)
	mux.HandleFunc("POST /dsh/joining-cases/{caseId}/submit", s.submit)
	mux.HandleFunc("POST /dsh/joining-cases/{caseId}/correct-and-resubmit", s.correctAndResubmitForPartner)
	mux.HandleFunc("POST /dsh/joining-cases/{caseId}/review", s.review)
}

func (s *JoiningCaseServer) listForOperator(w http.ResponseWriter, r *http.Request) {
	if !s.auth.Authorized(r) {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "service authentication is required")
		return
	}
	limit := 25
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil {
			writeJoiningCaseError(w, postgres.ErrJoiningCaseInvalidLimit)
			return
		}
		limit = parsed
	}
	actingActorID := strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID"))
	if actingActorID == "" || len(actingActorID) > 128 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "X-Acting-Actor-ID is required")
		return
	}
	result, err := s.service.ListForOperator(r.Context(), r.URL.Query().Get("state"), limit, r.URL.Query().Get("cursor"), actingActorID)
	if err != nil {
		writeJoiningCaseError(w, err)
		return
	}
	items := make([]contract.JoiningCaseSummary, 0, len(result.Cases))
	for _, item := range result.Cases {
		items = append(items, contract.JoiningCaseSummary{ID: item.ID, ContactPhoneE164: item.ContactPhoneE164, BusinessName: item.BusinessName, FirstStoreName: item.FirstStoreName, ServiceCityID: item.FirstStoreServiceCityID, PartnerActorID: item.PartnerActorID, State: contract.JoiningCaseState(item.State), CorrectionReason: item.CorrectionReason, ReviewedBy: item.ReviewedBy, Version: item.Version, CreatedAt: item.CreatedAt, UpdatedAt: item.UpdatedAt})
	}
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(contract.JoiningCaseListResponse{Cases: items, NextCursor: result.NextCursor})
}

func (s *JoiningCaseServer) create(w http.ResponseWriter, r *http.Request) {
	if !s.auth.Authorized(r) {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "service authentication is required")
		return
	}
	if r.Header.Get("X-Actor-ID") != "" || r.Header.Get("If-Match") != "" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "X-Actor-ID and If-Match are forbidden")
		return
	}
	acting, correlation, idempotency, ok := requiredMutationHeaders(w, r)
	if !ok {
		return
	}
	var input contract.CreateJoiningCaseRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	result, err := s.service.Create(r.Context(), postgres.JoiningCaseRecord{ContactPhoneE164: input.ContactPhoneE164, BusinessName: input.BusinessName, FirstStoreName: input.FirstStoreName, FirstStoreServiceCityID: input.ServiceCityID, FirstStoreVerticalID: input.FirstStoreVerticalID, FirstStoreLatitude: &input.FirstStoreLatitude, FirstStoreLongitude: &input.FirstStoreLongitude}, idempotency, acting, correlation)
	if err != nil {
		writeJoiningCaseError(w, err)
		return
	}
	s.writeResult(w, r, responseStatus(result.Replayed), result)
}

func (s *JoiningCaseServer) readForOperator(w http.ResponseWriter, r *http.Request) {
	if !s.auth.Authorized(r) {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "service authentication is required")
		return
	}
	result, err := s.service.ReadForOperator(r.Context(), r.PathValue("caseId"), strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID")))
	if err != nil {
		writeJoiningCaseError(w, err)
		return
	}
	s.writeResult(w, r, http.StatusOK, result)
}

func (s *JoiningCaseServer) readForPartner(w http.ResponseWriter, r *http.Request) {
	result, err := s.service.ReadForPartner(r.Context(), bearerToken(r))
	if err != nil {
		writeJoiningCaseError(w, err)
		return
	}
	s.writeResult(w, r, http.StatusOK, result)
}

func (s *JoiningCaseServer) submit(w http.ResponseWriter, r *http.Request) {
	if !s.auth.Authorized(r) {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "service authentication is required")
		return
	}
	acting, correlation, idempotency, expected, ok := requiredVersionedCaseHeaders(w, r)
	if !ok {
		return
	}
	result, err := s.service.Submit(r.Context(), r.PathValue("caseId"), expected, idempotency, acting, correlation)
	if err != nil {
		writeJoiningCaseError(w, err)
		return
	}
	s.writeResult(w, r, http.StatusOK, result)
}

func (s *JoiningCaseServer) review(w http.ResponseWriter, r *http.Request) {
	if !s.auth.Authorized(r) {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "service authentication is required")
		return
	}
	acting, correlation, idempotency, expected, ok := requiredVersionedCaseHeaders(w, r)
	if !ok {
		return
	}
	var input contract.ReviewJoiningCaseRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	decision := string(input.Decision)
	result, err := s.service.Review(r.Context(), r.PathValue("caseId"), decision, input.CorrectionReason, expected, idempotency, acting, correlation)
	if err != nil {
		writeJoiningCaseError(w, err)
		return
	}
	s.writeResult(w, r, http.StatusOK, result)
}

func (s *JoiningCaseServer) correctAndResubmitForPartner(w http.ResponseWriter, r *http.Request) {
	correlation, idempotency, expected, ok := requiredPartnerCaseHeaders(w, r)
	if !ok {
		return
	}
	var input contract.CorrectJoiningCaseRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	result, err := s.service.CorrectAndResubmitForPartner(r.Context(), bearerToken(r), r.PathValue("caseId"), input.BusinessName, input.FirstStoreName, input.ServiceCityID, input.FirstStoreVerticalID, input.FirstStoreLatitude, input.FirstStoreLongitude, expected, idempotency, correlation)
	if err != nil {
		writeJoiningCaseError(w, err)
		return
	}
	s.writeResult(w, r, http.StatusOK, result)
}

func (s *JoiningCaseServer) writeResult(w http.ResponseWriter, ctx *http.Request, status int, result postgres.JoiningCaseResult) {
	view := contract.JoiningCaseView{ID: result.Case.ID, ContactPhoneE164: result.Case.ContactPhoneE164, BusinessName: result.Case.BusinessName, FirstStoreName: result.Case.FirstStoreName, ServiceCityID: result.Case.FirstStoreServiceCityID, FirstStoreVerticalID: result.Case.FirstStoreVerticalID, FirstStoreLatitude: nullableFloatValue(result.Case.FirstStoreLatitude), FirstStoreLongitude: nullableFloatValue(result.Case.FirstStoreLongitude), State: contract.JoiningCaseState(result.Case.State), Version: result.Case.Version, CreatedAt: result.Case.CreatedAt, UpdatedAt: result.Case.UpdatedAt}
	view.PartnerActorID = result.Case.PartnerActorID
	view.CorrectionReason = result.Case.CorrectionReason
	view.ReviewedBy = result.Case.ReviewedBy
	if result.Case.Store != nil {
		readiness, err := s.publication.ReadinessForStore(ctx.Context(), *result.Case.Store)
		if err != nil {
			writeStorePublicationError(w, err)
			return
		}
		offers, err := postgres.ListCatalogOffers(ctx.Context(), s.db, result.Case.Store.ID, false)
		if err != nil {
			writeStorageError(w, err)
			return
		}
		storeView := toStoreView(*result.Case.Store, readiness, offers)
		view.Store = &storeView
	}
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(contract.JoiningCaseResponse{Case: view, IdempotentReplay: result.Replayed})
}

func responseStatus(replayed bool) int {
	if replayed {
		return http.StatusOK
	}
	return http.StatusCreated
}

func requiredMutationHeaders(w http.ResponseWriter, r *http.Request) (string, string, string, bool) {
	acting := strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID"))
	correlation := strings.TrimSpace(r.Header.Get("X-Correlation-ID"))
	idempotency := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	if len(acting) == 0 || len(acting) > 128 || len(correlation) < 8 || len(correlation) > 128 || len(idempotency) < 8 || len(idempotency) > 128 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "X-Acting-Actor-ID, X-Correlation-ID, and Idempotency-Key are required")
		return "", "", "", false
	}
	return acting, correlation, idempotency, true
}

func requiredVersionedCaseHeaders(w http.ResponseWriter, r *http.Request) (string, string, string, int, bool) {
	acting, correlation, idempotency, ok := requiredMutationHeaders(w, r)
	if !ok {
		return "", "", "", 0, false
	}
	expected, err := strconv.Atoi(strings.TrimSpace(r.Header.Get("X-Expected-Version")))
	if err != nil || expected < 1 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "X-Expected-Version must be a positive integer")
		return "", "", "", 0, false
	}
	return acting, correlation, idempotency, expected, true
}

func requiredPartnerCaseHeaders(w http.ResponseWriter, r *http.Request) (string, string, int, bool) {
	if r.Header.Get("X-Actor-ID") != "" || r.Header.Get("X-Acting-Actor-ID") != "" || r.Header.Get("If-Match") != "" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "client actor authority headers are forbidden")
		return "", "", 0, false
	}
	correlation := strings.TrimSpace(r.Header.Get("X-Correlation-ID"))
	idempotency := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	expected, err := strconv.Atoi(strings.TrimSpace(r.Header.Get("X-Expected-Version")))
	if len(correlation) < 8 || len(correlation) > 128 || len(idempotency) < 8 || len(idempotency) > 128 || err != nil || expected < 1 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "X-Correlation-ID, Idempotency-Key, and X-Expected-Version are required")
		return "", "", 0, false
	}
	return correlation, idempotency, expected, true
}

func writeJoiningCaseError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, postgres.ErrJoiningCaseNotFound):
		writeError(w, http.StatusNotFound, "NOT_FOUND", "joining case was not found")
	case errors.Is(err, postgres.ErrJoiningCaseIdempotency):
		writeError(w, http.StatusConflict, "IDEMPOTENCY_CONFLICT", "Idempotency-Key was already used with different joining case facts")
	case errors.Is(err, postgres.ErrJoiningCaseVersion):
		writeError(w, http.StatusConflict, "VERSION_CONFLICT", "joining case version is stale")
	case errors.Is(err, postgres.ErrJoiningCaseState):
		writeError(w, http.StatusConflict, "STATE_CONFLICT", "joining case state does not allow this transition")
	case errors.Is(err, postgres.ErrJoiningCaseActor):
		writeError(w, http.StatusConflict, "ACTOR_CONFLICT", "partner actor is already bound to another joining case")
	case errors.Is(err, postgres.ErrJoiningCaseRebind):
		writeError(w, http.StatusConflict, "ACTOR_REBIND_FORBIDDEN", "a submitted partner identity cannot be rebound")
	case errors.Is(err, postgres.ErrJoiningCaseSelfReview):
		writeError(w, http.StatusForbidden, "FORBIDDEN", "the bound partner actor cannot review its own joining case")
	case errors.Is(err, postgres.ErrJoiningCaseExists):
		writeError(w, http.StatusConflict, "JOINING_CASE_EXISTS", "an active joining case already exists for this phone")
	case errors.Is(err, postgres.ErrJoiningCaseStoreExists):
		writeError(w, http.StatusConflict, "STORE_EXISTS", "partner already has a canonical store")
	case errors.Is(err, postgres.ErrJoiningCaseInvalidDecision):
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "review decision is invalid")
	case errors.Is(err, postgres.ErrJoiningCasePartnerAccess):
		writeError(w, http.StatusForbidden, "FORBIDDEN", "the partner session does not own this joining case")
	case errors.Is(err, postgres.ErrJoiningCaseInvalidLimit), errors.Is(err, postgres.ErrJoiningCaseInvalidCursor), errors.Is(err, postgres.ErrJoiningCaseInvalidState):
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "joining case queue parameters are invalid")
	case errors.Is(err, joiningcase.ErrInvalidInput):
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "joining case input is invalid")
	case errors.Is(err, joiningcase.ErrOperatorNotActive):
		writeError(w, http.StatusForbidden, "FORBIDDEN", "an active control operator session is required")
	case errors.Is(err, joiningcase.ErrPartnerSessionForbidden):
		writeError(w, http.StatusForbidden, "FORBIDDEN", "an active app-partner session is required")
	case errors.Is(err, joiningcase.ErrServiceCityUnavailable), errors.Is(err, postgres.ErrJoiningCaseServiceCity):
		writeError(w, http.StatusConflict, "SERVICE_CITY_UNAVAILABLE", "an active service city is required")
	case errors.Is(err, postgres.ErrJoiningCaseStoreOrigin):
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "a fixed store origin is required in the joining case")
	default:
		var identityErr *identityclient.Error
		if errors.As(err, &identityErr) {
			writeIdentityError(w, err)
			return
		}
		writeError(w, http.StatusBadGateway, "DSH_STORAGE_UNAVAILABLE", "DSH persistence or Identity admission is unavailable")
	}
}
