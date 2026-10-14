package transporthttp

import (
	"net/http"
	"strings"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

// One rare Finance action, no customer ticket or arbitrary amount input.
// The immutable DSH Order line is the amount authority for the supported
// full item removal with no promotion; other cases stay under review.
func (s *BeneficiaryFinanceServer) creditOperatorOrderAdjustmentWallet(w http.ResponseWriter, r *http.Request) {
	if !s.authorizeAndRequireOperator(w, r) {
		return
	}
	acting := strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID"))
	correlation := strings.TrimSpace(r.Header.Get("X-Correlation-ID"))
	idempotency := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	if len(correlation) < 8 || len(correlation) > 128 || len(idempotency) < 8 || len(idempotency) > 128 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "correlation and idempotency are required")
		return
	}
	var empty struct{}
	if !decodeJSON(w, r, &empty) {
		return
	}
	orderID := strings.TrimSpace(r.PathValue("orderId"))
	adjustmentID := strings.TrimSpace(r.PathValue("adjustmentId"))
	if orderID == "" || adjustmentID == "" || len(orderID) > 128 || len(adjustmentID) > 128 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "order and adjustment are required")
		return
	}
	order, err := postgres.ReadOrder(r.Context(), s.db, orderID)
	if err != nil {
		writeError(w, http.StatusNotFound, "NOT_FOUND", "order is not available")
		return
	}
	if order.PaymentIntentID == nil || (order.State != "DELIVERED" && order.State != "PICKED_UP") || order.Currency != "YER" || order.DiscountMinor != 0 || order.PromotionID != "" {
		writeError(w, http.StatusConflict, "RECONCILIATION_REQUIRED", "discounted or unpaid orders require reviewed financial reconciliation")
		return
	}
	var adjustment *postgres.OrderAdjustmentRecord
	for i := range order.Adjustments {
		candidate := &order.Adjustments[i]
		if candidate.ID == adjustmentID {
			adjustment = candidate
			break
		}
	}
	if adjustment == nil || adjustment.OrderID != orderID || adjustment.CustomerActorID != order.ClientActorID ||
		adjustment.Kind != "REMOVE_ITEM" || (adjustment.State != "FINANCIAL_RECONCILIATION_REQUIRED" && adjustment.State != "APPLIED") {
		writeError(w, http.StatusConflict, "RECONCILIATION_REQUIRED", "only a customer-accepted full item removal is eligible")
		return
	}
	var amountMinor int64
	for _, line := range order.Lines {
		if line.ID == adjustment.OrderLineID && line.Currency == "YER" {
			amountMinor = line.LineAmountMinor
			break
		}
	}
	if amountMinor <= 0 || amountMinor > order.SubtotalAmountMinor || amountMinor > order.TotalAmountMinor {
		writeError(w, http.StatusConflict, "RECONCILIATION_REQUIRED", "the original item amount is not eligible for direct wallet compensation")
		return
	}
	cases, err := s.payment.ListOrderAdjustmentReconciliationCases(r.Context(), orderID, order.ClientActorID)
	if err != nil {
		writeWLTFinanceError(w, err)
		return
	}
	caseID := ""
	for _, candidate := range cases.Cases {
		if candidate.AdjustmentID == adjustmentID && candidate.PaymentIntentID == *order.PaymentIntentID &&
			candidate.CustomerActorID == order.ClientActorID && candidate.State == "RECONCILIATION_REQUIRED" {
			caseID = candidate.ID
			break
		}
	}
	if caseID == "" {
		writeError(w, http.StatusConflict, "RECONCILIATION_REQUIRED", "the WLT adjustment handoff is not committed yet")
		return
	}
	evidenceReference := "dsh-adjustment-" + adjustmentID
	compensation, replayed, err := s.payment.CreditReviewedCustomerWallet(r.Context(), caseID, amountMinor,
		evidenceReference, acting, idempotency, correlation)
	if err != nil {
		writeWLTFinanceError(w, err)
		return
	}
	if compensation.CaseID != caseID || compensation.OrderID != orderID ||
		compensation.CustomerActorID != order.ClientActorID || compensation.AmountMinor != amountMinor ||
		compensation.Currency != "YER" || compensation.LedgerTransactionID == "" {
		writeError(w, http.StatusBadGateway, "FINANCIAL_READBACK_MISMATCH", "WLT did not return matching canonical wallet credit")
		return
	}
	wallet, err := s.payment.ReadWalletState(r.Context(), "customer", order.ClientActorID)
	if err != nil {
		writeWLTFinanceError(w, err)
		return
	}
	updated, err := postgres.ApplyCompensatedOrderAdjustment(r.Context(), s.db, orderID, adjustmentID, acting, compensation.LedgerTransactionID, correlation)
	if err != nil {
		writeError(w, http.StatusBadGateway, "FINANCIAL_SYNC_REQUIRED", "wallet was credited but the Order adjustment readback remains pending; retry reconciliation without another credit")
		return
	}
	applied := false
	for _, current := range updated.Adjustments {
		if current.ID == adjustmentID && current.State == "APPLIED" {
			applied = true
			break
		}
	}
	if !applied {
		writeError(w, http.StatusBadGateway, "FINANCIAL_READBACK_MISMATCH", "the Order adjustment was not finalized by its canonical owner")
		return
	}
	status := http.StatusCreated
	if replayed {
		status = http.StatusOK
	}
	writeJSON(w, status, map[string]any{"walletCompensation": compensation, "walletState": wallet, "idempotentReplay": replayed})
}
