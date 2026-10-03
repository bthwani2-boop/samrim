package transporthttp

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/contract"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

func (s *OrderServer) proposePartnerOrderAdjustment(w http.ResponseWriter, r *http.Request) {
	if bearerToken(r) == "" {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "partner session is required")
		return
	}
	correlationID := strings.TrimSpace(r.Header.Get("X-Correlation-ID"))
	idempotencyKey := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	expectedOrderVersion, err := strconv.Atoi(strings.TrimSpace(r.Header.Get("X-Expected-Version")))
	if len(correlationID) < 8 || len(correlationID) > 128 || len(idempotencyKey) < 8 || len(idempotencyKey) > 128 || err != nil || expectedOrderVersion < 1 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "proposal attribution, idempotency, and a positive X-Expected-Version are required")
		return
	}
	if r.Header.Get("X-Actor-ID") != "" || r.Header.Get("X-Acting-Actor-ID") != "" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "proposal ownership comes from the canonical partner session")
		return
	}
	var input contract.OrderAdjustmentProposalRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	var actualQuantity *int64
	if input.ActualQuantityBaseUnits > 0 {
		value := int64(input.ActualQuantityBaseUnits)
		actualQuantity = &value
	}
	order, _, replayed, err := s.service.ProposeOrderAdjustmentForPartner(r.Context(), bearerToken(r), r.PathValue("storeId"), postgres.ProposeOrderAdjustmentInput{
		OrderID: r.PathValue("orderId"), OrderLineID: input.OrderLineID, Kind: input.Kind,
		ActualQuantityBaseUnits: actualQuantity, ExpectedOrderVersion: expectedOrderVersion,
		IdempotencyKey: idempotencyKey, CorrelationID: correlationID,
	})
	if err != nil {
		writeOrderError(w, err)
		return
	}
	status := http.StatusCreated
	if replayed {
		status = http.StatusOK
	}
	writeJSON(w, status, contract.OrderResponse{Order: toOrder(order), IdempotentReplay: replayed})
}

func (s *OrderServer) decideClientOrderAdjustment(w http.ResponseWriter, r *http.Request) {
	if bearerToken(r) == "" {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "client session is required")
		return
	}
	correlationID := strings.TrimSpace(r.Header.Get("X-Correlation-ID"))
	idempotencyKey := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	expectedOrderVersion, err := strconv.Atoi(strings.TrimSpace(r.Header.Get("X-Expected-Version")))
	if len(correlationID) < 8 || len(correlationID) > 128 || len(idempotencyKey) < 8 || len(idempotencyKey) > 128 || err != nil || expectedOrderVersion < 1 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "decision attribution, idempotency, and a positive X-Expected-Version are required")
		return
	}
	if r.Header.Get("X-Actor-ID") != "" || r.Header.Get("X-Acting-Actor-ID") != "" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "decision ownership comes from the canonical client session")
		return
	}
	var input contract.OrderAdjustmentDecisionRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	order, _, replayed, err := s.service.DecideOrderAdjustmentForClient(r.Context(), bearerToken(r), r.PathValue("orderId"), r.PathValue("adjustmentId"), input.Decision, expectedOrderVersion, input.ExpectedAdjustmentVersion, idempotencyKey, correlationID)
	if err != nil {
		writeOrderError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, contract.OrderResponse{Order: toOrder(order), IdempotentReplay: replayed})
}
