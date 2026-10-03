package transporthttp

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/auth"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/contract"
	identityintegration "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/identity"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storeavailability"
	identityclient "github.com/bthwani2-boop/samrim/services/identity/clients/go"
)

type StoreAvailabilityServer struct {
	operatorAuth *auth.ServiceToken
	service      *storeavailability.Service
	db           *sql.DB
}

type storeAvailabilityMutationRequest struct {
	ScheduleMode                string                         `json:"scheduleMode"`
	WeeklySchedule              []postgres.StoreScheduleWindow `json:"weeklySchedule"`
	Paused                      bool                           `json:"paused"`
	PauseReason                 *string                        `json:"pauseReason,omitempty"`
	PauseUntil                  *time.Time                     `json:"pauseUntil,omitempty"`
	PreparationMinutes          *int                           `json:"preparationMinutes,omitempty"`
	UnavailableFulfillmentModes []string                       `json:"unavailableFulfillmentModes"`
	ExpectedVersion             int                            `json:"expectedVersion"`
}

type storeAvailabilityMutationResponse struct {
	Availability       contract.StoreOperationalAvailability `json:"availability"`
	OrderabilityByMode []contract.StoreOrderability          `json:"orderabilityByMode"`
	IdempotentReplay   bool                                  `json:"idempotentReplay"`
}

func NewStoreAvailability(identityClient *identityintegration.Client, operatorServiceToken string, db *sql.DB) (*StoreAvailabilityServer, error) {
	authorizer, err := auth.NewServiceToken(strings.TrimSpace(operatorServiceToken))
	if err != nil {
		return nil, err
	}
	service, err := storeavailability.New(identityClient, db)
	if err != nil {
		return nil, err
	}
	return &StoreAvailabilityServer{operatorAuth: authorizer, service: service, db: db}, nil
}

func (s *StoreAvailabilityServer) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /dsh/partner/stores/{storeId}/operational-availability", s.readForPartner)
	mux.HandleFunc("PATCH /dsh/partner/stores/{storeId}/operational-availability", s.updateForPartner)
	mux.HandleFunc("GET /dsh/operations/stores/{storeId}/operational-availability", s.readForOperator)
	mux.HandleFunc("PATCH /dsh/operations/stores/{storeId}/operational-availability", s.updateForOperator)
}

func (s *StoreAvailabilityServer) readForPartner(w http.ResponseWriter, r *http.Request) {
	token := bearerToken(r)
	if token == "" {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "partner session is required")
		return
	}
	availability, err := s.service.ReadForPartner(r.Context(), token, r.PathValue("storeId"))
	if err != nil {
		writeStoreAvailabilityError(w, err)
		return
	}
	store, err := postgres.ReadStore(r.Context(), s.db, availability.StoreID)
	if err != nil {
		writeStoreAvailabilityError(w, err)
		return
	}
	orderability, err := evaluateStoreOrderabilityByMode(r.Context(), s.db, store.ID, store.FulfillmentModes)
	if err != nil {
		writeStoreAvailabilityError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, contract.PartnerStoreOperationalAvailabilityResponse{Availability: toOperationalAvailabilityView(availability), OrderabilityByMode: orderability})
}

func (s *StoreAvailabilityServer) updateForPartner(w http.ResponseWriter, r *http.Request) {
	token := bearerToken(r)
	if token == "" {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "partner session is required")
		return
	}
	correlationID, idempotencyKey, ok := storeAvailabilityMutationHeaders(w, r)
	if !ok {
		return
	}
	input, ok := decodeStoreAvailabilityMutation(w, r, r.PathValue("storeId"), correlationID, idempotencyKey)
	if !ok {
		return
	}
	availability, replayed, err := s.service.UpdateForPartner(r.Context(), token, input)
	if err != nil {
		writeStoreAvailabilityError(w, err)
		return
	}
	store, err := postgres.ReadStore(r.Context(), s.db, availability.StoreID)
	if err != nil {
		writeStoreAvailabilityError(w, err)
		return
	}
	orderability, err := evaluateStoreOrderabilityByMode(r.Context(), s.db, store.ID, store.FulfillmentModes)
	if err != nil {
		writeStoreAvailabilityError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, storeAvailabilityMutationResponse{Availability: toOperationalAvailabilityView(availability), OrderabilityByMode: orderability, IdempotentReplay: replayed})
}

func (s *StoreAvailabilityServer) readForOperator(w http.ResponseWriter, r *http.Request) {
	if !s.operatorAuth.Authorized(r) {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "service authentication is required")
		return
	}
	actingActorID := strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID"))
	if actingActorID == "" || len(actingActorID) > 128 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "X-Acting-Actor-ID is required")
		return
	}
	availability, err := s.service.ReadForOperator(r.Context(), actingActorID, r.PathValue("storeId"))
	if err != nil {
		writeStoreAvailabilityError(w, err)
		return
	}
	store, err := postgres.ReadStore(r.Context(), s.db, availability.StoreID)
	if err != nil {
		writeStoreAvailabilityError(w, err)
		return
	}
	orderability, err := evaluateStoreOrderabilityByMode(r.Context(), s.db, store.ID, store.FulfillmentModes)
	if err != nil {
		writeStoreAvailabilityError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, contract.PartnerStoreOperationalAvailabilityResponse{Availability: toOperationalAvailabilityView(availability), OrderabilityByMode: orderability})
}

func (s *StoreAvailabilityServer) updateForOperator(w http.ResponseWriter, r *http.Request) {
	if !s.operatorAuth.Authorized(r) {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "service authentication is required")
		return
	}
	actingActorID := strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID"))
	if actingActorID == "" || len(actingActorID) > 128 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "X-Acting-Actor-ID is required")
		return
	}
	correlationID, idempotencyKey, ok := storeAvailabilityMutationHeaders(w, r)
	if !ok {
		return
	}
	input, ok := decodeStoreAvailabilityMutation(w, r, r.PathValue("storeId"), correlationID, idempotencyKey)
	if !ok {
		return
	}
	availability, replayed, err := s.service.UpdateForOperator(r.Context(), actingActorID, input)
	if err != nil {
		writeStoreAvailabilityError(w, err)
		return
	}
	store, err := postgres.ReadStore(r.Context(), s.db, availability.StoreID)
	if err != nil {
		writeStoreAvailabilityError(w, err)
		return
	}
	orderability, err := evaluateStoreOrderabilityByMode(r.Context(), s.db, store.ID, store.FulfillmentModes)
	if err != nil {
		writeStoreAvailabilityError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, storeAvailabilityMutationResponse{Availability: toOperationalAvailabilityView(availability), OrderabilityByMode: orderability, IdempotentReplay: replayed})
}

func decodeStoreAvailabilityMutation(w http.ResponseWriter, r *http.Request, storeID, correlationID, idempotencyKey string) (postgres.UpdateStoreOperationalAvailabilityInput, bool) {
	var request storeAvailabilityMutationRequest
	if !decodeJSON(w, r, &request) {
		return postgres.UpdateStoreOperationalAvailabilityInput{}, false
	}
	if request.ExpectedVersion < 1 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "expectedVersion must be a positive integer")
		return postgres.UpdateStoreOperationalAvailabilityInput{}, false
	}
	return postgres.UpdateStoreOperationalAvailabilityInput{
		StoreID:                     strings.TrimSpace(storeID),
		ScheduleMode:                strings.TrimSpace(request.ScheduleMode),
		WeeklySchedule:              request.WeeklySchedule,
		Paused:                      request.Paused,
		PauseReason:                 request.PauseReason,
		PauseUntil:                  request.PauseUntil,
		PreparationMinutes:          request.PreparationMinutes,
		UnavailableFulfillmentModes: request.UnavailableFulfillmentModes,
		ExpectedVersion:             request.ExpectedVersion,
		IdempotencyKey:              idempotencyKey,
		CorrelationID:               correlationID,
	}, true
}

func storeAvailabilityMutationHeaders(w http.ResponseWriter, r *http.Request) (string, string, bool) {
	if r.Header.Get("X-Actor-ID") != "" || r.Header.Get("If-Match") != "" || r.Header.Get("X-Expected-Version") != "" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "X-Actor-ID, If-Match, and X-Expected-Version are forbidden; expectedVersion belongs in the request body")
		return "", "", false
	}
	correlationID := strings.TrimSpace(r.Header.Get("X-Correlation-ID"))
	idempotencyKey := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	if len(correlationID) < 8 || len(correlationID) > 128 || len(idempotencyKey) < 8 || len(idempotencyKey) > 128 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "bounded X-Correlation-ID and Idempotency-Key are required")
		return "", "", false
	}
	return correlationID, idempotencyKey, true
}

func writeStoreAvailabilityError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, storeavailability.ErrInvalidInput), errors.Is(err, postgres.ErrStoreOperationalAvailabilityInvalid):
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "Store operational availability facts are invalid")
	case errors.Is(err, storeavailability.ErrPartnerSessionForbidden):
		writeError(w, http.StatusForbidden, "FORBIDDEN", "an active app-partner session is required")
	case errors.Is(err, storeavailability.ErrStoreAccessForbidden), errors.Is(err, postgres.ErrStoreAccessForbidden):
		writeError(w, http.StatusForbidden, "FORBIDDEN", "Store ownership or an active store_operations grant is required")
	case errors.Is(err, storeavailability.ErrOperatorNotActive):
		writeError(w, http.StatusForbidden, "FORBIDDEN", "an active Operator with Operations permission is required")
	case errors.Is(err, postgres.ErrStoreOperationalAvailabilityNotFound), errors.Is(err, postgres.ErrStoreNotFound):
		writeError(w, http.StatusNotFound, "NOT_FOUND", "Store was not found")
	case errors.Is(err, postgres.ErrStoreOperationalAvailabilityVersion):
		writeError(w, http.StatusConflict, "VERSION_CONFLICT", "Store availability version is stale; read canonical state and retry")
	case errors.Is(err, postgres.ErrStoreOperationalAvailabilityIdem):
		writeError(w, http.StatusConflict, "IDEMPOTENCY_CONFLICT", "Idempotency-Key was already used with different Store availability facts")
	default:
		var identityErr *identityclient.Error
		if errors.As(err, &identityErr) {
			writeIdentityError(w, err)
			return
		}
		writeError(w, http.StatusBadGateway, "DSH_STORAGE_UNAVAILABLE", "DSH persistence or Identity is unavailable")
	}
}

func evaluateStoreOrderabilityByMode(ctx context.Context, db *sql.DB, storeID string, modes []string) ([]contract.StoreOrderability, error) {
	evaluatedAt := time.Now().UTC()
	items := make([]contract.StoreOrderability, 0, len(modes))
	for _, mode := range modes {
		result, err := postgres.EvaluateStoreOrderability(ctx, db, storeID, mode, evaluatedAt)
		if err != nil {
			return nil, err
		}
		items = append(items, toStoreOrderabilityView(result))
	}
	return items, nil
}

func toOperationalAvailabilityView(value postgres.StoreOperationalAvailability) contract.StoreOperationalAvailability {
	pauseReason := ""
	if value.PauseReason != nil {
		pauseReason = *value.PauseReason
	}
	preparationMinutes := 0
	if value.PreparationMinutes != nil {
		preparationMinutes = *value.PreparationMinutes
	}
	modes := make([]contract.StoreFulfillmentMode, 0, len(value.UnavailableFulfillmentModes))
	for _, mode := range value.UnavailableFulfillmentModes {
		modes = append(modes, contract.StoreFulfillmentMode(mode))
	}
	weeklySchedule := make([]contract.StoreScheduleWindow, 0, len(value.WeeklySchedule))
	for _, window := range value.WeeklySchedule {
		weeklySchedule = append(weeklySchedule, contract.StoreScheduleWindow{DayOfWeek: window.DayOfWeek, OpensAtMinute: window.OpensAtMinute, ClosesAtMinute: window.ClosesAtMinute})
	}
	return contract.StoreOperationalAvailability{
		StoreID: value.StoreID, ScheduleMode: value.ScheduleMode, ScheduleTimezone: value.ScheduleTimezone,
		WeeklySchedule: weeklySchedule, Paused: value.Paused, PauseReason: pauseReason,
		PauseUntil: value.PauseUntil, PreparationMinutes: preparationMinutes,
		UnavailableFulfillmentModes: modes, Version: value.Version, UpdatedByActorID: value.UpdatedByActorID, UpdatedAt: value.UpdatedAt,
	}
}

func toStoreOrderabilityView(value postgres.StoreOrderability) contract.StoreOrderability {
	reason := ""
	if value.Reason != nil {
		reason = *value.Reason
	}
	preparationMinutes := 0
	if value.PreparationMinutes != nil {
		preparationMinutes = *value.PreparationMinutes
	}
	return contract.StoreOrderability{
		StoreID: value.StoreID, FulfillmentMode: contract.StoreFulfillmentMode(value.FulfillmentMode),
		State: value.State, Reason: reason, PreparationMinutes: preparationMinutes,
		Version: value.Version, EvaluatedAt: value.EvaluatedAt,
	}
}
