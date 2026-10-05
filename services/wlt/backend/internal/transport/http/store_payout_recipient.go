package http

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/bthwani2-boop/samrim/services/wlt/backend/internal/storage/postgres"
)

type storePayoutRecipientSelectRequest struct {
	PartnerActorID     string                 `json:"partnerActorId"`
	BeneficiaryActorID string                 `json:"beneficiaryActorId"`
	BeneficiaryFacts   postgres.IdentityFacts `json:"beneficiaryFacts"`
	Reason             string                 `json:"reason"`
}

type storePayoutRecipientActionRequest struct {
	PartnerActorID string `json:"partnerActorId"`
	Reason         string `json:"reason"`
}

type storePayoutRecipientAssignmentResponse struct {
	Assignment storePayoutRecipientAssignmentView `json:"assignment"`
	Replayed   bool                               `json:"idempotentReplay"`
}

type storePayoutRecipientAssignmentView struct {
	ID                 string `json:"id"`
	StoreID            string `json:"storeId"`
	PartnerActorID     string `json:"partnerActorId"`
	BeneficiaryActorID string `json:"beneficiaryActorId"`
	State              string `json:"state"`
	Version            int    `json:"version"`
	EffectiveAt        string `json:"effectiveAt"`
	Reason             string `json:"reason"`
}

type storePayoutRecipientReadbackResponse struct {
	PartnerActorID string                            `json:"partnerActorId"`
	Currency       string                            `json:"currency"`
	Recipients     []storePayoutRecipientRecordView  `json:"recipients"`
	ReviewStores   []string                          `json:"reviewStores"`
}

type storePayoutRecipientRecordView struct {
	StoreID            string `json:"storeId"`
	State              string `json:"state"`
	BeneficiaryActorID string `json:"beneficiaryActorId"`
	Version            int    `json:"version"`
	EffectiveAt        string `json:"effectiveAt,omitempty"`
	OrderCount         int64  `json:"orderCount"`
	PartnerNetMinor    int64  `json:"partnerNetMinor"`
	LastEarningAt      string `json:"lastEarningAt,omitempty"`
}

func (s *Server) readPartnerStorePayoutRecipients(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	result, err := postgres.ListPartnerStorePayoutRecipients(r.Context(), s.db, r.PathValue("partnerActorId"))
	if err != nil {
		writeStorePayoutRecipientError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, toStorePayoutRecipientReadback(result))
}

func (s *Server) selectStorePayoutRecipient(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	correlation, idempotency, ok := mutationHeaders(w, r)
	if !ok {
		return
	}
	var input storePayoutRecipientSelectRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	result, replayed, err := postgres.SelectStorePayoutRecipient(r.Context(), s.db, s.destinationEncryptionKey, postgres.SelectStorePayoutRecipientInput{
		StoreID:            r.PathValue("storeId"),
		PartnerActorID:     input.PartnerActorID,
		BeneficiaryActorID: input.BeneficiaryActorID,
		BeneficiaryFacts:   input.BeneficiaryFacts,
		Reason:             input.Reason,
		IdempotencyKey:     idempotency,
		CorrelationID:      correlation,
	})
	if err != nil {
		writeStorePayoutRecipientError(w, err)
		return
	}
	status := http.StatusCreated
	if replayed {
		status = http.StatusOK
	}
	writeJSON(w, status, storePayoutRecipientAssignmentResponse{Assignment: toStorePayoutRecipientAssignment(result), Replayed: replayed})
}

func (s *Server) revertStorePayoutRecipient(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	correlation, idempotency, ok := mutationHeaders(w, r)
	if !ok {
		return
	}
	var input storePayoutRecipientActionRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	reverted, err := postgres.RevertStorePayoutRecipientToOwner(r.Context(), s.db, postgres.RevertStorePayoutRecipientInput{
		StoreID:        r.PathValue("storeId"),
		PartnerActorID: input.PartnerActorID,
		Reason:         input.Reason,
		IdempotencyKey: idempotency,
		CorrelationID:  correlation,
	})
	if err != nil {
		writeStorePayoutRecipientError(w, err)
		return
	}
	status := http.StatusOK
	if reverted {
		writeJSON(w, status, map[string]any{"state": "DEFAULT_OWNER", "idempotentReplay": true})
		return
	}
	writeJSON(w, status, map[string]any{"state": "DEFAULT_OWNER", "idempotentReplay": false})
}

func (s *Server) markStorePayoutRecipientReviewRequired(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	correlation, _, ok := mutationHeadersForSystemAction(w, r)
	if !ok {
		return
	}
	var input storePayoutRecipientActionRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	marked, err := postgres.MarkStorePayoutRecipientReviewRequired(r.Context(), s.db, r.PathValue("storeId"), input.PartnerActorID, input.Reason, correlation)
	if err != nil {
		writeStorePayoutRecipientError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"state": "RECIPIENT_REVIEW_REQUIRED", "applied": !marked})
}

func (s *Server) readStorePayoutRecipientByStore(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	// Single-store readback derives from the partner readback; the partner actor is
	// resolved from the assignment facts owned by WLT.
	partnerActorID := strings.TrimSpace(r.URL.Query().Get("partnerActorId"))
	if partnerActorID == "" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "partnerActorId is required")
		return
	}
	result, err := postgres.ListPartnerStorePayoutRecipients(r.Context(), s.db, partnerActorID)
	if err != nil {
		writeStorePayoutRecipientError(w, err)
		return
	}
	storeID := strings.TrimSpace(r.PathValue("storeId"))
	for _, record := range result.Recipients {
		if record.StoreID == storeID {
			writeJSON(w, http.StatusOK, storePayoutRecipientRecordView{
				StoreID:            record.StoreID,
				State:              record.State,
				BeneficiaryActorID: record.BeneficiaryActorID,
				Version:            record.Version,
				OrderCount:         record.OrderCount,
				PartnerNetMinor:    record.PartnerNetMinor,
			})
			return
		}
	}
	writeError(w, http.StatusNotFound, "NOT_FOUND", "no payout recipient facts exist for this store")
}

func (s *Server) registerStorePayoutRecipientRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /wlt/v1/partners/{partnerActorId}/store-payout-recipients", s.readPartnerStorePayoutRecipients)
	mux.HandleFunc("GET /wlt/v1/partners/{partnerActorId}/store-payout-recipients/{storeId}", s.readStorePayoutRecipientByStore)
	mux.HandleFunc("PUT /wlt/v1/store-payout-recipients/{storeId}", s.selectStorePayoutRecipient)
	mux.HandleFunc("POST /wlt/v1/store-payout-recipients/{storeId}/revert", s.revertStorePayoutRecipient)
	mux.HandleFunc("POST /wlt/v1/store-payout-recipients/{storeId}/review-required", s.markStorePayoutRecipientReviewRequired)
}

func mutationHeadersForSystemAction(w http.ResponseWriter, r *http.Request) (string, string, bool) {
	correlation := strings.TrimSpace(r.Header.Get("X-Correlation-ID"))
	idempotency := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	if idempotency == "" {
		idempotency = "WLT_SYSTEM_FAIL_CLOSED"
	}
	if len(correlation) < 8 || len(correlation) > 128 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "X-Correlation-ID is required")
		return "", "", false
	}
	return correlation, idempotency, true
}

func formatStoreRecipientTime(value time.Time) string {
	return value.UTC().Format(time.RFC3339Nano)
}

func toStorePayoutRecipientAssignment(record postgres.StorePayoutRecipientAssignmentRecord) storePayoutRecipientAssignmentView {
	return storePayoutRecipientAssignmentView{
		ID:                 record.ID,
		StoreID:            record.StoreID,
		PartnerActorID:     record.PartnerActorID,
		BeneficiaryActorID: record.BeneficiaryActorID,
		State:              record.State,
		Version:            record.Version,
		EffectiveAt:        formatStoreRecipientTime(record.EffectiveAt),
		Reason:             record.Reason,
	}
}

func toStorePayoutRecipientReadback(result postgres.StorePayoutRecipientReadback) storePayoutRecipientReadbackResponse {
	response := storePayoutRecipientReadbackResponse{PartnerActorID: result.PartnerActorID, Currency: result.Currency, Recipients: make([]storePayoutRecipientRecordView, 0, len(result.Recipients)), ReviewStores: result.ReviewStores}
	for _, record := range result.Recipients {
		view := storePayoutRecipientRecordView{
			StoreID:            record.StoreID,
			State:              record.State,
			BeneficiaryActorID: record.BeneficiaryActorID,
			Version:            record.Version,
			OrderCount:         record.OrderCount,
			PartnerNetMinor:    record.PartnerNetMinor,
		}
		if record.EffectiveAt != nil {
			view.EffectiveAt = formatStoreRecipientTime(*record.EffectiveAt)
		}
		if record.LastEarningAt != nil {
			view.LastEarningAt = formatStoreRecipientTime(*record.LastEarningAt)
		}
		response.Recipients = append(response.Recipients, view)
	}
	return response
}

func writeStorePayoutRecipientError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, postgres.ErrStorePayoutRecipientInvalidInput):
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "store payout recipient input is invalid")
	case errors.Is(err, postgres.ErrStorePayoutRecipientNotFound):
		writeError(w, http.StatusNotFound, "NOT_FOUND", "store payout recipient assignment was not found")
	case errors.Is(err, postgres.ErrStorePayoutRecipientOwnership):
		writeError(w, http.StatusForbidden, "FORBIDDEN", "only the store owner may change the payout recipient")
	case errors.Is(err, postgres.ErrRecipientDestinationNotReady):
		writeError(w, http.StatusConflict, "RECIPIENT_DESTINATION_NOT_READY", "the selected beneficiary has no Finance-approved verified active official wallet destination")
	case errors.Is(err, postgres.ErrStorePayoutRecipientConflict):
		writeError(w, http.StatusConflict, "STATE_CONFLICT", "store payout recipient assignment state does not allow this operation")
	case errors.Is(err, postgres.ErrPayoutRecipientReviewRequired):
		writeError(w, http.StatusConflict, "RECIPIENT_REVIEW_REQUIRED", "payout recipient review is required before future payouts")
	case errors.Is(err, postgres.ErrPayoutRecipientRoutingPending):
		writeError(w, http.StatusConflict, "RECIPIENT_ROUTING_PENDING", "per-store payout routing is selected; aggregated transfer is not permitted")
	case errors.Is(err, postgres.ErrReverificationRequired):
		writeError(w, http.StatusConflict, "REVERIFICATION_REQUIRED", "current verified Identity facts do not match the active wallet destination")
	case errors.Is(err, postgres.ErrIdempotencyConflict):
		writeError(w, http.StatusConflict, "IDEMPOTENCY_CONFLICT", "Idempotency-Key was already used with different facts")
	default:
		writeError(w, http.StatusBadGateway, "WLT_STORE_RECIPIENT_UNAVAILABLE", "store payout recipient mutation failed")
	}
}
