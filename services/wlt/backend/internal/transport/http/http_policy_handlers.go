package http

import (
	"errors"
	"log"
	"net/http"
	"strings"

	"github.com/bthwani2-boop/samrim/services/wlt/backend/internal/storage/postgres"
)

func (s *Server) deliveryQuote(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	var input deliveryFeeQuoteRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	quote, err := postgres.ResolveDeliveryFeeQuote(r.Context(), s.db, postgres.DeliveryFeeQuoteInput{StoreID: input.StoreID, FulfillmentMode: input.FulfillmentMode, ServiceCityID: input.ServiceCityID, OriginLatitude: input.OriginLatitude, OriginLongitude: input.OriginLongitude, DestinationLatitude: input.DestinationLatitude, DestinationLongitude: input.DestinationLongitude, OrderSizeBaseUnits: input.OrderSizeBaseUnits})
	if err != nil {
		writeDeliveryFeeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, deliveryFeeQuoteResponse{Quote: toDeliveryFeeQuote(quote)})
}

func (s *Server) readDeliveryFeePolicy(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	policy, err := postgres.ReadDeliveryFeePolicy(r.Context(), s.db, r.URL.Query().Get("serviceCityId"))
	if err != nil {
		writeDeliveryFeeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, deliveryFeePolicyResponse{Policy: toDeliveryFeePolicy(policy)})
}

func (s *Server) createDeliveryFeePolicy(w http.ResponseWriter, r *http.Request) {
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
	var input createDeliveryFeePolicyRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	policy, replayed, err := postgres.CreateDeliveryFeePolicy(r.Context(), s.db, postgres.CreateDeliveryFeePolicyInput{ServiceCityID: input.ServiceCityID, BaseFeeMinor: input.BaseFeeMinor, DistanceUnitMeters: input.DistanceUnitMeters, DistanceRateMinor: input.DistanceRateMinor, OrderSizeUnitBaseUnits: input.OrderSizeUnitBaseUnits, OrderSizeRateMinor: input.OrderSizeRateMinor, ZoneSurchargeMinor: input.ZoneSurchargeMinor, RoundingUnitMinor: input.RoundingUnitMinor, ExpectedVersion: input.ExpectedVersion, Reason: input.Reason, ActingActorID: acting, IdempotencyKey: idempotency, CorrelationID: correlation})
	if err != nil {
		writeDeliveryFeeError(w, err)
		return
	}
	status := http.StatusCreated
	if replayed {
		status = http.StatusOK
	}
	writeJSON(w, status, deliveryFeePolicyResponse{Policy: toDeliveryFeePolicy(policy), IdempotentReplay: replayed})
}

func (s *Server) readPartnerFinancialTermsPolicy(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	policy, err := postgres.ReadPartnerFinancialTermsPolicy(r.Context(), s.db)
	if err != nil {
		writePartnerFinancialTermsPolicyError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, partnerFinancialTermsPolicyResponse{Policy: toPartnerFinancialTermsPolicy(policy)})
}

func (s *Server) createPartnerFinancialTermsPolicy(w http.ResponseWriter, r *http.Request) {
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
	var input createPartnerFinancialTermsPolicyRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	policy, replayed, err := postgres.CreatePartnerFinancialTermsPolicy(r.Context(), s.db, postgres.CreatePartnerFinancialTermsPolicyInput{SettlementPeriod: input.SettlementPeriod, ExpectedVersion: input.ExpectedVersion, Reason: input.Reason, ActingActorID: acting, IdempotencyKey: idempotency, CorrelationID: correlation})
	if err != nil {
		writePartnerFinancialTermsPolicyError(w, err)
		return
	}
	status := http.StatusCreated
	if replayed {
		status = http.StatusOK
	}
	writeJSON(w, status, partnerFinancialTermsPolicyResponse{Policy: toPartnerFinancialTermsPolicy(policy), IdempotentReplay: replayed})
}

func toPartnerFinancialTermsPolicy(item postgres.PartnerFinancialTermsPolicyRecord) partnerFinancialTermsPolicyJSON {
	result := partnerFinancialTermsPolicyJSON{ID: item.ID, PolicyVersion: item.PolicyVersion, State: item.State, SettlementPeriod: item.SettlementPeriod, Version: item.Version, CreatedBy: item.CreatedBy, CreatedAt: item.CreatedAt.UTC().Format("2006-01-02T15:04:05.999Z07:00")}
	if item.RetiredAt != nil {
		value := item.RetiredAt.UTC().Format("2006-01-02T15:04:05.999Z07:00")
		result.RetiredAt = &value
	}
	return result
}

func writePartnerFinancialTermsPolicyError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, postgres.ErrPartnerFinancialTermsPolicyNotFound):
		writeError(w, http.StatusNotFound, "PARTNER_FINANCIAL_TERMS_POLICY_NOT_FOUND", "no active partner financial terms policy is configured")
	case errors.Is(err, postgres.ErrIdempotencyConflict):
		writeError(w, http.StatusConflict, "IDEMPOTENCY_CONFLICT", "Idempotency-Key was already used with different partner financial terms")
	case errors.Is(err, postgres.ErrVersionConflict):
		writeError(w, http.StatusConflict, "VERSION_CONFLICT", "the active partner financial terms policy changed after it was read")
	case errors.Is(err, postgres.ErrPartnerFinancialTermsPolicyInvalidInput):
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "partner financial terms policy is invalid")
	default:
		log.Printf("WLT partner financial terms policy persistence error: %T %v", err, err)
		writeError(w, http.StatusBadGateway, "WLT_STORAGE_UNAVAILABLE", "WLT persistence is unavailable")
	}
}
