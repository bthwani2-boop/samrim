package http

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/bthwani2-boop/samrim/services/wlt/backend/internal/storage/postgres"
)

type captainOpeningFundingRequest struct {
	AmountMinor       int64  `json:"amountMinor"`
	FundingReason     string `json:"fundingReason"`
	EvidenceReference string `json:"evidenceReference"`
}

type captainCODReservationRequest struct {
	OrderID         string `json:"orderId"`
	PaymentIntentID string `json:"paymentIntentId"`
	CaptainActorID  string `json:"captainActorId"`
}

type captainWalletFundingJSON struct {
	ID                  string `json:"id"`
	CaptainActorID      string `json:"captainActorId"`
	AmountMinor         int64  `json:"amountMinor"`
	Currency            string `json:"currency"`
	FundingReason       string `json:"fundingReason"`
	EvidenceReference   string `json:"evidenceReference"`
	CreatedBy           string `json:"createdBy"`
	LedgerTransactionID string `json:"ledgerTransactionId"`
	CreatedAt           string `json:"createdAt"`
}

type captainWalletStateJSON struct {
	CaptainActorID     string `json:"captainActorId"`
	Currency           string `json:"currency"`
	LedgerBalanceMinor int64  `json:"ledgerBalanceMinor"`
	HeldMinor          int64  `json:"heldMinor"`
	AvailableMinor     int64  `json:"availableMinor"`
}

type captainCODReservationJSON struct {
	ID                  string  `json:"id"`
	OrderID             string  `json:"orderId"`
	PaymentIntentID     string  `json:"paymentIntentId"`
	CaptainActorID      string  `json:"captainActorId"`
	AmountMinor         int64   `json:"amountMinor"`
	Currency            string  `json:"currency"`
	State       string  `json:"state"`
	CreatedAt   string  `json:"createdAt"`
	UpdatedAt   string  `json:"updatedAt"`
	ReleasedAt  *string `json:"releasedAt,omitempty"`
	FinalizedAt *string `json:"finalizedAt,omitempty"`
	RemittedAt  *string `json:"remittedAt,omitempty"`
}

type captainWalletFundingResponse struct {
	Funding          captainWalletFundingJSON `json:"funding"`
	IdempotentReplay bool                     `json:"idempotentReplay"`
}

type captainWalletStateResponse struct {
	State captainWalletStateJSON `json:"state"`
}

type captainCODReservationResponse struct {
	Reservation      captainCODReservationJSON `json:"reservation"`
	IdempotentReplay bool                      `json:"idempotentReplay"`
}

func (s *Server) createCaptainOpeningFunding(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	actorID, correlation, idempotency, ok := operatorMutationHeaders(w, r)
	if !ok {
		return
	}
	var input captainOpeningFundingRequest
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "request body is invalid")
		return
	}
	funding, replay, err := postgres.CreateCaptainWalletFunding(r.Context(), s.db, postgres.CaptainWalletFundingInput{
		CaptainActorID: r.PathValue("captainActorId"), AmountMinor: input.AmountMinor, FundingReason: input.FundingReason,
		EvidenceReference: input.EvidenceReference, CreatedBy: actorID, IdempotencyKey: idempotency, CorrelationID: correlation,
	})
	if err != nil {
		writeCaptainWalletError(w, err)
		return
	}
	status := http.StatusCreated
	if replay {
		status = http.StatusOK
	}
	writeJSON(w, status, captainWalletFundingResponse{Funding: toCaptainWalletFunding(funding), IdempotentReplay: replay})
}

func (s *Server) captainWalletState(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	state, err := postgres.ReadCaptainWalletState(r.Context(), s.db, r.PathValue("captainActorId"))
	if err != nil {
		writeCaptainWalletError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, captainWalletStateResponse{State: captainWalletStateJSON{CaptainActorID: state.CaptainActorID, Currency: state.Currency, LedgerBalanceMinor: state.LedgerBalanceMinor, HeldMinor: state.HeldMinor, AvailableMinor: state.AvailableMinor}})
}

func (s *Server) reserveCaptainCOD(w http.ResponseWriter, r *http.Request) {
	s.transitionCaptainCOD(w, r, "reserve")
}

func (s *Server) releaseCaptainCOD(w http.ResponseWriter, r *http.Request) {
	s.transitionCaptainCOD(w, r, "release")
}

func (s *Server) finalizeCaptainCOD(w http.ResponseWriter, r *http.Request) {
	s.transitionCaptainCOD(w, r, "finalize")
}

func (s *Server) transitionCaptainCOD(w http.ResponseWriter, r *http.Request, operation string) {
	if !s.authorize(w, r) {
		return
	}
	correlation, idempotency, ok := mutationHeaders(w, r)
	if !ok {
		return
	}
	input := postgres.CaptainCODReservationInput{OrderID: r.PathValue("orderId"), IdempotencyKey: idempotency, CorrelationID: correlation}
	if operation == "reserve" {
		var body captainCODReservationRequest
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeError(w, http.StatusBadRequest, "INVALID_INPUT", "request body is invalid")
			return
		}
		input.OrderID = body.OrderID
		input.PaymentIntentID = body.PaymentIntentID
		input.CaptainActorID = body.CaptainActorID
	} else {
		var body captainCODReservationRequest
		if r.Body != nil {
			_ = json.NewDecoder(r.Body).Decode(&body)
		}
		input.PaymentIntentID = body.PaymentIntentID
		input.CaptainActorID = body.CaptainActorID
	}
	var reservation postgres.CaptainCODReservationRecord
	var replay bool
	var err error
	switch operation {
	case "reserve":
		reservation, replay, err = postgres.ReserveCaptainCOD(r.Context(), s.db, input)
	case "release":
		reservation, replay, err = postgres.ReleaseCaptainCOD(r.Context(), s.db, input)
	case "finalize":
		reservation, replay, err = postgres.FinalizeCaptainCOD(r.Context(), s.db, input)
	}
	if err != nil {
		writeCaptainWalletError(w, err)
		return
	}
	status := http.StatusOK
	if !replay && operation == "reserve" {
		status = http.StatusCreated
	}
	writeJSON(w, status, captainCODReservationResponse{Reservation: toCaptainCODReservation(reservation), IdempotentReplay: replay})
}

func toCaptainWalletFunding(item postgres.CaptainWalletFundingRecord) captainWalletFundingJSON {
	return captainWalletFundingJSON{ID: item.ID, CaptainActorID: item.CaptainActorID, AmountMinor: item.AmountMinor, Currency: item.Currency, FundingReason: item.FundingReason, EvidenceReference: item.EvidenceReference, CreatedBy: item.CreatedBy, LedgerTransactionID: item.LedgerTransactionID, CreatedAt: item.CreatedAt.UTC().Format("2006-01-02T15:04:05.999999999Z07:00")}
}

func toCaptainCODReservation(item postgres.CaptainCODReservationRecord) captainCODReservationJSON {
	return captainCODReservationJSON{ID: item.ID, OrderID: item.OrderID, PaymentIntentID: item.PaymentIntentID, CaptainActorID: item.CaptainActorID, AmountMinor: item.AmountMinor, Currency: item.Currency, State: item.State, CreatedAt: item.CreatedAt.UTC().Format("2006-01-02T15:04:05.999999999Z07:00"), UpdatedAt: item.UpdatedAt.UTC().Format("2006-01-02T15:04:05.999999999Z07:00"), ReleasedAt: formatNullableTime(item.ReleasedAt), FinalizedAt: formatNullableTime(item.FinalizedAt), RemittedAt: formatNullableTime(item.RemittedAt)}
}

func writeCaptainWalletError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, postgres.ErrCaptainWalletInvalidInput), errors.Is(err, postgres.ErrCaptainCODReservationInput):
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "captain wallet input is invalid")
	case errors.Is(err, postgres.ErrCaptainWalletInsufficientFunds):
		writeError(w, http.StatusConflict, "INSUFFICIENT_FUNDS", "captain wallet does not cover the order COD exposure")
	case errors.Is(err, postgres.ErrCaptainCODAllocationNotFound), errors.Is(err, postgres.ErrCaptainCODNoCashExposure):
		writeError(w, http.StatusConflict, "COD_EXPOSURE_UNAVAILABLE", "the order has no usable cash COD exposure")
	case errors.Is(err, postgres.ErrCaptainWalletFundingNotFound), errors.Is(err, postgres.ErrCaptainCODReservationNotFound):
		writeError(w, http.StatusNotFound, "NOT_FOUND", "the requested captain financial record was not found")
	case errors.Is(err, postgres.ErrCaptainCODReservationState), errors.Is(err, postgres.ErrIdempotencyConflict):
		writeError(w, http.StatusConflict, "STATE_CONFLICT", "the captain financial state does not allow this operation")
	default:
		writeError(w, http.StatusBadGateway, "WLT_STORAGE_UNAVAILABLE", "WLT persistence is unavailable")
	}
}
