package transporthttp

import (
	"net/http"
	"strings"
)

func (s *BeneficiaryFinanceServer) RegisterSettlementGovernance(mux *http.ServeMux) {
	mux.HandleFunc("GET /dsh/operator/payout-requests", s.listOperatorPayoutRequests)
	mux.HandleFunc("GET /dsh/operator/payout-requests/{payoutId}", s.readOperatorPayoutRequest)
	mux.HandleFunc("POST /dsh/operator/payout-requests/{payoutId}/prepare", s.prepareOperatorPayout)
	mux.HandleFunc("POST /dsh/operator/payout-requests/{payoutId}/approve", s.approveOperatorPayout)
	mux.HandleFunc("POST /dsh/operator/payout-requests/{payoutId}/cancel", s.cancelOperatorPayout)
	mux.HandleFunc("POST /dsh/operator/settlement-batches", s.createOperatorSettlementBatch)
	mux.HandleFunc("GET /dsh/operator/settlement-batches/{batchId}", s.readOperatorSettlementBatch)
	mux.HandleFunc("POST /dsh/operator/settlement-batches/{batchId}/approve", s.approveOperatorSettlementBatch)
	mux.HandleFunc("POST /dsh/operator/settlement-batches/{batchId}/freeze", s.freezeOperatorSettlementBatch)
	mux.HandleFunc("POST /dsh/operator/settlement-batches/{batchId}/transfers", s.recordOperatorTransfer)
	mux.HandleFunc("POST /dsh/operator/transfers/{transferId}/verify", s.verifyOperatorTransfer)
	mux.HandleFunc("POST /dsh/operator/transfers/{transferId}/reconcile", s.reconcileOperatorTransfer)
}

type payoutGovernanceActionInput struct {
	Reason            string `json:"reason"`
	EvidenceReference string `json:"evidenceReference"`
}

type settlementBatchInput struct {
	PayoutIDs []string `json:"payoutIds"`
}

type transferInput struct {
	PayoutID                  string `json:"payoutId"`
	ExternalTransferReference string `json:"externalTransferReference"`
	EvidenceReference         string `json:"evidenceReference"`
}

type transferReconcileInput struct {
	StatementReference string `json:"statementReference"`
}

func (s *BeneficiaryFinanceServer) listOperatorPayoutRequests(w http.ResponseWriter, r *http.Request) {
	if !s.authorizeAndRequireOperator(w, r) {
		return
	}
	items, err := s.payment.ListPayoutRequests(r.Context(), r.URL.Query().Get("status"), strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID")))
	if err != nil {
		writeWLTFinanceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"payouts": items})
}

func (s *BeneficiaryFinanceServer) readOperatorPayoutRequest(w http.ResponseWriter, r *http.Request) {
	if !s.authorizeAndRequireOperator(w, r) {
		return
	}
	item, err := s.payment.ReadOperatorPayoutRequest(r.Context(), r.PathValue("payoutId"), strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID")))
	if err != nil {
		writeWLTFinanceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"payout": item})
}

func (s *BeneficiaryFinanceServer) prepareOperatorPayout(w http.ResponseWriter, r *http.Request) {
	acting, correlation, idempotency, ok := requiredMutationHeaders(w, r)
	if !ok || !s.authorizeAndRequireOperator(w, r) {
		return
	}
	var input payoutGovernanceActionInput
	if !decodeJSON(w, r, &input) {
		return
	}
	item, err := s.payment.PreparePayout(r.Context(), r.PathValue("payoutId"), input.Reason, input.EvidenceReference, idempotency, correlation, acting)
	if err != nil {
		writeWLTFinanceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"payout": item})
}

func (s *BeneficiaryFinanceServer) approveOperatorPayout(w http.ResponseWriter, r *http.Request) {
	acting, correlation, idempotency, ok := requiredMutationHeaders(w, r)
	if !ok || !s.authorizeAndRequireOperator(w, r) {
		return
	}
	var input payoutGovernanceActionInput
	if !decodeJSON(w, r, &input) {
		return
	}
	item, err := s.payment.ApprovePayout(r.Context(), r.PathValue("payoutId"), input.Reason, idempotency, correlation, acting)
	if err != nil {
		writeWLTFinanceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"payout": item})
}

func (s *BeneficiaryFinanceServer) cancelOperatorPayout(w http.ResponseWriter, r *http.Request) {
	acting, correlation, idempotency, ok := requiredMutationHeaders(w, r)
	if !ok || !s.authorizeAndRequireOperator(w, r) {
		return
	}
	var input payoutGovernanceActionInput
	if !decodeJSON(w, r, &input) {
		return
	}
	item, err := s.payment.CancelPayout(r.Context(), r.PathValue("payoutId"), input.Reason, idempotency, correlation, acting)
	if err != nil {
		writeWLTFinanceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"payout": item})
}

func (s *BeneficiaryFinanceServer) createOperatorSettlementBatch(w http.ResponseWriter, r *http.Request) {
	acting, correlation, idempotency, ok := requiredMutationHeaders(w, r)
	if !ok || !s.authorizeAndRequireOperator(w, r) {
		return
	}
	var input settlementBatchInput
	if !decodeJSON(w, r, &input) {
		return
	}
	item, err := s.payment.CreateSettlementBatch(r.Context(), input.PayoutIDs, idempotency, correlation, acting)
	if err != nil {
		writeWLTFinanceError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"batch": item})
}

func (s *BeneficiaryFinanceServer) readOperatorSettlementBatch(w http.ResponseWriter, r *http.Request) {
	if !s.authorizeAndRequireOperator(w, r) {
		return
	}
	item, err := s.payment.ReadSettlementBatch(r.Context(), r.PathValue("batchId"), strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID")))
	if err != nil {
		writeWLTFinanceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"batch": item})
}

func (s *BeneficiaryFinanceServer) approveOperatorSettlementBatch(w http.ResponseWriter, r *http.Request) {
	acting, correlation, idempotency, ok := requiredMutationHeaders(w, r)
	if !ok || !s.authorizeAndRequireOperator(w, r) {
		return
	}
	var input payoutGovernanceActionInput
	if !decodeJSON(w, r, &input) {
		return
	}
	item, err := s.payment.ApproveSettlementBatch(r.Context(), r.PathValue("batchId"), input.Reason, idempotency, correlation, acting)
	if err != nil {
		writeWLTFinanceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"batch": item})
}

func (s *BeneficiaryFinanceServer) freezeOperatorSettlementBatch(w http.ResponseWriter, r *http.Request) {
	acting, correlation, idempotency, ok := requiredMutationHeaders(w, r)
	if !ok || !s.authorizeAndRequireOperator(w, r) {
		return
	}
	var input payoutGovernanceActionInput
	if !decodeJSON(w, r, &input) {
		return
	}
	item, err := s.payment.FreezeSettlementBatch(r.Context(), r.PathValue("batchId"), input.Reason, idempotency, correlation, acting)
	if err != nil {
		writeWLTFinanceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"batch": item})
}

func (s *BeneficiaryFinanceServer) recordOperatorTransfer(w http.ResponseWriter, r *http.Request) {
	acting, correlation, idempotency, ok := requiredMutationHeaders(w, r)
	if !ok || !s.authorizeAndRequireOperator(w, r) {
		return
	}
	var input transferInput
	if !decodeJSON(w, r, &input) {
		return
	}
	item, err := s.payment.RecordManualTransfer(r.Context(), r.PathValue("batchId"), input.PayoutID, input.ExternalTransferReference, input.EvidenceReference, idempotency, correlation, acting)
	if err != nil {
		writeWLTFinanceError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"transfer": item})
}

func (s *BeneficiaryFinanceServer) verifyOperatorTransfer(w http.ResponseWriter, r *http.Request) {
	acting, correlation, idempotency, ok := requiredMutationHeaders(w, r)
	if !ok || !s.authorizeAndRequireOperator(w, r) {
		return
	}
	var input payoutGovernanceActionInput
	if !decodeJSON(w, r, &input) {
		return
	}
	item, err := s.payment.VerifyManualTransfer(r.Context(), r.PathValue("transferId"), input.EvidenceReference, idempotency, correlation, acting)
	if err != nil {
		writeWLTFinanceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"transfer": item})
}

func (s *BeneficiaryFinanceServer) reconcileOperatorTransfer(w http.ResponseWriter, r *http.Request) {
	acting, correlation, idempotency, ok := requiredMutationHeaders(w, r)
	if !ok || !s.authorizeAndRequireOperator(w, r) {
		return
	}
	var input transferReconcileInput
	if !decodeJSON(w, r, &input) {
		return
	}
	item, err := s.payment.ReconcileManualTransfer(r.Context(), r.PathValue("transferId"), input.StatementReference, idempotency, correlation, acting)
	if err != nil {
		writeWLTFinanceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"transfer": item})
}
