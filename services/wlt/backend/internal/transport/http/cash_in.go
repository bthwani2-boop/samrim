package http

import (
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/bthwani2-boop/samrim/services/wlt/backend/internal/cashin"
	"github.com/bthwani2-boop/samrim/services/wlt/backend/internal/storage/postgres"
)

type cashInFundingIntentJSON struct {
	ID                           string  `json:"id"`
	ActorType                    string  `json:"actorType"`
	ActorID                      string  `json:"actorId"`
	FundingPurpose               string  `json:"fundingPurpose"`
	ProviderKey                  string  `json:"providerKey"`
	ExternalReference            string  `json:"externalReference"`
	ProviderReference            *string `json:"providerReference,omitempty"`
	ProviderTransactionReference *string `json:"providerTransactionReference,omitempty"`
	AmountMinor                  int64   `json:"amountMinor"`
	Currency                     string  `json:"currency"`
	State                        string  `json:"state"`
	Version                      int     `json:"version"`
	LedgerTransactionID          *string `json:"ledgerTransactionId,omitempty"`
	CreatedAt                    string  `json:"createdAt"`
	UpdatedAt                    string  `json:"updatedAt"`
}

type walletStateJSON struct {
	ActorType          string `json:"actorType"`
	ActorID            string `json:"actorId"`
	Currency           string `json:"currency"`
	LedgerBalanceMinor int64  `json:"ledgerBalanceMinor"`
	HeldMinor          int64  `json:"heldMinor"`
	AvailableMinor     int64  `json:"availableMinor"`
	CashInEnabled      bool   `json:"cashInEnabled"`
	Simulator          bool   `json:"simulator"`
}

func (s *Server) readWalletState(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	actorType, actorID, ok := walletActorPath(w, r)
	if !ok {
		return
	}
	balance, held, available := int64(0), int64(0), int64(0)
	var err error
	if actorType == "captain" {
		captainState, readErr := postgres.ReadCaptainWalletState(r.Context(), s.db, actorID)
		err = readErr
		balance, held, available = captainState.LedgerBalanceMinor, captainState.HeldMinor, captainState.AvailableMinor
	} else {
		balance, err = postgres.ReadWalletBalance(r.Context(), s.db, actorType, actorID)
		available = balance
	}
	if err != nil {
		writeCashInError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"state": walletStateJSON{ActorType: actorType, ActorID: actorID, Currency: "YER", LedgerBalanceMinor: balance, HeldMinor: held, AvailableMinor: available, CashInEnabled: s.cashInRail != nil, Simulator: s.cashInSimulatorEnabled}})
}

func (s *Server) createCashInFundingIntent(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	if s.cashInRail == nil {
		writeError(w, http.StatusServiceUnavailable, "CASH_IN_UNAVAILABLE", "Cash-In is unavailable until an approved provider rail is configured")
		return
	}
	correlation, idempotency, ok := mutationHeaders(w, r)
	if !ok {
		return
	}
	actorType, actorID, ok := walletActorPath(w, r)
	if !ok {
		return
	}
	var input struct {
		AmountMinor int64 `json:"amountMinor"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	if s.cashInSimulatorEnabled && actorType != "customer" && actorType != "captain" {
		writeError(w, http.StatusForbidden, "FORBIDDEN", "Cash-In is not admitted for this actor")
		return
	}
	item, replayed, err := postgres.CreateCashInFundingIntent(r.Context(), s.db, postgres.CreateCashInFundingIntentInput{ActorType: actorType, ActorID: actorID, AmountMinor: input.AmountMinor, Currency: "YER", ProviderKey: postgres.DevelopmentSimulatorProvider, IdempotencyKey: idempotency, CorrelationID: correlation})
	if err != nil {
		writeCashInError(w, err)
		return
	}
	if replayed && item.State != "PENDING_PROVIDER" && item.State != "UNKNOWN" {
		writeJSON(w, http.StatusOK, map[string]any{"intent": toCashInFundingIntent(item), "simulator": s.cashInSimulatorEnabled, "idempotentReplay": true})
		return
	}
	result, err := s.cashInRail.CreatePayment(r.Context(), cashin.CreatePaymentRequest{IntentID: item.ID, ExternalReference: item.ExternalReference, AmountMinor: item.RequestedAmountMinor, Currency: item.Currency})
	if err != nil {
		writeError(w, http.StatusAccepted, "CASH_IN_RESULT_UNKNOWN", "Funding intent exists; the external result must be inquired or reconciled before retry")
		return
	}
	item, err = postgres.AttachCashInProviderReference(r.Context(), s.db, item.ID, result.ProviderReference)
	if err != nil {
		writeCashInError(w, err)
		return
	}
	status := http.StatusCreated
	if replayed {
		status = http.StatusOK
	}
	writeJSON(w, status, map[string]any{"intent": toCashInFundingIntent(item), "simulator": s.cashInSimulatorEnabled, "idempotentReplay": replayed})
}

func (s *Server) listCashInFundingIntents(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	actorType, actorID, ok := walletActorPath(w, r)
	if !ok {
		return
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	items, err := postgres.ListCashInFundingIntents(r.Context(), s.db, actorType, actorID, limit)
	if err != nil {
		writeCashInError(w, err)
		return
	}
	result := make([]cashInFundingIntentJSON, 0, len(items))
	for _, item := range items {
		result = append(result, toCashInFundingIntent(item))
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": result, "simulator": s.cashInSimulatorEnabled})
}

func (s *Server) readCashInFundingIntent(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	item, err := postgres.ReadCashInFundingIntent(r.Context(), s.db, r.PathValue("fundingIntentId"))
	if err != nil {
		writeCashInError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"intent": toCashInFundingIntent(item)})
}

func (s *Server) simulateCashInFundingIntent(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	if !s.cashInSimulatorEnabled {
		writeError(w, http.StatusNotFound, "NOT_FOUND", "development simulator route is not available")
		return
	}
	actingActorID := strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID"))
	if actingActorID == "" || len(actingActorID) > 128 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "X-Acting-Actor-ID is required")
		return
	}
	correlation, idempotency, ok := mutationHeaders(w, r)
	if !ok {
		return
	}
	var input struct {
		Outcome string `json:"outcome"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	intentID := strings.TrimSpace(r.PathValue("fundingIntentId"))
	current, err := postgres.ReadCashInFundingIntent(r.Context(), s.db, intentID)
	if err != nil {
		writeCashInError(w, err)
		return
	}
	if current.ProviderKey != postgres.DevelopmentSimulatorProvider {
		writeError(w, http.StatusForbidden, "FORBIDDEN", "only development-simulator funding intents can receive simulated outcomes")
		return
	}
	simulator, ok := s.cashInRail.(cashInSimulator)
	if !ok {
		writeError(w, http.StatusInternalServerError, "CONFIGURATION_ERROR", "development simulator is not configured")
		return
	}
	result, err := simulator.Simulate(input.Outcome, intentID)
	if err != nil {
		writeCashInError(w, err)
		return
	}
	item, replayed, err := postgres.ApplyCashInFundingResult(r.Context(), s.db, postgres.ApplyCashInFundingResultInput{FundingIntentID: intentID, Outcome: result.Outcome, ProviderTransactionReference: result.ProviderTransactionReference, ActorID: actingActorID, IdempotencyKey: idempotency, CorrelationID: correlation})
	if err != nil {
		writeCashInError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"intent": toCashInFundingIntent(item), "simulator": true, "idempotentReplay": replayed})
}

type cashInSimulator interface {
	Simulate(string, string) (cashin.PaymentInquiryResult, error)
}

func walletActorPath(w http.ResponseWriter, r *http.Request) (string, string, bool) {
	actorType := strings.ToLower(strings.TrimSpace(r.PathValue("actorType")))
	actorID := strings.TrimSpace(r.PathValue("actorId"))
	if (actorType != "customer" && actorType != "captain") || actorID == "" || len(actorID) > 128 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "a valid customer or captain wallet is required")
		return "", "", false
	}
	return actorType, actorID, true
}

func toCashInFundingIntent(item postgres.CashInFundingIntentRecord) cashInFundingIntentJSON {
	return cashInFundingIntentJSON{ID: item.ID, ActorType: item.ActorType, ActorID: item.ActorID, FundingPurpose: item.FundingPurpose, ProviderKey: item.ProviderKey, ExternalReference: item.ExternalReference, ProviderReference: item.ProviderReference, ProviderTransactionReference: item.ProviderTransactionReference, AmountMinor: item.RequestedAmountMinor, Currency: item.Currency, State: item.State, Version: item.Version, LedgerTransactionID: item.LedgerTransactionID, CreatedAt: item.CreatedAt.UTC().Format(time.RFC3339Nano), UpdatedAt: item.UpdatedAt.UTC().Format(time.RFC3339Nano)}
}

func writeCashInError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, postgres.ErrInvalidInput):
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "Cash-In input is invalid")
	case errors.Is(err, postgres.ErrFundingIntentNotFound):
		writeError(w, http.StatusNotFound, "NOT_FOUND", "Cash-In funding intent was not found")
	case errors.Is(err, postgres.ErrFundingIntentState):
		writeError(w, http.StatusConflict, "STATE_CONFLICT", "Cash-In funding intent cannot accept this result")
	case errors.Is(err, postgres.ErrIdempotencyConflict):
		writeError(w, http.StatusConflict, "IDEMPOTENCY_CONFLICT", "Cash-In idempotency key conflicts with another request")
	case errors.Is(err, cashin.ErrInvalidRequest):
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "simulator outcome is invalid")
	default:
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "Cash-In operation failed")
	}
}
