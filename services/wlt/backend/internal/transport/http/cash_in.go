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
	ProviderFeeMinor             int64   `json:"providerFeeMinor"`
	Currency                     string  `json:"currency"`
	State                        string  `json:"state"`
	Version                      int     `json:"version"`
	LedgerTransactionID          *string `json:"ledgerTransactionId,omitempty"`
	CreatedAt                    string  `json:"createdAt"`
	UpdatedAt                    string  `json:"updatedAt"`
}

type customerCompensationSummaryJSON struct {
	ID          string    `json:"id"`
	OrderID     string    `json:"orderId"`
	AmountMinor int64     `json:"amountMinor"`
	Currency    string    `json:"currency"`
	CreatedAt   time.Time `json:"createdAt"`
}

type walletStateJSON struct {
	ActorType           string                            `json:"actorType"`
	ActorID             string                            `json:"actorId"`
	Currency            string                            `json:"currency"`
	LedgerBalanceMinor  int64                             `json:"ledgerBalanceMinor"`
	HeldMinor           int64                             `json:"heldMinor"`
	AvailableMinor      int64                             `json:"availableMinor"`
	CashInEnabled       bool                              `json:"cashInEnabled"`
	ProviderMock        bool                              `json:"providerMock"`
	Simulator           bool                              `json:"simulator"`
	RecentCompensations []customerCompensationSummaryJSON `json:"recentCompensations,omitempty"`
}

func isProviderMock(rail cashin.CashInRail) bool {
	_, ok := rail.(*cashin.WireMockRail)
	return ok
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
	var recent []customerCompensationSummaryJSON
	var err error
	if actorType == "captain" {
		captainState, readErr := postgres.ReadCaptainWalletState(r.Context(), s.db, actorID)
		err = readErr
		balance, held, available = captainState.LedgerBalanceMinor, captainState.HeldMinor, captainState.AvailableMinor
	} else {
		customerState, readErr := postgres.ReadCustomerWalletState(r.Context(), s.db, actorID)
		err = readErr
		balance, held, available = customerState.LedgerBalanceMinor, customerState.HeldMinor, customerState.AvailableMinor
		if err == nil {
			var recorded []postgres.CustomerWalletCompensationRecord
			recorded, err = postgres.ListRecentCustomerWalletCompensations(r.Context(), s.db, actorID, 10)
			if err == nil {
				for _, item := range recorded {
					recent = append(recent, customerCompensationSummaryJSON{ID: item.CaseID, OrderID: item.OrderID, AmountMinor: item.AmountMinor, Currency: item.Currency, CreatedAt: item.CreatedAt})
				}
			}
		}
	}
	if err != nil {
		writeCashInError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"state": walletStateJSON{ActorType: actorType, ActorID: actorID, Currency: "YER", LedgerBalanceMinor: balance, HeldMinor: held, AvailableMinor: available, CashInEnabled: s.cashInRail != nil, Simulator: s.cashInSimulatorEnabled, ProviderMock: isProviderMock(s.cashInRail), RecentCompensations: recent}})
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
		AmountMinor int64  `json:"amountMinor"`
		ProviderKey string `json:"providerKey"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	if s.cashInSimulatorEnabled && actorType != "customer" && actorType != "captain" {
		writeError(w, http.StatusForbidden, "FORBIDDEN", "Cash-In is not admitted for this actor")
		return
	}
	providerKey := postgres.DevelopmentSimulatorProvider
	if _, mock := s.cashInRail.(*cashin.WireMockRail); mock {
		if !cashin.ValidMockProviderKey(input.ProviderKey) {
			writeError(w, http.StatusBadRequest, "INVALID_PROVIDER", "A configured wallet provider is required for Cash-In")
			return
		}
		providerKey = strings.ToUpper(strings.TrimSpace(input.ProviderKey))
	} else if input.ProviderKey != "" && !strings.EqualFold(input.ProviderKey, providerKey) {
		writeError(w, http.StatusBadRequest, "INVALID_PROVIDER", "This provider is not connected to the configured Cash-In rail")
		return
	}
	item, replayed, err := postgres.CreateCashInFundingIntent(r.Context(), s.db, postgres.CreateCashInFundingIntentInput{ActorType: actorType, ActorID: actorID, AmountMinor: input.AmountMinor, Currency: "YER", ProviderKey: providerKey, IdempotencyKey: idempotency, CorrelationID: correlation})
	if err != nil {
		writeCashInError(w, err)
		return
	}
	if replayed && item.State != "PENDING_PROVIDER" && item.State != "UNKNOWN" {
		writeJSON(w, http.StatusOK, map[string]any{"intent": toCashInFundingIntent(item), "simulator": s.cashInSimulatorEnabled, "idempotentReplay": true})
		return
	}
	if item.ProviderReference != nil {
		item = s.reconcileMockFundingIntent(r, item, actorID, correlation)
		writeJSON(w, http.StatusOK, map[string]any{"intent": toCashInFundingIntent(item), "simulator": s.cashInSimulatorEnabled, "idempotentReplay": replayed})
		return
	}
	result, err := s.cashInRail.CreatePayment(r.Context(), cashin.CreatePaymentRequest{ProviderKey: item.ProviderKey, IntentID: item.ID, ExternalReference: item.ExternalReference, AmountMinor: item.RequestedAmountMinor, Currency: item.Currency})
	if err != nil {
		writeError(w, http.StatusAccepted, "CASH_IN_RESULT_UNKNOWN", "Funding intent exists; the external result must be inquired or reconciled before retry")
		return
	}
	item, err = postgres.AttachCashInProviderReference(r.Context(), s.db, item.ID, result.ProviderReference)
	if err != nil {
		writeCashInError(w, err)
		return
	}
	item = s.reconcileMockFundingIntent(r, item, actorID, correlation)
	status := http.StatusCreated
	if replayed {
		status = http.StatusOK
	}
	writeJSON(w, status, map[string]any{"intent": toCashInFundingIntent(item), "simulator": s.cashInSimulatorEnabled, "idempotentReplay": replayed})
}

// Reconcile only verified terminal results; ambiguous responses never credit wallets.
func (s *Server) reconcileMockFundingIntent(r *http.Request, item postgres.CashInFundingIntentRecord, actorID, correlation string) postgres.CashInFundingIntentRecord {
	if _, mock := s.cashInRail.(*cashin.WireMockRail); !mock || item.ProviderReference == nil || (item.State != "PENDING_PROVIDER" && item.State != "UNKNOWN") {
		return item
	}
	result, err := s.cashInRail.InquirePayment(r.Context(), cashin.PaymentInquiryRequest{ProviderKey: item.ProviderKey, IntentID: item.ID, ProviderReference: *item.ProviderReference})
	if err != nil || (result.Outcome != "SUCCESS" && result.Outcome != "FAILURE") {
		return item
	}
	updated, _, err := postgres.ApplyCashInFundingResult(r.Context(), s.db, postgres.ApplyCashInFundingResultInput{
		FundingIntentID: item.ID, Outcome: result.Outcome, ProviderTransactionReference: result.ProviderTransactionReference,
		ProviderFeeMinor: result.ProviderFeeMinor, ActorID: actorID,
		IdempotencyKey: "cashin_mock_result_" + item.ID, CorrelationID: correlation,
	})
	if err != nil {
		return item
	}
	return updated
}

// Development-only recovery for indeterminate provider replies; actor ownership
// is checked in both DSH and WLT before any canonical ledger mutation.
func (s *Server) reconcileDevelopmentFundingIntent(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	if !isProviderMock(s.cashInRail) {
		writeError(w, http.StatusNotFound, "NOT_FOUND", "Mock provider reconciliation is unavailable")
		return
	}
	actorID := strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID"))
	if actorID == "" || len(actorID) > 128 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "Acting actor is required")
		return
	}
	correlation, _, ok := mutationHeaders(w, r)
	if !ok {
		return
	}
	item, err := postgres.ReadCashInFundingIntent(r.Context(), s.db, strings.TrimSpace(r.PathValue("fundingIntentId")))
	if err != nil {
		writeCashInError(w, err)
		return
	}
	if item.ActorID != actorID || !cashin.ValidMockProviderKey(item.ProviderKey) {
		writeError(w, http.StatusNotFound, "NOT_FOUND", "Funding intent was not found")
		return
	}
	updated := s.reconcileMockFundingIntent(r, item, actorID, correlation)
	writeJSON(w, http.StatusOK, map[string]any{"intent": toCashInFundingIntent(updated), "simulator": true})
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
	if current.ProviderKey != postgres.DevelopmentSimulatorProvider && !cashin.ValidMockProviderKey(current.ProviderKey) {
		writeError(w, http.StatusForbidden, "FORBIDDEN", "only development-simulator funding intents can receive simulated outcomes")
		return
	}
	var result cashin.PaymentInquiryResult
	var providerFee int64
	if _, isWireMock := s.cashInRail.(*cashin.WireMockRail); isWireMock {
		if current.ProviderReference == nil {
			writeError(w, http.StatusAccepted, "CASH_IN_RESULT_UNKNOWN", "Provider reference is not confirmed; reconcile before proceeding")
			return
		}
		// The external mock, never the mobile client's selected outcome, owns the result.
		result, err = s.cashInRail.InquirePayment(r.Context(), cashin.PaymentInquiryRequest{
			ProviderKey: current.ProviderKey, IntentID: intentID, ProviderReference: *current.ProviderReference,
		})
		if err != nil {
			writeError(w, http.StatusAccepted, "CASH_IN_RESULT_UNKNOWN", "Provider inquiry failed; this funding intent remains unresolved")
			return
		}
		providerFee = result.ProviderFeeMinor
		if strings.ToUpper(strings.TrimSpace(input.Outcome)) != result.Outcome {
			writeError(w, http.StatusConflict, "PROVIDER_OUTCOME_MISMATCH", "The selected test result differs from the mock provider's verified response")
			return
		}
	} else {
		simulator, ok := s.cashInRail.(cashInSimulator)
		if !ok {
			writeError(w, http.StatusInternalServerError, "CONFIGURATION_ERROR", "development simulator is not configured")
			return
		}
		result, err = simulator.Simulate(input.Outcome, intentID)
		if err != nil {
			writeCashInError(w, err)
			return
		}
		providerFee = developmentSimulatorCashInProviderFeeMinor(result.Outcome, current.RequestedAmountMinor)
	}
	item, replayed, err := postgres.ApplyCashInFundingResult(r.Context(), s.db, postgres.ApplyCashInFundingResultInput{FundingIntentID: intentID, Outcome: result.Outcome, ProviderTransactionReference: result.ProviderTransactionReference, ProviderFeeMinor: providerFee, ActorID: actingActorID, IdempotencyKey: idempotency, CorrelationID: correlation})
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
	return cashInFundingIntentJSON{ID: item.ID, ActorType: item.ActorType, ActorID: item.ActorID, FundingPurpose: item.FundingPurpose, ProviderKey: item.ProviderKey, ExternalReference: item.ExternalReference, ProviderReference: item.ProviderReference, ProviderTransactionReference: item.ProviderTransactionReference, AmountMinor: item.RequestedAmountMinor, ProviderFeeMinor: item.ProviderFeeMinor, Currency: item.Currency, State: item.State, Version: item.Version, LedgerTransactionID: item.LedgerTransactionID, CreatedAt: item.CreatedAt.UTC().Format(time.RFC3339Nano), UpdatedAt: item.UpdatedAt.UTC().Format(time.RFC3339Nano)}
}

func writeCashInError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, postgres.ErrCustomerWalletBalanceInvariant):
		writeError(w, http.StatusInternalServerError, "WALLET_BALANCE_INVARIANT", "customer balance holds exceed the ledger balance")
	case errors.Is(err, postgres.ErrInvalidInput):
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "Cash-In input is invalid")
	case errors.Is(err, postgres.ErrFundingIntentNotFound):
		writeError(w, http.StatusNotFound, "NOT_FOUND", "Cash-In funding intent was not found")
	case errors.Is(err, postgres.ErrFundingIntentState):
		writeError(w, http.StatusConflict, "STATE_CONFLICT", "Cash-In funding intent cannot accept this result")
	case errors.Is(err, postgres.ErrFundingProviderReferenceUsed):
		writeError(w, http.StatusConflict, "PROVIDER_REFERENCE_CONFLICT", "Cash-In provider transaction is already settled")
	case errors.Is(err, postgres.ErrIdempotencyConflict):
		writeError(w, http.StatusConflict, "IDEMPOTENCY_CONFLICT", "Cash-In idempotency key conflicts with another request")
	case errors.Is(err, cashin.ErrInvalidRequest):
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "simulator outcome is invalid")
	default:
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "Cash-In operation failed")
	}
}

// The development simulator uses a clearly synthetic 2% provider fee. Real
// providers must report their verified actual fee; no production rate is set here.
func developmentSimulatorCashInProviderFeeMinor(outcome string, gross int64) int64 {
	if strings.ToUpper(strings.TrimSpace(outcome)) != "SUCCESS" || gross <= 0 {
		return 0
	}
	return gross / 50
}
