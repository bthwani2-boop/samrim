package http

import (
	"net/http"
	"strings"

	"github.com/bthwani2-boop/samrim/services/wlt/backend/internal/storage/postgres"
)

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
	var allocation *postgres.CustomerPaymentAllocationInput
	if input.CustomerPaymentAllocation != nil {
		value := postgres.CustomerPaymentAllocationInput{OrderID: input.CustomerPaymentAllocation.OrderID, StoreID: input.CustomerPaymentAllocation.StoreID, PartnerActorID: input.CustomerPaymentAllocation.PartnerActorID, CommercialStoreTypeID: input.CustomerPaymentAllocation.CommercialStoreTypeID, FulfillmentMode: input.CustomerPaymentAllocation.FulfillmentMode, Currency: input.CustomerPaymentAllocation.Currency, SubtotalMinor: input.CustomerPaymentAllocation.SubtotalMinor, DeliveryFeeMinor: input.CustomerPaymentAllocation.DeliveryFeeMinor, DeliveryMarginMinor: input.CustomerPaymentAllocation.DeliveryMarginMinor, DiscountMinor: input.CustomerPaymentAllocation.DiscountMinor, InternalBalanceAmountMinor: input.CustomerPaymentAllocation.InternalBalanceAmountMinor, CashAmountMinor: input.CustomerPaymentAllocation.CashAmountMinor, CustomerPayableMinor: input.CustomerPaymentAllocation.CustomerPayableMinor, PolicyVersion: input.CustomerPaymentAllocation.PolicyVersion}
		if input.CustomerPaymentAllocation.PromotionFunding != nil && input.CustomerPaymentAllocation.PromotionFunding.PromotionID != "" {
			funding := input.CustomerPaymentAllocation.PromotionFunding
			value.PromotionFunding = &postgres.PromotionFundingInput{PromotionID: funding.PromotionID, PromotionVersion: funding.PromotionVersion, PromotionCode: funding.PromotionCode, StoreID: input.CustomerPaymentAllocation.StoreID, FundingSource: funding.FundingSource, PartnerSharePercent: funding.PartnerSharePercent, DiscountMinor: input.CustomerPaymentAllocation.DiscountMinor}
		}
		allocation = &value
	}
	result, replayed, err := postgres.CreatePaymentIntent(r.Context(), s.db, postgres.CreatePaymentIntentInput{ExternalReference: input.ExternalReference, PayerActorID: input.PayerActorID, OrderID: input.OrderID, AmountMinor: input.AmountMinor, Currency: input.Currency, Method: input.Method, CustomerPaymentAllocation: allocation, IdempotencyKey: idempotency, CorrelationID: correlation})
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

func (s *Server) readByExternalReference(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	externalReference := strings.TrimSpace(r.URL.Query().Get("externalReference"))
	if externalReference == "" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "externalReference is required")
		return
	}
	result, err := postgres.ReadPaymentIntentByExternalReference(r.Context(), s.db, externalReference)
	if err != nil {
		writePaymentError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, paymentIntentResponse{PaymentIntent: toPaymentIntent(result)})
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
