package http

import (
	"net/http"

	"github.com/bthwani2-boop/samrim/services/wlt/backend/internal/storage/postgres"
)

func (s *Server) cashLiability(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	result, err := postgres.ListCashLiability(r.Context(), s.db, r.PathValue("captainActorId"), 100)
	if err != nil {
		writePaymentError(w, err)
		return
	}
	writeCashLiability(w, result)
}

func writeCashLiability(w http.ResponseWriter, result postgres.CashLiabilityList) {
	items := make([]cashLiabilityItemJSON, 0, len(result.Items))
	for _, item := range result.Items {
		items = append(items, cashLiabilityItemJSON{PaymentIntentID: item.PaymentIntentID, ExternalReference: item.ExternalReference, CaptainActorID: item.CaptainActorID, AmountMinor: item.AmountMinor, Currency: item.Currency, PaymentVersion: item.PaymentVersion, CollectedAt: item.CollectedAt.UTC().Format("2006-01-02T15:04:05.999Z07:00"), RemittanceState: item.RemittanceState, RemittanceReference: item.RemittanceReference, RemittanceID: item.RemittanceID})
	}
	writeJSON(w, http.StatusOK, cashLiabilityResponse{Items: items, TotalAmountMinor: result.TotalAmountMinor, TotalItems: result.TotalItems, HasMore: result.HasMore})
}

// New COD is settled from the Captain's reserved WLT balance. The legacy
// remittance route remains explicitly closed so neither a new collection nor
// a historically settled COD can produce a second cash obligation.
func (s *Server) remitCash(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	writeError(w, http.StatusGone, "CAPTAIN_CASH_REMITTANCE_DISABLED", "BThwani no longer accepts Captain cash remittances; COD is settled from the reserved wallet once")
}

func (s *Server) reconcileCashRemittance(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	actorID, correlation, idempotency, ok := operatorMutationHeaders(w, r)
	if !ok {
		return
	}
	var input reconcileCashRemittanceRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	result, replayed, err := postgres.ReconcileCashRemittance(r.Context(), s.db, postgres.ReconcileCashRemittanceInput{RemittanceID: r.PathValue("remittanceId"), EvidenceDocumentID: input.EvidenceDocumentID, ActorID: actorID, IdempotencyKey: idempotency, CorrelationID: correlation})
	if err != nil {
		writePaymentError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, cashRemittanceResponse{CashRemittance: toCashRemittance(result), IdempotentReplay: replayed})
}
