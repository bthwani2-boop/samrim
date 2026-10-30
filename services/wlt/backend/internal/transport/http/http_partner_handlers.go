package http

import (
	"errors"
	"log"
	"net/http"
	"strings"

	"github.com/bthwani2-boop/samrim/services/wlt/backend/internal/storage/postgres"
)

func (s *Server) preparePartnerFinancialProfile(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	correlation, idempotency, ok := mutationHeaders(w, r)
	if !ok {
		return
	}
	var input preparePartnerFinancialProfileRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	result, replayed, err := postgres.PreparePartnerFinancialProfile(r.Context(), s.db, postgres.PreparePartnerFinancialProfileInput{
		JoiningCaseID:      input.JoiningCaseID,
		PartnerActorID:     input.PartnerActorID,
		Origin:             input.Origin,
		SettlementPeriod:   input.SettlementPeriod,
		TermsPolicyVersion: input.TermsPolicyVersion,
		IdempotencyKey:     idempotency,
		CorrelationID:      correlation,
	})
	if err != nil {
		writeFinancialProfileError(w, err)
		return
	}
	status := http.StatusCreated
	if replayed {
		status = http.StatusOK
	}
	writeJSON(w, status, partnerFinancialProfileResponse{Profile: toPartnerFinancialProfile(result), IdempotentReplay: replayed})
}

func (s *Server) readPartnerFinancialProfile(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	result, err := postgres.ReadPartnerFinancialProfile(r.Context(), s.db, r.PathValue("profileId"))
	if err != nil {
		writeFinancialProfileError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, partnerFinancialProfileResponse{Profile: toPartnerFinancialProfile(result)})
}

func (s *Server) activatePartnerFinancialProfile(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	correlation, idempotency, expected, ok := versionedMutationHeaders(w, r)
	if !ok {
		return
	}
	var input activatePartnerFinancialProfileRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	result, replayed, err := postgres.ActivatePartnerFinancialProfile(r.Context(), s.db, postgres.ActivatePartnerFinancialProfileInput{
		ProfileID:       r.PathValue("profileId"),
		ExpectedVersion: expected,
		IdempotencyKey:  idempotency,
		CorrelationID:   correlation,
		ActorID:         strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID")),
	})
	if err != nil {
		writeFinancialProfileError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, partnerFinancialProfileResponse{Profile: toPartnerFinancialProfile(result), IdempotentReplay: replayed})
}

func (s *Server) readStoreTypeCommissionDefaults(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	typeID := strings.TrimSpace(r.URL.Query().Get("commercialStoreTypeId"))
	if typeID == "" || len(typeID) > 128 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "commercialStoreTypeId is required")
		return
	}
	defaults, err := postgres.ReadStoreTypeCommissionDefaults(r.Context(), s.db, typeID)
	if err != nil {
		writeStoreTypeCommissionDefaultError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"commercialStoreTypeId": typeID, "defaults": defaults})
}

func (s *Server) updateStoreTypeCommissionDefault(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	correlation, idempotency, ok := mutationHeaders(w, r)
	if !ok {
		return
	}
	actingActorID := strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID"))
	if actingActorID == "" || len(actingActorID) > 128 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "X-Acting-Actor-ID is required")
		return
	}
	var input updateStoreTypeCommissionDefaultRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	storeTypeDefault, replayed, err := postgres.UpdateStoreTypeCommissionDefault(r.Context(), s.db, postgres.StoreTypeCommissionDefaultUpdate{
		CommercialStoreTypeID: input.CommercialStoreTypeID, FulfillmentMode: input.FulfillmentMode, CommissionRateBps: input.CommissionRateBps,
		ExpectedVersion: input.ExpectedVersion, ChangedByActorID: actingActorID, Reason: input.Reason,
		IdempotencyKey: idempotency, CorrelationID: correlation,
	})
	if err != nil {
		writeStoreTypeCommissionDefaultError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"default": storeTypeDefault, "idempotentReplay": replayed})
}

func writeStoreTypeCommissionDefaultError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, postgres.ErrStoreTypeCommissionDefaultUnavailable):
		writeError(w, http.StatusNotFound, "COMMISSION_DEFAULT_NOT_FOUND", "commission defaults are not initialized for this Store Type")
	case errors.Is(err, postgres.ErrStoreTypeCommissionDefaultVersionConflict):
		writeError(w, http.StatusConflict, "VERSION_CONFLICT", "commission default changed; reload before saving")
	case errors.Is(err, postgres.ErrIdempotencyConflict):
		writeError(w, http.StatusConflict, "IDEMPOTENCY_CONFLICT", "Idempotency-Key was already used with different commission default facts")
	case errors.Is(err, postgres.ErrStoreTypeCommissionDefaultInvalidInput):
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "commission default fields are invalid")
	default:
		log.Printf("WLT commercial Store Type commission default persistence error: %T %v", err, err)
		writeError(w, http.StatusBadGateway, "WLT_STORAGE_UNAVAILABLE", "WLT commission default persistence is unavailable")
	}
}

func (s *Server) finalizePartnerOrderEarning(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	correlation, idempotency, ok := mutationHeaders(w, r)
	if !ok {
		return
	}
	var input finalizePartnerOrderEarningRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	result, replayed, err := postgres.FinalizePartnerOrderEarning(r.Context(), s.db, postgres.FinalizePartnerOrderEarningInput{OrderID: input.OrderID, PaymentIntentID: input.PaymentIntentID, PartnerActorID: input.PartnerActorID, CaptainActorID: input.CaptainActorID, IdempotencyKey: idempotency, CorrelationID: correlation})
	if err != nil {
		writePartnerEarningError(w, err)
		return
	}
	status := http.StatusCreated
	if replayed {
		status = http.StatusOK
	}
	writeJSON(w, status, partnerOrderEarningResponse{Earning: toPartnerOrderEarning(result), IdempotentReplay: replayed})
}

func (s *Server) finalizePartnerStoreCashCommission(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	correlation, idempotency, ok := mutationHeaders(w, r)
	if !ok {
		return
	}
	var input finalizePartnerStoreCashCommissionRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	result, replayed, err := postgres.RecordPartnerStoreCashCommission(r.Context(), s.db, postgres.PartnerStoreCashCommissionInput{OrderID: input.OrderID, PaymentIntentID: input.PaymentIntentID, PartnerActorID: input.PartnerActorID, FulfillmentMode: input.FulfillmentMode, IdempotencyKey: idempotency, CorrelationID: correlation})
	if err != nil {
		writePartnerCashCommissionError(w, err)
		return
	}
	status := http.StatusCreated
	if replayed {
		status = http.StatusOK
	}
	writeJSON(w, status, partnerStoreCashCommissionResponse{Commission: toPartnerStoreCashCommission(result), IdempotentReplay: replayed})
}

func (s *Server) recordPartnerCommissionRemittance(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	correlation, idempotency, ok := mutationHeaders(w, r)
	if !ok {
		return
	}
	acting := strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID"))
	if acting == "" || len(acting) > 128 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "X-Acting-Actor-ID is required")
		return
	}
	var input partnerCommissionRemittanceRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	result, replayed, err := postgres.RecordPartnerCommissionRemittance(r.Context(), s.db, postgres.PartnerCommissionRemittanceInput{PartnerActorID: r.PathValue("partnerActorId"), AmountMinor: input.AmountMinor, RemittanceReference: input.RemittanceReference, EvidenceDocumentID: input.EvidenceDocumentID, VerifiedBy: acting, IdempotencyKey: idempotency, CorrelationID: correlation})
	if err != nil {
		writePartnerCashCommissionError(w, err)
		return
	}
	status := http.StatusCreated
	if replayed {
		status = http.StatusOK
	}
	writeJSON(w, status, partnerCommissionRemittanceResponse{Remittance: toPartnerCommissionRemittance(result), IdempotentReplay: replayed})
}

func (s *Server) readPartnerFinancialSummary(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	result, err := postgres.ReadPartnerFinancialSummaryForStores(r.Context(), s.db, r.PathValue("partnerActorId"), r.URL.Query()["storeId"])
	if err != nil {
		writePartnerEarningError(w, err)
		return
	}
	view := toPartnerFinancialSummary(result)
	view.Stores = result.Stores
	writeJSON(w, http.StatusOK, partnerFinancialSummaryResponse{Summary: view})
}
