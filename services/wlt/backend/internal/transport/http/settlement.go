package http

import (
	"archive/zip"
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"path/filepath"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

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
	ReceiptDocumentID         string `json:"receiptDocumentId"`
}

type transferVerifyRequest struct {
}

type transferReconcileRequest struct {
	StatementRowID string `json:"statementRowId"`
}

type settlementStatementRequest struct {
	BatchID            string `json:"batchId"`
	ProviderKey        string `json:"providerKey"`
	Currency           string `json:"currency"`
	PeriodStart        string `json:"periodStart"`
	PeriodEnd          string `json:"periodEnd"`
	EvidenceDocumentID string `json:"evidenceDocumentId"`
}

type settlementStatementRowRequest struct {
	RowSequence       int    `json:"rowSequence"`
	ExternalReference string `json:"externalTransferReference"`
	WalletIdentifier  string `json:"walletIdentifier"`
	AmountMinor       int64  `json:"amountMinor"`
	Currency          string `json:"currency"`
	TransactionAt     string `json:"transactionAt"`
}

type payoutListResponse struct {
	Payouts []payoutRequestJSON `json:"payouts"`
}

type settlementBatchResponse struct {
	Batch settlementBatchJSON `json:"batch"`
}

type settlementBatchListResponse struct {
	Batches    []settlementBatchJSON `json:"batches"`
	NextCursor string                `json:"nextCursor,omitempty"`
	Limit      int                   `json:"limit"`
}

type customerWithdrawalIntakeCursor struct {
	Status      string `json:"status"`
	Search      string `json:"search"`
	Sort        string `json:"sort"`
	RequestedAt string `json:"requestedAt"`
	ID          string `json:"id"`
}

type customerWithdrawalIntakeListResponse struct {
	Intakes    []postgres.CustomerWithdrawalIntakeSummaryRecord `json:"intakes"`
	NextCursor string                                          `json:"nextCursor,omitempty"`
	Limit      int                                             `json:"limit"`
}

type settlementBatchExportJSON struct {
	ID                 string `json:"id"`
	BatchID            string `json:"batchId"`
	EvidenceDocumentID string `json:"evidenceDocumentId"`
	Filename           string `json:"filename"`
	ContentType        string `json:"contentType"`
	SHA256             string `json:"sha256"`
	SizeBytes          int64  `json:"sizeBytes"`
	RowCount           int    `json:"rowCount"`
	TotalAmountMinor   int64  `json:"totalAmountMinor"`
	Currency           string `json:"currency"`
	GeneratedBy        string `json:"generatedBy"`
	CreatedAt          string `json:"createdAt"`
}

type transferResponse struct {
	Transfer manualTransferJSON `json:"transfer"`
}

type settlementStatementResponse struct {
	Statement settlementStatementJSON `json:"statement"`
}

type settlementStatementRowResponse struct {
	Row settlementStatementRowJSON `json:"row"`
}

type settlementStatementJSON struct {
	ID                 string  `json:"id"`
	BatchID            *string `json:"batchId,omitempty"`
	ProviderKey        string  `json:"providerKey"`
	Currency           string  `json:"currency"`
	PeriodStart        string  `json:"periodStart"`
	PeriodEnd          string  `json:"periodEnd"`
	EvidenceDocumentID string  `json:"evidenceDocumentId"`
	Filename           string  `json:"filename"`
	ArtifactSHA256     string  `json:"artifactSha256"`
	UploadedBy         string  `json:"uploadedBy"`
	CreatedAt          string  `json:"createdAt"`
}

type settlementStatementRowJSON struct {
	ID                string  `json:"id"`
	StatementID       string  `json:"statementId"`
	RowSequence       int     `json:"rowSequence"`
	ExternalReference string  `json:"externalTransferReference"`
	AmountMinor       int64   `json:"amountMinor"`
	Currency          string  `json:"currency"`
	TransactionAt     string  `json:"transactionAt"`
	RecordedBy        string  `json:"recordedBy"`
	MatchedTransferID *string `json:"matchedTransferId,omitempty"`
}

type settlementBatchJSON struct {
	ID               string                    `json:"id"`
	ProviderKey      string                    `json:"providerKey"`
	Currency         string                    `json:"currency"`
	Status           string                    `json:"status"`
	RowCount         int                       `json:"rowCount"`
	TotalAmountMinor int64                     `json:"totalAmountMinor"`
	CreatedBy        string                    `json:"createdBy"`
	CreatedAt        string                    `json:"createdAt"`
	ApprovedBy       *string                   `json:"approvedBy,omitempty"`
	ApprovedAt       *string                   `json:"approvedAt,omitempty"`
	FrozenBy         *string                   `json:"frozenBy,omitempty"`
	FrozenAt         *string                   `json:"frozenAt,omitempty"`
	BatchHash        string                    `json:"batchHash,omitempty"`
	Items            []settlementBatchItemJSON `json:"items"`
}

type settlementBatchItemJSON struct {
	PayoutID     string              `json:"payoutId"`
	ActorType    string              `json:"actorType"`
	ActorID      string              `json:"actorId"`
	AmountMinor  int64               `json:"amountMinor"`
	Currency     string              `json:"currency"`
	PayoutStatus string              `json:"payoutStatus"`
	Transfer     *manualTransferJSON `json:"transfer,omitempty"`
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
	ReceiptDocumentID    string  `json:"receiptDocumentId"`
	ExecutionStatus      string  `json:"executionStatus"`
	VerifiedBy           *string `json:"verifiedBy,omitempty"`
	VerifiedAt           *string `json:"verifiedAt,omitempty"`
	StatementRowID       *string `json:"statementRowId,omitempty"`
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

func (s *Server) listSettlementBatches(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) || !s.requireActingOperator(w, r) {
		return
	}
	limit := 25
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 || parsed > 100 {
			writeSettlementError(w, postgres.ErrSettlementBatchInput)
			return
		}
		limit = parsed
	}
	var before *time.Time
	var beforeID string
	if cursor := strings.TrimSpace(r.URL.Query().Get("cursor")); cursor != "" {
		decoded, err := base64.RawURLEncoding.DecodeString(cursor)
		parts := strings.SplitN(string(decoded), "|", 2)
		if err != nil || len(parts) != 2 || strings.TrimSpace(parts[1]) == "" {
			writeSettlementError(w, postgres.ErrSettlementBatchInput)
			return
		}
		parsed, err := time.Parse(time.RFC3339Nano, parts[0])
		if err != nil {
			writeSettlementError(w, postgres.ErrSettlementBatchInput)
			return
		}
		before, beforeID = &parsed, parts[1]
	}
	items, more, err := postgres.ListSettlementBatches(r.Context(), s.db, r.URL.Query().Get("status"), before, beforeID, limit)
	if err != nil {
		writeSettlementError(w, err)
		return
	}
	result := settlementBatchListResponse{Batches: make([]settlementBatchJSON, 0, len(items)), Limit: limit}
	for _, item := range items {
		result.Batches = append(result.Batches, toSettlementBatch(item))
	}
	if more && len(items) > 0 {
		last := items[len(items)-1]
		result.NextCursor = base64.RawURLEncoding.EncodeToString([]byte(last.CreatedAt.UTC().Format(time.RFC3339Nano) + "|" + last.ID))
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, result)
}

type financialStatementEntryJSON struct {
	TransactionID   string `json:"transactionId"`
	TransactionType string `json:"transactionType"`
	SourceType      string `json:"sourceType"`
	SourceID        string `json:"sourceId"`
	Direction       string `json:"direction"`
	AmountMinor     int64  `json:"amountMinor"`
	Currency        string `json:"currency"`
	CreatedAt       string `json:"createdAt"`
	BalanceAfter    int64  `json:"balanceAfterMinor"`
}

func (s *Server) readFinancialStatement(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) || !s.requireActingOperator(w, r) {
		return
	}
	actorType := strings.ToLower(strings.TrimSpace(r.PathValue("actorType")))
	actorID := strings.TrimSpace(r.PathValue("actorId"))
	start, startErr := time.Parse("2006-01-02", strings.TrimSpace(r.URL.Query().Get("from")))
	endDate, endErr := time.Parse("2006-01-02", strings.TrimSpace(r.URL.Query().Get("to")))
	if startErr != nil || endErr != nil || !endDate.After(start) || actorID == "" || len(actorID) > 128 {
		writeSettlementError(w, postgres.ErrFinancialStatementInput)
		return
	}
	endExclusive := endDate.AddDate(0, 0, 1)
	limit := 100
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 || parsed > 200 {
			writeSettlementError(w, postgres.ErrFinancialStatementInput)
			return
		}
		limit = parsed
	}
	var cursorAt *time.Time
	cursorID := ""
	if raw := strings.TrimSpace(r.URL.Query().Get("cursor")); raw != "" {
		decoded, err := base64.RawURLEncoding.DecodeString(raw)
		parts := strings.SplitN(string(decoded), "|", 2)
		if err != nil || len(parts) != 2 || strings.TrimSpace(parts[1]) == "" {
			writeSettlementError(w, postgres.ErrFinancialStatementInput)
			return
		}
		parsed, err := time.Parse(time.RFC3339Nano, parts[0])
		if err != nil {
			writeSettlementError(w, postgres.ErrFinancialStatementInput)
			return
		}
		cursorAt, cursorID = &parsed, parts[1]
	}
	item, err := postgres.ReadFinancialStatement(r.Context(), s.db, actorType, actorID, start, endExclusive, cursorAt, cursorID, limit)
	if err != nil {
		writeSettlementError(w, err)
		return
	}
	entries := make([]financialStatementEntryJSON, 0, len(item.Entries))
	for _, entry := range item.Entries {
		entries = append(entries, financialStatementEntryJSON{TransactionID: entry.TransactionID, TransactionType: entry.TransactionType, SourceType: entry.SourceType, SourceID: entry.SourceID, Direction: entry.Direction, AmountMinor: entry.AmountMinor, Currency: entry.Currency, CreatedAt: entry.CreatedAt.UTC().Format(time.RFC3339Nano), BalanceAfter: entry.BalanceAfter})
	}
	response := map[string]any{"actorType": item.ActorType, "actorId": item.ActorID, "currency": item.Currency, "periodStart": item.PeriodStart.Format("2006-01-02"), "periodEnd": endDate.Format("2006-01-02"), "openingBalanceMinor": item.OpeningBalance, "creditsMinor": item.CreditsMinor, "debitsMinor": item.DebitsMinor, "closingBalanceMinor": item.ClosingBalance, "currentBalanceMinor": item.CurrentBalance, "entries": entries, "limit": item.Limit}
	if item.NextCursor != "" {
		response["nextCursor"] = base64.RawURLEncoding.EncodeToString([]byte(item.NextCursor))
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, response)
}

func (s *Server) listFinancialStatementSummaries(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) || !s.requireActingOperator(w, r) {
		return
	}
	actorType := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("actorType")))
	start, startErr := time.Parse("2006-01-02", strings.TrimSpace(r.URL.Query().Get("from")))
	endDate, endErr := time.Parse("2006-01-02", strings.TrimSpace(r.URL.Query().Get("to")))
	if startErr != nil || endErr != nil || !endDate.After(start) {
		writeSettlementError(w, postgres.ErrFinancialStatementInput)
		return
	}
	limit := 100
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 || parsed > 200 {
			writeSettlementError(w, postgres.ErrFinancialStatementInput)
			return
		}
		limit = parsed
	}
	afterActorID := ""
	if raw := strings.TrimSpace(r.URL.Query().Get("cursor")); raw != "" {
		decoded, err := base64.RawURLEncoding.DecodeString(raw)
		if err != nil || len(decoded) == 0 || len(decoded) > 128 {
			writeSettlementError(w, postgres.ErrFinancialStatementInput)
			return
		}
		afterActorID = string(decoded)
	}
	items, totals, hasMore, err := postgres.ListFinancialStatementSummaries(r.Context(), s.db, actorType, start, endDate.AddDate(0, 0, 1), afterActorID, limit)
	if err != nil {
		writeSettlementError(w, err)
		return
	}
	responseItems := make([]map[string]any, 0, len(items))
	for _, item := range items {
		responseItems = append(responseItems, map[string]any{"actorType": item.ActorType, "actorId": item.ActorID, "beneficiaryName": item.BeneficiaryName, "walletIdentifierMasked": item.WalletIdentifierMasked, "currency": item.Currency, "openingBalanceMinor": item.OpeningBalance, "creditsMinor": item.CreditsMinor, "debitsMinor": item.DebitsMinor, "closingBalanceMinor": item.ClosingBalance, "currentBalanceMinor": item.CurrentBalance, "heldMinor": item.HeldMinor, "availableMinor": item.AvailableMinor})
	}
	response := map[string]any{"actorType": actorType, "periodStart": start.Format("2006-01-02"), "periodEnd": endDate.Format("2006-01-02"), "summaries": responseItems, "totals": map[string]any{"openingBalanceMinor": totals.OpeningBalance, "creditsMinor": totals.CreditsMinor, "debitsMinor": totals.DebitsMinor, "closingBalanceMinor": totals.ClosingBalance, "currentBalanceMinor": totals.CurrentBalance, "heldMinor": totals.HeldMinor, "availableMinor": totals.AvailableMinor}, "limit": limit}
	if hasMore && len(items) > 0 {
		response["nextCursor"] = base64.RawURLEncoding.EncodeToString([]byte(items[len(items)-1].ActorID))
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, response)
}

func (s *Server) exportSettlementBatch(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	actorID, correlation, idempotency, ok := operatorMutationHeaders(w, r)
	if !ok || !s.requireOperatorID(w, actorID) {
		return
	}
	item, err := postgres.ExportSettlementBatch(r.Context(), s.db, s.financeEvidenceCipher, postgres.ExportSettlementBatchInput{BatchID: r.PathValue("batchId"), ActorID: actorID, IdempotencyKey: idempotency, CorrelationID: correlation})
	if err != nil {
		writeSettlementError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]settlementBatchExportJSON{"export": toSettlementBatchExport(item)})
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
	item, err := postgres.RecordManualTransfer(r.Context(), s.db, postgres.RecordTransferInput{BatchID: r.PathValue("batchId"), PayoutID: input.PayoutID, ActorID: actorID, ExternalReference: input.ExternalTransferReference, ReceiptDocumentID: input.ReceiptDocumentID, IdempotencyKey: idempotency, CorrelationID: correlation})
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
	item, err := postgres.VerifyManualTransfer(r.Context(), s.db, postgres.VerifyTransferInput{TransferID: r.PathValue("transferId"), ActorID: actorID, IdempotencyKey: idempotency, CorrelationID: correlation})
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
	item, err := postgres.ReconcileManualTransfer(r.Context(), s.db, s.destinationEncryptionKey, postgres.ReconcileTransferInput{TransferID: r.PathValue("transferId"), StatementRowID: input.StatementRowID, ActorID: actorID, IdempotencyKey: idempotency, CorrelationID: correlation})
	if err != nil {
		writeSettlementError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, transferResponse{Transfer: toManualTransfer(item)})
}

func (s *Server) registerSettlementStatement(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	actorID, correlation, idempotency, ok := operatorMutationHeaders(w, r)
	if !ok || !s.requireOperatorID(w, actorID) {
		return
	}
	var input settlementStatementRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	start, startErr := time.Parse("2006-01-02", strings.TrimSpace(input.PeriodStart))
	end, endErr := time.Parse("2006-01-02", strings.TrimSpace(input.PeriodEnd))
	if startErr != nil || endErr != nil {
		writeSettlementError(w, postgres.ErrSettlementBatchInput)
		return
	}
	item, err := postgres.RegisterSettlementStatement(r.Context(), s.db, postgres.SettlementStatementInput{BatchID: input.BatchID, ProviderKey: input.ProviderKey, Currency: input.Currency, PeriodStart: start, PeriodEnd: end, EvidenceDocumentID: input.EvidenceDocumentID, ActorID: actorID, IdempotencyKey: idempotency, CorrelationID: correlation})
	if err != nil {
		writeSettlementError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, settlementStatementResponse{Statement: toSettlementStatement(item)})
}

func (s *Server) createCustomerWithdrawalIntake(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) || !s.requireActingOperator(w, r) {
		return
	}
	correlation, idempotency, ok := mutationHeaders(w, r)
	if !ok {
		return
	}
	var input struct {
		CustomerActorID            string `json:"customerActorId"`
		ProviderKey                string `json:"providerKey"`
		WalletIdentifier           string `json:"walletIdentifier"`
		BeneficiaryName            string `json:"beneficiaryName"`
		BeneficiaryIdentityVersion int    `json:"beneficiaryIdentityVersion"`
		RequestReason              string `json:"requestReason"`
		RequestEvidenceDocumentID  string `json:"requestEvidenceDocumentId"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	item, replayed, err := postgres.CreateCustomerWithdrawalIntake(r.Context(), s.db, s.destinationEncryptionKey, postgres.CustomerWithdrawalIntakeInput{CustomerActorID: input.CustomerActorID, ProviderKey: input.ProviderKey, WalletIdentifier: input.WalletIdentifier, BeneficiaryName: input.BeneficiaryName, BeneficiaryIdentityVersion: input.BeneficiaryIdentityVersion, RequestReason: input.RequestReason, RequestEvidenceDocumentID: input.RequestEvidenceDocumentID, RequestedBy: strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID")), IdempotencyKey: idempotency, CorrelationID: correlation})
	if err != nil {
		writePayoutError(w, err)
		return
	}
	status := http.StatusCreated
	if replayed {
		status = http.StatusOK
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, status, map[string]any{"intake": item, "idempotentReplay": replayed})
}

func (s *Server) listCustomerWithdrawalIntakes(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) || !s.requireActingOperator(w, r) {
		return
	}
	limit := 50
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed >= 1 && parsed <= 100 {
			limit = parsed
		} else {
			writeError(w, http.StatusBadRequest, "INVALID_INPUT", "customer withdrawal list limit is invalid")
			return
		}
	}
	status := strings.ToUpper(strings.TrimSpace(r.URL.Query().Get("status")))
	search := strings.TrimSpace(r.URL.Query().Get("search"))
	sort := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("sort")))
	if sort == "" {
		sort = "requested_desc"
	}
	if len(search) > 128 || (sort != "requested_asc" && sort != "requested_desc") {
		writeSettlementError(w, postgres.ErrPayoutInvalidInput)
		return
	}
	var afterRequestedAt *time.Time
	var afterID string
	if raw := strings.TrimSpace(r.URL.Query().Get("cursor")); raw != "" {
		decoded, err := base64.RawURLEncoding.DecodeString(raw)
		var cursor customerWithdrawalIntakeCursor
		if err != nil || len(decoded) > 640 || json.Unmarshal(decoded, &cursor) != nil || cursor.Status != status || cursor.Search != search || cursor.Sort != sort || strings.TrimSpace(cursor.ID) == "" {
			writeSettlementError(w, postgres.ErrPayoutInvalidInput)
			return
		}
		parsed, err := time.Parse(time.RFC3339Nano, cursor.RequestedAt)
		if err != nil || len(cursor.ID) > 128 {
			writeSettlementError(w, postgres.ErrPayoutInvalidInput)
			return
		}
		afterRequestedAt, afterID = &parsed, cursor.ID
	}
	items, more, err := postgres.ListCustomerWithdrawalIntakes(r.Context(), s.db, status, search, sort, afterRequestedAt, afterID, limit)
	if err != nil {
		writePayoutError(w, err)
		return
	}
	result := customerWithdrawalIntakeListResponse{Intakes: items, Limit: limit}
	if more && len(items) > 0 {
		last := items[len(items)-1]
		cursor, err := json.Marshal(customerWithdrawalIntakeCursor{Status: status, Search: search, Sort: sort, RequestedAt: last.RequestedAt.UTC().Format(time.RFC3339Nano), ID: last.ID})
		if err != nil {
			writeError(w, http.StatusInternalServerError, "INTERNAL", "customer withdrawal cursor could not be created")
			return
		}
		result.NextCursor = base64.RawURLEncoding.EncodeToString(cursor)
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) readCustomerWithdrawalIntake(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) || !s.requireActingOperator(w, r) {
		return
	}
	item, err := postgres.ReadCustomerWithdrawalIntake(r.Context(), s.db, r.PathValue("intakeId"))
	if err != nil {
		writePayoutError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{"intake": item})
}

func (s *Server) prepareCustomerWithdrawalDestination(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) || !s.requireActingOperator(w, r) {
		return
	}
	correlation, idempotency, ok := mutationHeaders(w, r)
	if !ok {
		return
	}
	var input struct {
		Reason string `json:"reason"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	destination, err := postgres.PrepareCustomerWithdrawalDestination(r.Context(), s.db, s.destinationEncryptionKey, r.PathValue("intakeId"), strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID")), input.Reason, idempotency, correlation)
	if err != nil {
		writeDestinationError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusCreated, officialWalletDestinationResponse{Destination: toOfficialWalletDestination(destination)})
}

func (s *Server) acceptCustomerWithdrawal(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) || !s.requireActingOperator(w, r) {
		return
	}
	correlation, idempotency, ok := mutationHeaders(w, r)
	if !ok {
		return
	}
	var input struct {
		Reason string `json:"reason"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	payout, err := postgres.AcceptCustomerWithdrawal(r.Context(), s.db, postgres.CustomerWithdrawalAcceptInput{IntakeID: r.PathValue("intakeId"), ActorID: strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID")), Reason: input.Reason, IdempotencyKey: idempotency, CorrelationID: correlation})
	if err != nil {
		writePayoutError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusCreated, payoutRequestResponse{Payout: toPayoutRequest(payout)})
}

func (s *Server) rejectCustomerWithdrawal(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) || !s.requireActingOperator(w, r) {
		return
	}
	correlation, idempotency, ok := mutationHeaders(w, r)
	if !ok {
		return
	}
	var input struct {
		Reason string `json:"reason"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	item, err := postgres.RejectCustomerWithdrawal(r.Context(), s.db, r.PathValue("intakeId"), strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID")), input.Reason, idempotency, correlation)
	if err != nil {
		writePayoutError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{"intake": item})
}

func (s *Server) recordSettlementStatementRow(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	actorID, correlation, idempotency, ok := operatorMutationHeaders(w, r)
	if !ok || !s.requireOperatorID(w, actorID) {
		return
	}
	var input settlementStatementRowRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	transactionAt, err := time.Parse(time.RFC3339Nano, strings.TrimSpace(input.TransactionAt))
	if err != nil {
		writeSettlementError(w, postgres.ErrSettlementBatchInput)
		return
	}
	item, err := postgres.RecordSettlementStatementRow(r.Context(), s.db, s.destinationEncryptionKey, postgres.SettlementStatementRowInput{StatementID: r.PathValue("statementId"), RowSequence: input.RowSequence, ExternalReference: input.ExternalReference, WalletIdentifier: input.WalletIdentifier, AmountMinor: input.AmountMinor, Currency: input.Currency, TransactionAt: transactionAt, ActorID: actorID, IdempotencyKey: idempotency, CorrelationID: correlation})
	if err != nil {
		writeSettlementError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, settlementStatementRowResponse{Row: toSettlementStatementRow(item)})
}

type financeEvidenceDocumentJSON struct {
	ID          string `json:"id"`
	Purpose     string `json:"purpose"`
	Filename    string `json:"filename"`
	ContentType string `json:"contentType"`
	SHA256      string `json:"sha256"`
	SizeBytes   int64  `json:"sizeBytes"`
	UploadedBy  string `json:"uploadedBy"`
	CreatedAt   string `json:"createdAt"`
}

func (s *Server) uploadFinanceEvidenceDocument(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	actorID, correlation, idempotency, ok := operatorMutationHeaders(w, r)
	if !ok || !s.requireOperatorID(w, actorID) {
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 10*1024*1024+64*1024)
	if err := r.ParseMultipartForm(10 * 1024 * 1024); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_UPLOAD", "finance evidence upload is invalid or exceeds 10 MiB")
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_UPLOAD", "finance evidence file is required")
		return
	}
	defer file.Close()
	content, err := io.ReadAll(io.LimitReader(file, 10*1024*1024+1))
	if err != nil || len(content) == 0 || len(content) > 10*1024*1024 {
		writeError(w, http.StatusBadRequest, "INVALID_UPLOAD", "finance evidence upload is invalid or exceeds 10 MiB")
		return
	}
	contentType, valid := financeEvidenceContentType(filepath.Ext(header.Filename), content)
	if !valid {
		writeError(w, http.StatusBadRequest, "INVALID_UPLOAD", "finance evidence must be a valid PDF, PNG, JPEG, CSV, or XLSX file")
		return
	}
	filename := filepath.Base(strings.ReplaceAll(header.Filename, "\\", "/"))
	if len(filename) > 255 || strings.ContainsAny(filename, "\r\n") {
		writeError(w, http.StatusBadRequest, "INVALID_UPLOAD", "finance evidence filename is invalid")
		return
	}
	item, err := postgres.SaveFinanceEvidenceDocument(r.Context(), s.db, s.financeEvidenceCipher, postgres.FinanceEvidenceDocumentInput{Purpose: r.FormValue("purpose"), Filename: filename, ContentType: contentType, Content: content, ActorID: actorID, IdempotencyKey: idempotency, CorrelationID: correlation})
	if err != nil {
		writeSettlementError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"document": toFinanceEvidenceDocument(item)})
}

func financeEvidenceContentType(extension string, content []byte) (string, bool) {
	switch {
	case len(content) >= 5 && string(content[:5]) == "%PDF-":
		return "application/pdf", strings.EqualFold(extension, ".pdf")
	case len(content) >= 8 && string(content[:8]) == "\x89PNG\r\n\x1a\n":
		return "image/png", strings.EqualFold(extension, ".png")
	case len(content) >= 3 && string(content[:3]) == "\xff\xd8\xff":
		return "image/jpeg", strings.EqualFold(extension, ".jpg") || strings.EqualFold(extension, ".jpeg")
	case strings.EqualFold(extension, ".xlsx"):
		archive, err := zip.NewReader(bytes.NewReader(content), int64(len(content)))
		if err != nil {
			return "", false
		}
		hasTypes, hasWorkbook := false, false
		for _, entry := range archive.File {
			hasTypes = hasTypes || entry.Name == "[Content_Types].xml"
			hasWorkbook = hasWorkbook || entry.Name == "xl/workbook.xml"
		}
		return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", hasTypes && hasWorkbook
	case strings.EqualFold(extension, ".csv"):
		return "text/csv", utf8.Valid(content) && !strings.ContainsRune(string(content), '\x00')
	default:
		return "", false
	}
}

func (s *Server) readFinanceEvidenceDocument(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) || !s.requireActingOperator(w, r) {
		return
	}
	item, err := postgres.ReadFinanceEvidenceDocumentForOperator(r.Context(), s.db, s.financeEvidenceCipher, r.PathValue("documentId"), strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID")), strings.TrimSpace(r.Header.Get("X-Correlation-ID")))
	if err != nil {
		writeSettlementError(w, err)
		return
	}
	w.Header().Set("Content-Type", item.ContentType)
	w.Header().Set("Content-Length", strconv.Itoa(len(item.Content)))
	w.Header().Set("Content-Disposition", "attachment; filename*=UTF-8''"+url.PathEscape(item.Filename))
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(item.Content)
}

func toFinanceEvidenceDocument(item postgres.FinanceEvidenceDocumentRecord) financeEvidenceDocumentJSON {
	return financeEvidenceDocumentJSON{ID: item.ID, Purpose: item.Purpose, Filename: item.Filename, ContentType: item.ContentType, SHA256: item.SHA256, SizeBytes: item.SizeBytes, UploadedBy: item.UploadedBy, CreatedAt: item.CreatedAt.UTC().Format(time.RFC3339Nano)}
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
	result := settlementBatchJSON{ID: item.ID, ProviderKey: item.ProviderKey, Currency: item.Currency, Status: item.Status, RowCount: item.RowCount, TotalAmountMinor: item.TotalAmountMinor, CreatedBy: item.CreatedBy, CreatedAt: item.CreatedAt.UTC().Format(time.RFC3339Nano), ApprovedBy: item.ApprovedBy, ApprovedAt: formatNullableTime(item.ApprovedAt), FrozenBy: item.FrozenBy, FrozenAt: formatNullableTime(item.FrozenAt), BatchHash: item.BatchHash, Items: make([]settlementBatchItemJSON, 0, len(item.Items))}
	for _, row := range item.Items {
		var transfer *manualTransferJSON
		if row.Transfer != nil {
			converted := toManualTransfer(*row.Transfer)
			transfer = &converted
		}
		result.Items = append(result.Items, settlementBatchItemJSON{PayoutID: row.PayoutID, ActorType: row.ActorType, ActorID: row.ActorID, AmountMinor: row.AmountMinor, Currency: row.Currency, PayoutStatus: row.PayoutStatus, Transfer: transfer})
	}
	return result
}

func toSettlementBatchExport(item postgres.SettlementBatchExportRecord) settlementBatchExportJSON {
	return settlementBatchExportJSON{ID: item.ID, BatchID: item.BatchID, EvidenceDocumentID: item.EvidenceDocumentID, Filename: item.Filename, ContentType: item.ContentType, SHA256: item.SHA256, SizeBytes: item.SizeBytes, RowCount: item.RowCount, TotalAmountMinor: item.TotalAmountMinor, Currency: item.Currency, GeneratedBy: item.GeneratedBy, CreatedAt: item.CreatedAt}
}

func toManualTransfer(item postgres.ManualTransferExecutionRecord) manualTransferJSON {
	return manualTransferJSON{ID: item.ID, BatchID: item.BatchID, PayoutID: item.PayoutID, ApprovedSnapshotHash: item.ApprovedSnapshotHash, ExecutedBy: item.ExecutedBy, ExecutedAt: item.ExecutedAt.UTC().Format(time.RFC3339Nano), ProviderKey: item.ProviderKey, ExternalReference: item.ExternalReference, AmountMinor: item.AmountMinor, Currency: item.Currency, DestinationID: item.DestinationID, DestinationVersion: item.DestinationVersion, ReceiptDocumentID: item.ReceiptDocumentID, ExecutionStatus: item.ExecutionStatus, VerifiedBy: item.VerifiedBy, VerifiedAt: formatNullableTime(item.VerifiedAt), StatementRowID: item.StatementRowID, ReconciledBy: item.ReconciledBy, ReconciledAt: formatNullableTime(item.ReconciledAt)}
}

func toSettlementStatement(item postgres.SettlementStatementRecord) settlementStatementJSON {
	return settlementStatementJSON{ID: item.ID, BatchID: item.BatchID, ProviderKey: item.ProviderKey, Currency: item.Currency, PeriodStart: item.PeriodStart.Format("2006-01-02"), PeriodEnd: item.PeriodEnd.Format("2006-01-02"), EvidenceDocumentID: item.EvidenceDocumentID, Filename: item.Filename, ArtifactSHA256: item.ArtifactSHA256, UploadedBy: item.UploadedBy, CreatedAt: item.CreatedAt.UTC().Format(time.RFC3339Nano)}
}

func toSettlementStatementRow(item postgres.SettlementStatementRowRecord) settlementStatementRowJSON {
	return settlementStatementRowJSON{ID: item.ID, StatementID: item.StatementID, RowSequence: item.RowSequence, ExternalReference: item.ExternalReference, AmountMinor: item.AmountMinor, Currency: item.Currency, TransactionAt: item.TransactionAt.UTC().Format(time.RFC3339Nano), RecordedBy: item.RecordedBy, MatchedTransferID: item.MatchedTransferID}
}

func writeSettlementError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, postgres.ErrPayoutNotFound), errors.Is(err, postgres.ErrSettlementBatchNotFound), errors.Is(err, postgres.ErrTransferNotFound):
		writeError(w, http.StatusNotFound, "NOT_FOUND", "the requested settlement record was not found")
	case errors.Is(err, postgres.ErrFinanceEvidenceNotFound):
		writeError(w, http.StatusNotFound, "FINANCE_EVIDENCE_NOT_FOUND", "the required finance evidence document was not found")
	case errors.Is(err, postgres.ErrPayoutApprovalSeparation), errors.Is(err, postgres.ErrTransferSeparation):
		writeError(w, http.StatusForbidden, "SEPARATION_OF_DUTIES", "independent approval or verification is required")
	case errors.Is(err, postgres.ErrPayoutState), errors.Is(err, postgres.ErrSettlementBatchState), errors.Is(err, postgres.ErrSettlementBatchExportState), errors.Is(err, postgres.ErrTransferState):
		writeError(w, http.StatusConflict, "STATE_CONFLICT", "the settlement state does not allow this operation")
	case errors.Is(err, postgres.ErrIdempotencyConflict):
		writeError(w, http.StatusConflict, "IDEMPOTENCY_CONFLICT", "Idempotency-Key was already used with different settlement facts")
	case errors.Is(err, postgres.ErrSettlementBatchInput), errors.Is(err, postgres.ErrPayoutInvalidInput), errors.Is(err, postgres.ErrFinancialStatementInput), errors.Is(err, postgres.ErrPartnerCommissionRegistryInput):
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "settlement input is invalid")
	default:
		writeError(w, http.StatusBadGateway, "WLT_STORAGE_UNAVAILABLE", "WLT persistence is unavailable")
	}
}
