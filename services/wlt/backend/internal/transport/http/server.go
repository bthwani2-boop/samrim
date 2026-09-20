package http

import (
	"crypto/subtle"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/bthwani2-boop/samrim/services/wlt/backend/internal/storage/postgres"
)

type Server struct {
	db           *sql.DB
	serviceToken string
}

func New(db *sql.DB, serviceToken string) (*Server, error) {
	if db == nil || strings.TrimSpace(serviceToken) == "" {
		return nil, errors.New("WLT HTTP server configuration is invalid")
	}
	return &Server{db: db, serviceToken: strings.TrimSpace(serviceToken)}, nil
}

func (s *Server) Register(mux *http.ServeMux) {
	mux.HandleFunc("POST /wlt/v1/payment-intents", s.create)
	mux.HandleFunc("GET /wlt/v1/payment-intents/{intentId}", s.read)
	mux.HandleFunc("POST /wlt/v1/payment-intents/{intentId}/collect", s.collect)
	mux.HandleFunc("POST /wlt/v1/payment-intents/{intentId}/cancel", s.cancel)
}

type createRequest struct {
	ExternalReference string `json:"externalReference"`
	PayerActorID      string `json:"payerActorId"`
	AmountMinor       int64  `json:"amountMinor"`
	Currency          string `json:"currency"`
	Method            string `json:"method"`
}

type collectRequest struct {
	CollectedAmountMinor int64  `json:"collectedAmountMinor"`
	CollectedByActorID   string `json:"collectedByActorId"`
	CollectionReference  string `json:"collectionReference"`
}

type cancelRequest struct {
	Reason string `json:"reason"`
}

type paymentIntentResponse struct {
	PaymentIntent    paymentIntentJSON `json:"paymentIntent"`
	IdempotentReplay bool              `json:"idempotentReplay"`
}

type paymentIntentJSON struct {
	ID                   string  `json:"id"`
	ExternalReference    string  `json:"externalReference"`
	PayerActorID         string  `json:"payerActorId"`
	AmountMinor          int64   `json:"amountMinor"`
	Currency             string  `json:"currency"`
	Method               string  `json:"method"`
	State                string  `json:"state"`
	Version              int     `json:"version"`
	CollectedAmountMinor *int64  `json:"collectedAmountMinor"`
	CollectedByActorID   *string `json:"collectedByActorId"`
	CollectionReference  *string `json:"collectionReference"`
	CollectedAt          *string `json:"collectedAt"`
	CancellationReason   *string `json:"cancellationReason"`
	CreatedAt            string  `json:"createdAt"`
	UpdatedAt            string  `json:"updatedAt"`
}

func (s *Server) create(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	correlation, idempotency, ok := mutationHeaders(w, r)
	if !ok {
		return
	}
	var input createRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	result, replayed, err := postgres.CreatePaymentIntent(r.Context(), s.db, postgres.CreatePaymentIntentInput{ExternalReference: input.ExternalReference, PayerActorID: input.PayerActorID, AmountMinor: input.AmountMinor, Currency: input.Currency, Method: input.Method, IdempotencyKey: idempotency, CorrelationID: correlation})
	if err != nil {
		writePaymentError(w, err)
		return
	}
	status := http.StatusCreated
	if replayed {
		status = http.StatusOK
	}
	writeJSON(w, status, paymentIntentResponse{PaymentIntent: toPaymentIntent(result), IdempotentReplay: replayed})
}

func (s *Server) read(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	result, err := postgres.ReadPaymentIntent(r.Context(), s.db, r.PathValue("intentId"))
	if err != nil {
		writePaymentError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, paymentIntentResponse{PaymentIntent: toPaymentIntent(result)})
}

func (s *Server) collect(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	correlation, idempotency, expected, ok := versionedMutationHeaders(w, r)
	if !ok {
		return
	}
	var input collectRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	result, replayed, err := postgres.CollectPaymentIntent(r.Context(), s.db, postgres.CollectPaymentIntentInput{IntentID: r.PathValue("intentId"), CollectedAmountMinor: input.CollectedAmountMinor, CollectedByActorID: input.CollectedByActorID, CollectionReference: input.CollectionReference, ExpectedVersion: expected, IdempotencyKey: idempotency, CorrelationID: correlation})
	if err != nil {
		writePaymentError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, paymentIntentResponse{PaymentIntent: toPaymentIntent(result), IdempotentReplay: replayed})
}

func (s *Server) cancel(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	correlation, idempotency, expected, ok := versionedMutationHeaders(w, r)
	if !ok {
		return
	}
	var input cancelRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	result, replayed, err := postgres.CancelPaymentIntent(r.Context(), s.db, postgres.CancelPaymentIntentInput{IntentID: r.PathValue("intentId"), Reason: input.Reason, ExpectedVersion: expected, IdempotencyKey: idempotency, CorrelationID: correlation})
	if err != nil {
		writePaymentError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, paymentIntentResponse{PaymentIntent: toPaymentIntent(result), IdempotentReplay: replayed})
}

func (s *Server) authorize(w http.ResponseWriter, r *http.Request) bool {
	provided := strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(r.Header.Get("Authorization")), "Bearer "))
	if provided == "" || subtle.ConstantTimeCompare([]byte(provided), []byte(s.serviceToken)) != 1 {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "WLT service authorization is required")
		return false
	}
	return true
}

func mutationHeaders(w http.ResponseWriter, r *http.Request) (string, string, bool) {
	correlation := strings.TrimSpace(r.Header.Get("X-Correlation-ID"))
	idempotency := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	if len(correlation) < 8 || len(correlation) > 128 || len(idempotency) < 8 || len(idempotency) > 128 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "X-Correlation-ID and Idempotency-Key are required")
		return "", "", false
	}
	return correlation, idempotency, true
}

func versionedMutationHeaders(w http.ResponseWriter, r *http.Request) (string, string, int, bool) {
	correlation, idempotency, ok := mutationHeaders(w, r)
	if !ok {
		return "", "", 0, false
	}
	expected, err := strconv.Atoi(strings.TrimSpace(r.Header.Get("X-Expected-Version")))
	if err != nil || expected < 1 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "X-Expected-Version must be a positive integer")
		return "", "", 0, false
	}
	return correlation, idempotency, expected, true
}

func decodeJSON(w http.ResponseWriter, r *http.Request, target any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 32*1024)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "request body is invalid")
		return false
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "request body must contain exactly one JSON value")
		return false
	}
	return true
}

func toPaymentIntent(item postgres.PaymentIntentRecord) paymentIntentJSON {
	result := paymentIntentJSON{ID: item.ID, ExternalReference: item.ExternalReference, PayerActorID: item.PayerActorID, AmountMinor: item.AmountMinor, Currency: item.Currency, Method: item.Method, State: item.State, Version: item.Version, CollectedAmountMinor: item.CollectedAmountMinor, CollectedByActorID: item.CollectedByActorID, CollectionReference: item.CollectionReference, CancellationReason: item.CancellationReason, CreatedAt: item.CreatedAt.UTC().Format("2006-01-02T15:04:05.999Z07:00"), UpdatedAt: item.UpdatedAt.UTC().Format("2006-01-02T15:04:05.999Z07:00")}
	if item.CollectedAt != nil {
		value := item.CollectedAt.UTC().Format("2006-01-02T15:04:05.999Z07:00")
		result.CollectedAt = &value
	}
	return result
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, map[string]any{"error": map[string]string{"code": code, "message": message}})
}

func writePaymentError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, postgres.ErrNotFound):
		writeError(w, http.StatusNotFound, "NOT_FOUND", "payment intent was not found")
	case errors.Is(err, postgres.ErrIdempotencyConflict):
		writeError(w, http.StatusConflict, "IDEMPOTENCY_CONFLICT", "Idempotency-Key was already used with different payment facts")
	case errors.Is(err, postgres.ErrIntentExists):
		writeError(w, http.StatusConflict, "PAYMENT_EXISTS", "a payment intent already exists for this external reference")
	case errors.Is(err, postgres.ErrVersionConflict):
		writeError(w, http.StatusConflict, "VERSION_CONFLICT", "payment intent version is stale")
	case errors.Is(err, postgres.ErrStateConflict):
		writeError(w, http.StatusConflict, "STATE_CONFLICT", "payment intent state does not allow this operation")
	case errors.Is(err, postgres.ErrAmountMismatch):
		writeError(w, http.StatusBadRequest, "AMOUNT_MISMATCH", "collected amount must equal the payment intent amount")
	case errors.Is(err, postgres.ErrInvalidInput):
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "payment input is invalid")
	default:
		writeError(w, http.StatusBadGateway, "WLT_STORAGE_UNAVAILABLE", "WLT persistence is unavailable")
	}
}
