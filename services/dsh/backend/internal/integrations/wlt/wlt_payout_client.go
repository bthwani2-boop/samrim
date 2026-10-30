package wlt

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"net/url"
	"path/filepath"
	"strconv"
	"strings"
)

func (c *Client) ReadFinancialStatement(ctx context.Context, actorType, actorID, from, to, cursor string, limit int, actingActorID string) (FinancialStatement, error) {
	query := url.Values{}
	query.Set("from", strings.TrimSpace(from))
	query.Set("to", strings.TrimSpace(to))
	if strings.TrimSpace(cursor) != "" {
		query.Set("cursor", strings.TrimSpace(cursor))
	}
	if limit > 0 {
		query.Set("limit", strconv.Itoa(limit))
	}
	path := "/wlt/v1/operator/beneficiaries/" + url.PathEscape(strings.TrimSpace(actorType)) + "/" + url.PathEscape(strings.TrimSpace(actorID)) + "/financial-statement?" + query.Encode()
	var response FinancialStatement
	err := c.requestWithActor(ctx, actorRequest{method: http.MethodGet, path: path, body: nil, idempotencyKey: "", correlationID: "", expectedVersion: 0, actingActorID: actingActorID, target: &response})
	return response, err
}

func (c *Client) ListFinancialStatementSummaries(ctx context.Context, actorType, from, to, cursor string, limit int, actingActorID string) (FinancialStatementSummaryRegistry, error) {
	query := url.Values{"actorType": {strings.TrimSpace(actorType)}, "from": {strings.TrimSpace(from)}, "to": {strings.TrimSpace(to)}}
	if strings.TrimSpace(cursor) != "" {
		query.Set("cursor", strings.TrimSpace(cursor))
	}
	if limit > 0 {
		query.Set("limit", strconv.Itoa(limit))
	}
	var response FinancialStatementSummaryRegistry
	err := c.requestWithActor(ctx, actorRequest{method: http.MethodGet, path: "/wlt/v1/operator/financial-statements?" + query.Encode(), body: nil, idempotencyKey: "", correlationID: "", expectedVersion: 0, actingActorID: actingActorID, target: &response})
	return response, err
}

func (c *Client) ReadOperatorPayoutRequest(ctx context.Context, payoutID, actingActorID string) (PayoutRequest, error) {
	var response payoutRequestResponse
	err := c.requestWithActor(ctx, actorRequest{method: http.MethodGet, path: payoutRequestsPath + "/" + url.PathEscape(strings.TrimSpace(payoutID)), body: nil, idempotencyKey: "", correlationID: "", expectedVersion: 0, actingActorID: actingActorID, target: &response})
	return response.Payout, err
}

func (c *Client) PreparePayout(ctx context.Context, payoutID string, identityFacts IdentityFacts, reason, evidenceReference, idempotencyKey, correlationID, actingActorID string) (PayoutRequest, error) {
	body := map[string]any{"identityFacts": identityFacts, "reason": strings.TrimSpace(reason), "evidenceReference": strings.TrimSpace(evidenceReference)}
	var response payoutRequestResponse
	err := c.requestWithActor(ctx, actorRequest{method: http.MethodPost, path: payoutRequestsPath + "/" + url.PathEscape(strings.TrimSpace(payoutID)) + "/prepare", body: body, idempotencyKey: idempotencyKey, correlationID: correlationID, expectedVersion: 0, actingActorID: actingActorID, target: &response})
	return response.Payout, err
}

func (c *Client) ApprovePayout(ctx context.Context, payoutID string, identityFacts IdentityFacts, reason, idempotencyKey, correlationID, actingActorID string) (PayoutRequest, error) {
	body := map[string]any{"identityFacts": identityFacts, "reason": strings.TrimSpace(reason)}
	var response payoutRequestResponse
	err := c.requestWithActor(ctx, actorRequest{method: http.MethodPost, path: payoutRequestsPath + "/" + url.PathEscape(strings.TrimSpace(payoutID)) + "/approve", body: body, idempotencyKey: idempotencyKey, correlationID: correlationID, expectedVersion: 0, actingActorID: actingActorID, target: &response})
	return response.Payout, err
}

func (c *Client) CancelPayout(ctx context.Context, payoutID, reason, idempotencyKey, correlationID, actingActorID string) (PayoutRequest, error) {
	body := map[string]any{"reason": strings.TrimSpace(reason)}
	var response payoutRequestResponse
	err := c.requestWithActor(ctx, actorRequest{method: http.MethodPost, path: payoutRequestsPath + "/" + url.PathEscape(strings.TrimSpace(payoutID)) + "/cancel", body: body, idempotencyKey: idempotencyKey, correlationID: correlationID, expectedVersion: 0, actingActorID: actingActorID, target: &response})
	return response.Payout, err
}

func (c *Client) CreateSettlementBatch(ctx context.Context, payoutIDs []string, identityFactsByBeneficiary []IdentityFacts, idempotencyKey, correlationID, actingActorID string) (SettlementBatch, error) {
	body := map[string]any{"payoutIds": payoutIDs, "identityFactsByBeneficiary": identityFactsByBeneficiary}
	var response settlementBatchResponse
	err := c.requestWithActor(ctx, actorRequest{method: http.MethodPost, path: settlementBatchesPath, body: body, idempotencyKey: idempotencyKey, correlationID: correlationID, expectedVersion: 0, actingActorID: actingActorID, target: &response})
	return response.Batch, err
}

func (c *Client) ListSettlementBatches(ctx context.Context, status, cursor string, limit int, actingActorID string) (SettlementBatchRegistry, error) {
	query := url.Values{}
	if strings.TrimSpace(status) != "" {
		query.Set("status", strings.TrimSpace(status))
	}
	if strings.TrimSpace(cursor) != "" {
		query.Set("cursor", strings.TrimSpace(cursor))
	}
	if limit > 0 {
		query.Set("limit", strconv.Itoa(limit))
	}
	path := settlementBatchesPath
	if encoded := query.Encode(); encoded != "" {
		path += "?" + encoded
	}
	var response SettlementBatchRegistry
	err := c.requestWithActor(ctx, actorRequest{method: http.MethodGet, path: path, body: nil, idempotencyKey: "", correlationID: "", expectedVersion: 0, actingActorID: actingActorID, target: &response})
	return response, err
}

func (c *Client) ReadSettlementBatch(ctx context.Context, batchID, actingActorID string) (SettlementBatch, error) {
	var response settlementBatchResponse
	err := c.requestWithActor(ctx, actorRequest{method: http.MethodGet, path: settlementBatchesPath + "/" + url.PathEscape(strings.TrimSpace(batchID)), body: nil, idempotencyKey: "", correlationID: "", expectedVersion: 0, actingActorID: actingActorID, target: &response})
	return response.Batch, err
}

func (c *Client) ExportSettlementBatch(ctx context.Context, batchID string, identityFactsByBeneficiary []IdentityFacts, idempotencyKey, correlationID, actingActorID string) (SettlementBatchExport, error) {
	var response settlementBatchExportResponse
	path := settlementBatchesPath + "/" + url.PathEscape(strings.TrimSpace(batchID)) + "/export"
	body := map[string]any{"identityFactsByBeneficiary": identityFactsByBeneficiary}
	err := c.requestWithActor(ctx, actorRequest{method: http.MethodPost, path: path, body: body, idempotencyKey: idempotencyKey, correlationID: correlationID, expectedVersion: 0, actingActorID: actingActorID, target: &response})
	return response.Export, err
}

func (c *Client) ApproveSettlementBatch(ctx context.Context, batchID string, identityFactsByBeneficiary []IdentityFacts, reason, idempotencyKey, correlationID, actingActorID string) (SettlementBatch, error) {
	var response settlementBatchResponse
	body := map[string]any{"identityFactsByBeneficiary": identityFactsByBeneficiary, "reason": strings.TrimSpace(reason)}
	err := c.requestWithActor(ctx, actorRequest{method: http.MethodPost, path: settlementBatchesPath + "/" + url.PathEscape(strings.TrimSpace(batchID)) + "/approve", body: body, idempotencyKey: idempotencyKey, correlationID: correlationID, expectedVersion: 0, actingActorID: actingActorID, target: &response})
	return response.Batch, err
}

func (c *Client) FreezeSettlementBatch(ctx context.Context, batchID string, identityFactsByBeneficiary []IdentityFacts, reason, idempotencyKey, correlationID, actingActorID string) (SettlementBatch, error) {
	var response settlementBatchResponse
	body := map[string]any{"identityFactsByBeneficiary": identityFactsByBeneficiary, "reason": strings.TrimSpace(reason)}
	err := c.requestWithActor(ctx, actorRequest{method: http.MethodPost, path: settlementBatchesPath + "/" + url.PathEscape(strings.TrimSpace(batchID)) + "/freeze", body: body, idempotencyKey: idempotencyKey, correlationID: correlationID, expectedVersion: 0, actingActorID: actingActorID, target: &response})
	return response.Batch, err
}

func (c *Client) RecordManualTransfer(ctx context.Context, batchID, payoutID, externalReference, receiptDocumentID, idempotencyKey, correlationID, actingActorID string) (ManualTransferExecution, error) {
	body := map[string]any{"payoutId": strings.TrimSpace(payoutID), "externalTransferReference": strings.TrimSpace(externalReference), "receiptDocumentId": strings.TrimSpace(receiptDocumentID)}
	var response transferResponse
	err := c.requestWithActor(ctx, actorRequest{method: http.MethodPost, path: settlementBatchesPath + "/" + url.PathEscape(strings.TrimSpace(batchID)) + "/transfers", body: body, idempotencyKey: idempotencyKey, correlationID: correlationID, expectedVersion: 0, actingActorID: actingActorID, target: &response})
	return response.Transfer, err
}

func (c *Client) VerifyManualTransfer(ctx context.Context, transferID, idempotencyKey, correlationID, actingActorID string) (ManualTransferExecution, error) {
	var response transferResponse
	err := c.requestWithActor(ctx, actorRequest{method: http.MethodPost, path: "/wlt/v1/operator/transfers/" + url.PathEscape(strings.TrimSpace(transferID)) + "/verify", body: map[string]any{}, idempotencyKey: idempotencyKey, correlationID: correlationID, expectedVersion: 0, actingActorID: actingActorID, target: &response})
	return response.Transfer, err
}

func (c *Client) ReconcileManualTransfer(ctx context.Context, transferID, statementRowID, idempotencyKey, correlationID, actingActorID string) (ManualTransferExecution, error) {
	var response transferResponse
	err := c.requestWithActor(ctx, actorRequest{method: http.MethodPost, path: "/wlt/v1/operator/transfers/" + url.PathEscape(strings.TrimSpace(transferID)) + "/reconcile", body: map[string]any{"statementRowId": strings.TrimSpace(statementRowID)}, idempotencyKey: idempotencyKey, correlationID: correlationID, expectedVersion: 0, actingActorID: actingActorID, target: &response})
	return response.Transfer, err
}

func (c *Client) RegisterSettlementStatement(ctx context.Context, input map[string]any, idempotencyKey, correlationID, actingActorID string) (SettlementStatement, error) {
	var response settlementStatementResponse
	err := c.requestWithActor(ctx, actorRequest{method: http.MethodPost, path: "/wlt/v1/operator/settlement-statements", body: input, idempotencyKey: idempotencyKey, correlationID: correlationID, expectedVersion: 0, actingActorID: actingActorID, target: &response})
	return response.Statement, err
}

func (c *Client) RecordSettlementStatementRow(ctx context.Context, statementID string, input map[string]any, idempotencyKey, correlationID, actingActorID string) (SettlementStatementRow, error) {
	var response settlementStatementRowResponse
	path := "/wlt/v1/operator/settlement-statements/" + url.PathEscape(strings.TrimSpace(statementID)) + "/rows"
	err := c.requestWithActor(ctx, actorRequest{method: http.MethodPost, path: path, body: input, idempotencyKey: idempotencyKey, correlationID: correlationID, expectedVersion: 0, actingActorID: actingActorID, target: &response})
	return response.Row, err
}

func (c *Client) UploadFinanceEvidenceDocument(ctx context.Context, purpose, filename string, content []byte, idempotencyKey, correlationID, actingActorID string) (FinanceEvidenceDocument, error) {
	if c == nil || c.httpClient == nil || strings.TrimSpace(c.baseURL) == "" || strings.TrimSpace(c.serviceToken) == "" || len(content) == 0 || len(content) > 10*1024*1024 {
		return FinanceEvidenceDocument{}, errors.New("WLT evidence upload is not configured or has invalid content")
	}
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	if err := writer.WriteField("purpose", strings.TrimSpace(purpose)); err != nil {
		return FinanceEvidenceDocument{}, err
	}
	part, err := writer.CreateFormFile("file", filepath.Base(filename))
	if err != nil {
		return FinanceEvidenceDocument{}, err
	}
	if _, err := part.Write(content); err != nil {
		return FinanceEvidenceDocument{}, err
	}
	if err := writer.Close(); err != nil {
		return FinanceEvidenceDocument{}, err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/wlt/v1/operator/finance-evidence-documents", &body)
	if err != nil {
		return FinanceEvidenceDocument{}, err
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("Authorization", "Bearer "+c.serviceToken)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	request.Header.Set("X-Acting-Actor-ID", strings.TrimSpace(actingActorID))
	request.Header.Set("Idempotency-Key", strings.TrimSpace(idempotencyKey))
	request.Header.Set("X-Correlation-ID", strings.TrimSpace(correlationID))
	response, err := c.httpClient.Do(request)
	if err != nil {
		return FinanceEvidenceDocument{}, err
	}
	defer response.Body.Close()
	if !targetedStatus(response.StatusCode) {
		return FinanceEvidenceDocument{}, wltResponseError(response)
	}
	var result financeEvidenceDocumentResponse
	err = json.NewDecoder(response.Body).Decode(&result)
	return result.Document, err
}

func (c *Client) ReadFinanceEvidenceDocument(ctx context.Context, documentID, actingActorID string) (FinanceEvidenceFile, error) {
	if c == nil || c.httpClient == nil || strings.TrimSpace(c.baseURL) == "" || strings.TrimSpace(c.serviceToken) == "" {
		return FinanceEvidenceFile{}, errors.New("WLT client is not configured")
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+"/wlt/v1/operator/finance-evidence-documents/"+url.PathEscape(strings.TrimSpace(documentID)), nil)
	if err != nil {
		return FinanceEvidenceFile{}, err
	}
	request.Header.Set("Accept", "application/octet-stream")
	request.Header.Set("Authorization", "Bearer "+c.serviceToken)
	request.Header.Set("X-Acting-Actor-ID", strings.TrimSpace(actingActorID))
	response, err := c.httpClient.Do(request)
	if err != nil {
		return FinanceEvidenceFile{}, err
	}
	defer response.Body.Close()
	if !targetedStatus(response.StatusCode) {
		return FinanceEvidenceFile{}, wltResponseError(response)
	}
	content, err := io.ReadAll(io.LimitReader(response.Body, 10*1024*1024+1))
	if err != nil || len(content) > 10*1024*1024 {
		return FinanceEvidenceFile{}, errors.New("WLT evidence response is invalid")
	}
	_, params, _ := mime.ParseMediaType(response.Header.Get("Content-Disposition"))
	return FinanceEvidenceFile{Filename: params["filename"], ContentType: response.Header.Get("Content-Type"), Content: content}, nil
}

func wltResponseError(response *http.Response) error {
	var payload struct {
		Error struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	_ = json.NewDecoder(response.Body).Decode(&payload)
	return &Error{Status: response.StatusCode, Code: payload.Error.Code, Message: payload.Error.Message}
}
