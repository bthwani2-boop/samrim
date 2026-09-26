package transporthttp

import (
	"database/sql"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/wlt"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

func (s *BeneficiaryFinanceServer) RegisterSettlementGovernance(mux *http.ServeMux) {
	mux.HandleFunc("GET /dsh/operator/payout-requests", s.listOperatorPayoutRequests)
	mux.HandleFunc("GET /dsh/operator/beneficiaries", s.listOperatorBeneficiaryPayoutStates)
	mux.HandleFunc("GET /dsh/operator/beneficiaries/{actorType}/{actorId}/financial-statement", s.readOperatorFinancialStatement)
	mux.HandleFunc("GET /dsh/operator/financial-statements", s.listOperatorFinancialStatementSummaries)
	mux.HandleFunc("GET /dsh/operator/payout-requests/{payoutId}", s.readOperatorPayoutRequest)
	mux.HandleFunc("POST /dsh/operator/payout-requests/{payoutId}/prepare", s.prepareOperatorPayout)
	mux.HandleFunc("POST /dsh/operator/payout-requests/{payoutId}/approve", s.approveOperatorPayout)
	mux.HandleFunc("POST /dsh/operator/payout-requests/{payoutId}/cancel", s.cancelOperatorPayout)
	mux.HandleFunc("POST /dsh/operator/settlement-batches", s.createOperatorSettlementBatch)
	mux.HandleFunc("GET /dsh/operator/settlement-batches", s.listOperatorSettlementBatches)
	mux.HandleFunc("GET /dsh/operator/settlement-batches/{batchId}", s.readOperatorSettlementBatch)
	mux.HandleFunc("POST /dsh/operator/settlement-batches/{batchId}/export", s.exportOperatorSettlementBatch)
	mux.HandleFunc("POST /dsh/operator/settlement-batches/{batchId}/approve", s.approveOperatorSettlementBatch)
	mux.HandleFunc("POST /dsh/operator/settlement-batches/{batchId}/freeze", s.freezeOperatorSettlementBatch)
	mux.HandleFunc("POST /dsh/operator/settlement-batches/{batchId}/transfers", s.recordOperatorTransfer)
	mux.HandleFunc("POST /dsh/operator/transfers/{transferId}/verify", s.verifyOperatorTransfer)
	mux.HandleFunc("POST /dsh/operator/transfers/{transferId}/reconcile", s.reconcileOperatorTransfer)
	mux.HandleFunc("POST /dsh/operator/finance-evidence-documents", s.uploadOperatorFinanceEvidence)
	mux.HandleFunc("GET /dsh/operator/finance-evidence-documents/{documentId}", s.readOperatorFinanceEvidence)
	mux.HandleFunc("POST /dsh/operator/settlement-statements", s.registerOperatorSettlementStatement)
	mux.HandleFunc("POST /dsh/operator/settlement-statements/{statementId}/rows", s.recordOperatorStatementRow)
}

func (s *BeneficiaryFinanceServer) readOperatorFinancialStatement(w http.ResponseWriter, r *http.Request) {
	if !s.authorizeAndRequireOperator(w, r) {
		return
	}
	actorType := strings.ToLower(strings.TrimSpace(r.PathValue("actorType")))
	actorID := strings.TrimSpace(r.PathValue("actorId"))
	from, to := strings.TrimSpace(r.URL.Query().Get("from")), strings.TrimSpace(r.URL.Query().Get("to"))
	if actorID == "" || len(actorID) > 128 || from == "" || to == "" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "financial statement period and beneficiary are required")
		return
	}
	statement, err := s.payment.ReadFinancialStatement(r.Context(), actorType, actorID, from, to, r.URL.Query().Get("cursor"), 100, strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID")))
	if err != nil {
		writeWLTFinanceError(w, err)
		return
	}
	for i := range statement.Entries {
		entry := &statement.Entries[i]
		if actorType == "field" && entry.SourceType == "STORE_CLIENT_VISIBLE" {
			var store wlt.FinancialStatementStore
			err = s.db.QueryRowContext(r.Context(), `SELECT id,name,publication_state FROM dsh.stores WHERE id=$1`, entry.SourceID).Scan(&store.StoreID, &store.Name, &store.PublicationState)
			if errors.Is(err, sql.ErrNoRows) {
				continue
			}
			if err != nil {
				writeError(w, http.StatusBadGateway, "FINANCIAL_SOURCE_UNAVAILABLE", "the source store for a financial entry could not be read")
				return
			}
			entry.Store = &store
			continue
		}
		if entry.SourceType != "ORDER_DELIVERED" && entry.SourceType != "PARTNER_STORE_CASH_COMMISSION" {
			continue
		}
		order, readErr := postgres.ReadOrder(r.Context(), s.db, entry.SourceID)
		if readErr != nil {
			if errors.Is(readErr, postgres.ErrOrderNotFound) || errors.Is(readErr, sql.ErrNoRows) {
				continue
			}
			writeError(w, http.StatusBadGateway, "FINANCIAL_SOURCE_UNAVAILABLE", "the source order for a financial entry could not be read")
			return
		}
		var related bool
		switch actorType {
		case "customer":
			related = order.ClientActorID == actorID
		case "partner":
			err = s.db.QueryRowContext(r.Context(), `SELECT EXISTS(SELECT 1 FROM dsh.stores WHERE id=$1 AND partner_actor_id=$2)`, order.StoreID, actorID).Scan(&related)
		case "captain":
			err = s.db.QueryRowContext(r.Context(), `SELECT EXISTS(SELECT 1 FROM dsh.captain_assignments WHERE order_id=$1 AND captain_actor_id=$2)`, order.ID, actorID).Scan(&related)
		case "field":
			// Current field-commission sources are store-publication events, not orders.
			continue
		default:
			writeError(w, http.StatusBadRequest, "INVALID_INPUT", "financial statement beneficiary type is invalid")
			return
		}
		if err != nil {
			writeError(w, http.StatusBadGateway, "FINANCIAL_SOURCE_UNAVAILABLE", "the beneficiary relationship for a financial entry could not be verified")
			return
		}
		if !related {
			continue
		}
		lines := make([]wlt.FinancialStatementOrderLine, 0, len(order.Lines))
		for _, line := range order.Lines {
			quantity := line.RequestedQuantityBaseUnits
			if line.FinalQuantityBaseUnits != nil {
				quantity = *line.FinalQuantityBaseUnits
			}
			lines = append(lines, wlt.FinancialStatementOrderLine{ProductName: line.ProductName, VariantTitle: line.VariantTitle, QuantityBaseUnits: quantity, UnitPriceMinor: line.UnitPriceMinor, LineAmountMinor: line.LineAmountMinor, Currency: line.Currency})
		}
		entry.Order = &wlt.FinancialStatementOrder{OrderID: order.ID, StoreName: order.StoreName, State: order.State, Fulfillment: order.FulfillmentMode, SubtotalMinor: order.SubtotalAmountMinor, DiscountMinor: order.DiscountMinor, TotalMinor: order.TotalAmountMinor, Currency: order.Currency, CreatedAt: order.CreatedAt.UTC().Format(time.RFC3339Nano), Lines: lines}
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{"statement": statement})
}

func (s *BeneficiaryFinanceServer) listOperatorFinancialStatementSummaries(w http.ResponseWriter, r *http.Request) {
	if !s.authorizeAndRequireOperator(w, r) {
		return
	}
	actorType := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("actorType")))
	from, to := strings.TrimSpace(r.URL.Query().Get("from")), strings.TrimSpace(r.URL.Query().Get("to"))
	limit := 100
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 || parsed > 200 {
			writeError(w, http.StatusBadRequest, "INVALID_INPUT", "financial statement summary limit is invalid")
			return
		}
		limit = parsed
	}
	result, err := s.payment.ListFinancialStatementSummaries(r.Context(), actorType, from, to, r.URL.Query().Get("cursor"), limit, strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID")))
	if err != nil {
		writeWLTFinanceError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, result)
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
	ReceiptDocumentID         string `json:"receiptDocumentId"`
}

type transferReconcileInput struct {
	StatementRowID string `json:"statementRowId"`
}

type settlementStatementInput struct {
	BatchID            string `json:"batchId"`
	ProviderKey        string `json:"providerKey"`
	Currency           string `json:"currency"`
	PeriodStart        string `json:"periodStart"`
	PeriodEnd          string `json:"periodEnd"`
	EvidenceDocumentID string `json:"evidenceDocumentId"`
}

type settlementStatementRowInput struct {
	RowSequence               int    `json:"rowSequence"`
	ExternalTransferReference string `json:"externalTransferReference"`
	WalletIdentifier          string `json:"walletIdentifier"`
	AmountMinor               int64  `json:"amountMinor"`
	Currency                  string `json:"currency"`
	TransactionAt             string `json:"transactionAt"`
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

func (s *BeneficiaryFinanceServer) listOperatorSettlementBatches(w http.ResponseWriter, r *http.Request) {
	if !s.authorizeAndRequireOperator(w, r) {
		return
	}
	limit := 25
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 || parsed > 100 {
			writeError(w, http.StatusBadRequest, "INVALID_INPUT", "settlement batch limit is invalid")
			return
		}
		limit = parsed
	}
	result, err := s.payment.ListSettlementBatches(r.Context(), r.URL.Query().Get("status"), r.URL.Query().Get("cursor"), limit, strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID")))
	if err != nil {
		writeWLTFinanceError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, result)
}

func (s *BeneficiaryFinanceServer) listOperatorBeneficiaryPayoutStates(w http.ResponseWriter, r *http.Request) {
	if !s.authorizeAndRequireOperator(w, r) {
		return
	}
	limit := 50
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 || parsed > 100 {
			writeError(w, http.StatusBadRequest, "INVALID_INPUT", "beneficiary page limit is invalid")
			return
		}
		limit = parsed
	}
	result, err := s.payment.ListBeneficiaryPayoutStates(r.Context(), r.URL.Query().Get("actorType"), r.URL.Query().Get("search"), r.URL.Query().Get("status"), r.URL.Query().Get("sort"), r.URL.Query().Get("cursor"), limit, strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID")))
	if err != nil {
		writeWLTFinanceError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, result)
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

func (s *BeneficiaryFinanceServer) exportOperatorSettlementBatch(w http.ResponseWriter, r *http.Request) {
	acting, correlation, idempotency, ok := requiredMutationHeaders(w, r)
	if !ok || !s.authorizeAndRequireOperator(w, r) {
		return
	}
	var input struct{}
	if !decodeJSON(w, r, &input) {
		return
	}
	item, err := s.payment.ExportSettlementBatch(r.Context(), r.PathValue("batchId"), idempotency, correlation, acting)
	if err != nil {
		writeWLTFinanceError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"export": item})
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
	item, err := s.payment.RecordManualTransfer(r.Context(), r.PathValue("batchId"), input.PayoutID, input.ExternalTransferReference, input.ReceiptDocumentID, idempotency, correlation, acting)
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
	var input struct{}
	if !decodeJSON(w, r, &input) {
		return
	}
	item, err := s.payment.VerifyManualTransfer(r.Context(), r.PathValue("transferId"), idempotency, correlation, acting)
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
	item, err := s.payment.ReconcileManualTransfer(r.Context(), r.PathValue("transferId"), input.StatementRowID, idempotency, correlation, acting)
	if err != nil {
		writeWLTFinanceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"transfer": item})
}

func (s *BeneficiaryFinanceServer) uploadOperatorFinanceEvidence(w http.ResponseWriter, r *http.Request) {
	acting, correlation, idempotency, ok := requiredMutationHeaders(w, r)
	if !ok || !s.authorize(w, r) || !s.requireOperator(w, r.Context(), acting) || !s.requirePermission(w, r.Context(), acting, "finance") {
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 10*1024*1024+64*1024)
	if err := r.ParseMultipartForm(10 * 1024 * 1024); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_UPLOAD", "finance evidence upload is invalid or exceeds 10 MiB")
		return
	}
	purpose := strings.ToUpper(strings.TrimSpace(r.FormValue("purpose")))
	if purpose != "TRANSFER_RECEIPT" && purpose != "SETTLEMENT_STATEMENT" {
		writeError(w, http.StatusBadRequest, "INVALID_UPLOAD", "finance evidence purpose is invalid")
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
	document, err := s.payment.UploadFinanceEvidenceDocument(r.Context(), purpose, header.Filename, content, idempotency, correlation, acting)
	if err != nil {
		writeWLTFinanceError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"document": document})
}

func (s *BeneficiaryFinanceServer) readOperatorFinanceEvidence(w http.ResponseWriter, r *http.Request) {
	if !s.authorizeAndRequireOperator(w, r) {
		return
	}
	file, err := s.payment.ReadFinanceEvidenceDocument(r.Context(), r.PathValue("documentId"), strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID")))
	if err != nil {
		writeWLTFinanceError(w, err)
		return
	}
	w.Header().Set("Content-Type", file.ContentType)
	w.Header().Set("Content-Length", strconv.Itoa(len(file.Content)))
	w.Header().Set("Content-Disposition", "attachment; filename*=UTF-8''"+url.PathEscape(file.Filename))
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(file.Content)
}

func (s *BeneficiaryFinanceServer) registerOperatorSettlementStatement(w http.ResponseWriter, r *http.Request) {
	acting, correlation, idempotency, ok := requiredMutationHeaders(w, r)
	if !ok || !s.authorize(w, r) || !s.requireOperator(w, r.Context(), acting) || !s.requirePermission(w, r.Context(), acting, "finance") {
		return
	}
	var input settlementStatementInput
	if !decodeJSON(w, r, &input) {
		return
	}
	item, err := s.payment.RegisterSettlementStatement(r.Context(), map[string]any{"batchId": input.BatchID, "providerKey": input.ProviderKey, "currency": input.Currency, "periodStart": input.PeriodStart, "periodEnd": input.PeriodEnd, "evidenceDocumentId": input.EvidenceDocumentID}, idempotency, correlation, acting)
	if err != nil {
		writeWLTFinanceError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"statement": item})
}

func (s *BeneficiaryFinanceServer) recordOperatorStatementRow(w http.ResponseWriter, r *http.Request) {
	acting, correlation, idempotency, ok := requiredMutationHeaders(w, r)
	if !ok || !s.authorize(w, r) || !s.requireOperator(w, r.Context(), acting) || !s.requirePermission(w, r.Context(), acting, "finance") {
		return
	}
	var input settlementStatementRowInput
	if !decodeJSON(w, r, &input) {
		return
	}
	if _, err := time.Parse(time.RFC3339Nano, input.TransactionAt); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "statement transaction time is invalid")
		return
	}
	item, err := s.payment.RecordSettlementStatementRow(r.Context(), r.PathValue("statementId"), map[string]any{"rowSequence": input.RowSequence, "externalTransferReference": input.ExternalTransferReference, "walletIdentifier": input.WalletIdentifier, "amountMinor": input.AmountMinor, "currency": input.Currency, "transactionAt": input.TransactionAt}, idempotency, correlation, acting)
	if err != nil {
		writeWLTFinanceError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"row": item})
}
