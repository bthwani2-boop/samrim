package http

import (
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/bthwani2-boop/samrim/services/wlt/backend/internal/storage/postgres"
)

type payoutActionRequest struct {
	Reason            string `json:"reason"`
	EvidenceReference string `json:"evidenceReference"`
}

type settlementBatchCreateRequest struct {
	PayoutIDs []string `json:"payoutIds"`
}

type transferRecordRequest struct {
	PayoutID                  string `json:"payoutId"`
	ExternalTransferReference string `json:"externalTransferReference"`
	EvidenceReference         string `json:"evidenceReference"`
}

type transferVerifyRequest struct {
	EvidenceReference string `json:"evidenceReference"`
}

type transferReconcileRequest struct {
	StatementReference string `json:"statementReference"`
}

type payoutListResponse struct {
	Payouts []payoutRequestJSON `json:"payouts"`
}

type settlementBatchResponse struct {
	Batch settlementBatchJSON `json:"batch"`
}

type transferResponse struct {
	Transfer manualTransferJSON `json:"transfer"`
}

type settlementBatchJSON struct {
	ID               string  `json:"id"`
	ProviderKey      string  `json:"providerKey"`
	Currency         string  `json:"currency"`
	Status           string  `json:"status"`
	RowCount         int     `json:"rowCount"`
	TotalAmountMinor int64   `json:"totalAmountMinor"`
	CreatedBy        string  `json:"createdBy"`
	CreatedAt        string  `json:"createdAt"`
	ApprovedBy       *string `json:"approvedBy,omitempty"`
	ApprovedAt       *string `json:"approvedAt,omitempty"`
	FrozenBy         *string `json:"frozenBy,omitempty"`
	FrozenAt         *string `json:"frozenAt,omitempty"`
	BatchHash        string  `json:"batchHash,omitempty"`
}

type manualTransferJSON struct {
	ID                   string  `json:"id"`
	BatchID              string  `json:"batchId"`
	PayoutID             string  `json:"payoutId"`
	ApprovedSnapshotHash string  `json:"approvedSnapshotHash"`
	ExecutedBy           string  `json:"executedBy"`
	ExecutedAt           string  `json:"executedAt"`
	ProviderKey          string  `json:"providerKey"`
	ExternalReference    string  `json:"externalTransferReference"`
	AmountMinor          int64   `json:"amountMinor"`
	Currency             string  `json:"currency"`
	DestinationID        string  `json:"destinationId"`
	DestinationVersion   int     `json:"destinationVersion"`
	EvidenceReference    string  `json:"evidenceReference"`
	ExecutionStatus      string  `json:"executionStatus"`
	VerifiedBy           *string `json:"verifiedBy,omitempty"`
	VerifiedAt           *string `json:"verifiedAt,omitempty"`
	StatementReference   *string `json:"statementReference,omitempty"`
	ReconciledBy         *string `json:"reconciledBy,omitempty"`
	ReconciledAt         *string `json:"reconciledAt,omitempty"`
}

func (s *Server) listPayoutRequests(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) || !s.requireActingOperator(w, r) {
		return
	}
	limit := 100
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil {
			limit = parsed
		}
	}
	items, err := postgres.ListPayoutRequests(r.Context(), s.db, r.URL.Query().Get("status"), limit)
	if err != nil {
		writeSettlementError(w, err)
		return
	}
	result := make([]payoutRequestJSON, 0, len(items))
	for _, item := range items {
		result = append(result, toPayoutRequest(item))
	}
	writeJSON(w, http.StatusOK, payoutListResponse{Payouts: result})
}

func (s *Server) readOperatorPayoutRequest(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) || !s.requireActingOperator(w, r) {
		return
	}
	item, err := postgres.ReadPayoutRequest(r.Context(), s.db, r.PathValue("payoutId"))
	if err != nil {
		writeSettlementError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, payoutRequestResponse{Payout: toPayoutRequest(item)})
}

func (s *Server) preparePayout(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	actorID, correlation, idempotency, ok := operatorMutationHeaders(w, r)
	if !ok || !s.requireOperatorID(w, actorID) {
		return
	}
	var input payoutActionRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	item, err := postgres.PreparePayout(r.Context(), s.db, postgres.PreparePayoutInput{PayoutID: r.PathValue("payoutId"), ActorID: actorID, Reason: input.Reason, Evidence: input.EvidenceReference, IdempotencyKey: idempotency, CorrelationID: correlation})
	if err != nil {
		writeSettlementError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, payoutRequestResponse{Payout: toPayoutRequest(item)})
}

func (s *Server) approvePayout(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	actorID, correlation, idempotency, ok := operatorMutationHeaders(w, r)
	if !ok || !s.requireOperatorID(w, actorID) {
		return
	}
	var input payoutActionRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	item, err := postgres.ApprovePayout(r.Context(), s.db, postgres.ApprovePayoutInput{PayoutID: r.PathValue("payoutId"), ActorID: actorID, Reason: input.Reason, IdempotencyKey: idempotency, CorrelationID: correlation})
	if err != nil {
		writeSettlementError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, payoutRequestResponse{Payout: toPayoutRequest(item)})
}

func (s *Server) cancelPayout(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	actorID, correlation, idempotency, ok := operatorMutationHeaders(w, r)
	if !ok || !s.requireOperatorID(w, actorID) {
		return
	}
	var input payoutActionRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	item, err := postgres.CancelPayout(r.Context(), s.db, postgres.CancelPayoutInput{PayoutID: r.PathValue("payoutId"), ActorID: actorID, Reason: input.Reason, IdempotencyKey: idempotency, CorrelationID: correlation})
	if err != nil {
		writeSettlementError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, payoutRequestResponse{Payout: toPayoutRequest(item)})
}

func (s *Server) createSettlementBatch(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	actorID, correlation, idempotency, ok := operatorMutationHeaders(w, r)
	if !ok || !s.requireOperatorID(w, actorID) {
		return
	}
	var input settlementBatchCreateRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	item, err := postgres.CreateSettlementBatch(r.Context(), s.db, postgres.CreateSettlementBatchInput{PayoutIDs: input.PayoutIDs, ActorID: actorID, IdempotencyKey: idempotency, CorrelationID: correlation})
	if err != nil {
		writeSettlementError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, settlementBatchResponse{Batch: toSettlementBatch(item)})
}

func (s *Server) readSettlementBatch(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) || !s.requireActingOperator(w, r) {
		return
	}
	item, err := postgres.ReadSettlementBatch(r.Context(), s.db, r.PathValue("batchId"))
	if err != nil {
		writeSettlementError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, settlementBatchResponse{Batch: toSettlementBatch(item)})
}

func (s *Server) approveSettlementBatch(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	actorID, correlation, idempotency, ok := operatorMutationHeaders(w, r)
	if !ok || !s.requireOperatorID(w, actorID) {
		return
	}
	var input payoutActionRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	item, err := postgres.ApproveSettlementBatch(r.Context(), s.db, postgres.BatchActionInput{BatchID: r.PathValue("batchId"), ActorID: actorID, Reason: input.Reason, IdempotencyKey: idempotency, CorrelationID: correlation})
	if err != nil {
		writeSettlementError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, settlementBatchResponse{Batch: toSettlementBatch(item)})
}

func (s *Server) freezeSettlementBatch(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	actorID, correlation, idempotency, ok := operatorMutationHeaders(w, r)
	if !ok || !s.requireOperatorID(w, actorID) {
		return
	}
	var input payoutActionRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	item, err := postgres.FreezeSettlementBatch(r.Context(), s.db, postgres.BatchActionInput{BatchID: r.PathValue("batchId"), ActorID: actorID, Reason: input.Reason, IdempotencyKey: idempotency, CorrelationID: correlation})
	if err != nil {
		writeSettlementError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, settlementBatchResponse{Batch: toSettlementBatch(item)})
}

func (s *Server) recordManualTransfer(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	actorID, correlation, idempotency, ok := operatorMutationHeaders(w, r)
	if !ok || !s.requireOperatorID(w, actorID) {
		return
	}
	var input transferRecordRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	item, err := postgres.RecordManualTransfer(r.Context(), s.db, postgres.RecordTransferInput{BatchID: r.PathValue("batchId"), PayoutID: input.PayoutID, ActorID: actorID, ExternalReference: input.ExternalTransferReference, EvidenceReference: input.EvidenceReference, IdempotencyKey: idempotency, CorrelationID: correlation})
	if err != nil {
		writeSettlementError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, transferResponse{Transfer: toManualTransfer(item)})
}

func (s *Server) verifyManualTransfer(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	actorID, correlation, idempotency, ok := operatorMutationHeaders(w, r)
	if !ok || !s.requireOperatorID(w, actorID) {
		return
	}
	var input transferVerifyRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	item, err := postgres.VerifyManualTransfer(r.Context(), s.db, postgres.VerifyTransferInput{TransferID: r.PathValue("transferId"), ActorID: actorID, Evidence: input.EvidenceReference, IdempotencyKey: idempotency, CorrelationID: correlation})
	if err != nil {
		writeSettlementError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, transferResponse{Transfer: toManualTransfer(item)})
}

func (s *Server) reconcileManualTransfer(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	actorID, correlation, idempotency, ok := operatorMutationHeaders(w, r)
	if !ok || !s.requireOperatorID(w, actorID) {
		return
	}
	var input transferReconcileRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	item, err := postgres.ReconcileManualTransfer(r.Context(), s.db, postgres.ReconcileTransferInput{TransferID: r.PathValue("transferId"), ActorID: actorID, StatementReference: input.StatementReference, IdempotencyKey: idempotency, CorrelationID: correlation})
	if err != nil {
		writeSettlementError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, transferResponse{Transfer: toManualTransfer(item)})
}

func (s *Server) requireActingOperator(w http.ResponseWriter, r *http.Request) bool {
	return s.requireOperatorID(w, strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID")))
}

func (s *Server) requireOperatorID(w http.ResponseWriter, actorID string) bool {
	if len(actorID) < 1 || len(actorID) > 128 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "X-Acting-Actor-ID is required")
		return false
	}
	return true
}

func operatorMutationHeaders(w http.ResponseWriter, r *http.Request) (string, string, string, bool) {
	correlation, idempotency, ok := mutationHeaders(w, r)
	if !ok {
		return "", "", "", false
	}
	actorID := strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID"))
	if actorID == "" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "X-Acting-Actor-ID is required")
		return "", "", "", false
	}
	return actorID, correlation, idempotency, true
}

func toSettlementBatch(item postgres.SettlementBatchRecord) settlementBatchJSON {
	return settlementBatchJSON{ID: item.ID, ProviderKey: item.ProviderKey, Currency: item.Currency, Status: item.Status, RowCount: item.RowCount, TotalAmountMinor: item.TotalAmountMinor, CreatedBy: item.CreatedBy, CreatedAt: item.CreatedAt.UTC().Format(time.RFC3339Nano), ApprovedBy: item.ApprovedBy, ApprovedAt: formatNullableTime(item.ApprovedAt), FrozenBy: item.FrozenBy, FrozenAt: formatNullableTime(item.FrozenAt), BatchHash: item.BatchHash}
}

func toManualTransfer(item postgres.ManualTransferExecutionRecord) manualTransferJSON {
	return manualTransferJSON{ID: item.ID, BatchID: item.BatchID, PayoutID: item.PayoutID, ApprovedSnapshotHash: item.ApprovedSnapshotHash, ExecutedBy: item.ExecutedBy, ExecutedAt: item.ExecutedAt.UTC().Format(time.RFC3339Nano), ProviderKey: item.ProviderKey, ExternalReference: item.ExternalReference, AmountMinor: item.AmountMinor, Currency: item.Currency, DestinationID: item.DestinationID, DestinationVersion: item.DestinationVersion, EvidenceReference: item.EvidenceReference, ExecutionStatus: item.ExecutionStatus, VerifiedBy: item.VerifiedBy, VerifiedAt: formatNullableTime(item.VerifiedAt), StatementReference: item.StatementReference, ReconciledBy: item.ReconciledBy, ReconciledAt: formatNullableTime(item.ReconciledAt)}
}

func writeSettlementError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, postgres.ErrPayoutNotFound), errors.Is(err, postgres.ErrSettlementBatchNotFound), errors.Is(err, postgres.ErrTransferNotFound):
		writeError(w, http.StatusNotFound, "NOT_FOUND", "the requested settlement record was not found")
	case errors.Is(err, postgres.ErrPayoutApprovalSeparation), errors.Is(err, postgres.ErrTransferSeparation):
		writeError(w, http.StatusForbidden, "SEPARATION_OF_DUTIES", "independent approval or verification is required")
	case errors.Is(err, postgres.ErrPayoutState), errors.Is(err, postgres.ErrSettlementBatchState), errors.Is(err, postgres.ErrTransferState):
		writeError(w, http.StatusConflict, "STATE_CONFLICT", "the settlement state does not allow this operation")
	case errors.Is(err, postgres.ErrIdempotencyConflict):
		writeError(w, http.StatusConflict, "IDEMPOTENCY_CONFLICT", "Idempotency-Key was already used with different settlement facts")
	case errors.Is(err, postgres.ErrSettlementBatchInput), errors.Is(err, postgres.ErrPayoutInvalidInput):
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "settlement input is invalid")
	default:
		writeError(w, http.StatusBadGateway, "WLT_STORAGE_UNAVAILABLE", "WLT persistence is unavailable")
	}
}
