package wlt

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"unicode/utf8"
)

func (c *Client) PreparePartnerFinancialProfile(ctx context.Context, input PreparePartnerFinancialProfileInput) (PartnerFinancialProfile, bool, error) {
	body := map[string]any{
		"joiningCaseId":      input.JoiningCaseID,
		"partnerActorId":     input.PartnerActorID,
		"origin":             input.Origin,
		"settlementPeriod":   input.SettlementPeriod,
		"termsPolicyVersion": input.TermsPolicyVersion,
	}
	var response partnerFinancialProfileResponse
	err := c.request(ctx, http.MethodPost, "/wlt/v1/partner-financial-profiles", body, input.IdempotencyKey, input.CorrelationID, 0, &response)
	return response.Profile, response.IdempotentReplay, err
}

func (c *Client) ReadPartnerFinancialProfile(ctx context.Context, profileID string) (PartnerFinancialProfile, error) {
	var response partnerFinancialProfileResponse
	err := c.request(ctx, http.MethodGet, "/wlt/v1/partner-financial-profiles/"+url.PathEscape(strings.TrimSpace(profileID)), nil, "", "", 0, &response)
	return response.Profile, err
}

func (c *Client) ActivatePartnerFinancialProfile(ctx context.Context, profileID string, expectedVersion int, idempotencyKey, correlationID, actingActorID string) (PartnerFinancialProfile, bool, error) {
	var response partnerFinancialProfileResponse
	err := c.requestWithActor(ctx, actorRequest{method: http.MethodPost, path: "/wlt/v1/partner-financial-profiles/" + url.PathEscape(strings.TrimSpace(profileID)) + "/activate", body: map[string]any{}, idempotencyKey: idempotencyKey, correlationID: correlationID, expectedVersion: expectedVersion, actingActorID: actingActorID, target: &response})
	return response.Profile, response.IdempotentReplay, err
}

func (c *Client) FinalizePartnerOrderEarning(ctx context.Context, orderID, paymentIntentID, partnerActorID, captainActorID, idempotencyKey, correlationID string) (PartnerOrderEarning, bool, error) {
	body := map[string]any{"orderId": strings.TrimSpace(orderID), "paymentIntentId": strings.TrimSpace(paymentIntentID), "partnerActorId": strings.TrimSpace(partnerActorID), "captainActorId": strings.TrimSpace(captainActorID)}
	var response partnerOrderEarningResponse
	err := c.request(ctx, http.MethodPost, "/wlt/v1/partner-order-earnings/finalize", body, idempotencyKey, correlationID, 0, &response)
	return response.Earning, response.IdempotentReplay, err
}

func (c *Client) FinalizePartnerStoreCashCommission(ctx context.Context, orderID, paymentIntentID, partnerActorID, fulfillmentMode, idempotencyKey, correlationID string) (PartnerStoreCashCommission, bool, error) {
	body := map[string]any{"orderId": strings.TrimSpace(orderID), "paymentIntentId": strings.TrimSpace(paymentIntentID), "partnerActorId": strings.TrimSpace(partnerActorID), "fulfillmentMode": strings.TrimSpace(fulfillmentMode)}
	var response partnerStoreCashCommissionResponse
	err := c.request(ctx, http.MethodPost, "/wlt/v1/partner-store-cash-commissions/finalize", body, idempotencyKey, correlationID, 0, &response)
	return response.Commission, response.IdempotentReplay, err
}

func (c *Client) RecordPartnerCommissionRemittance(ctx context.Context, partnerActorID string, amountMinor int64, remittanceReference, evidenceDocumentID, idempotencyKey, correlationID, actingActorID string) (PartnerCommissionRemittance, bool, error) {
	body := map[string]any{"amountMinor": amountMinor, "remittanceReference": strings.TrimSpace(remittanceReference), "evidenceDocumentId": strings.TrimSpace(evidenceDocumentID)}
	var response partnerCommissionRemittanceResponse
	err := c.requestWithActor(ctx, actorRequest{method: http.MethodPost, path: "/wlt/v1/operator/partners/" + url.PathEscape(strings.TrimSpace(partnerActorID)) + "/commission-remittances", body: body, idempotencyKey: idempotencyKey, correlationID: correlationID, expectedVersion: 0, actingActorID: actingActorID, target: &response})
	return response.Remittance, response.IdempotentReplay, err
}

type PartnerActivity struct {
	ID                  string `json:"id"`
	Kind                string `json:"kind"`
	StoreID             string `json:"storeId"`
	Status              string `json:"status"`
	PaymentMethod       string `json:"paymentMethod"`
	Direction           string `json:"direction"`
	GrossMinor          int64  `json:"grossMinor"`
	CommissionMinor     int64  `json:"commissionMinor"`
	OffsetMinor         int64  `json:"offsetMinor"`
	AmountMinor         int64  `json:"amountMinor"`
	Currency            string `json:"currency"`
	LedgerTransactionID string `json:"ledgerTransactionId"`
	CreatedAt           string `json:"createdAt"`
}
type PartnerActivityPage struct {
	Items      []PartnerActivity `json:"items"`
	NextCursor string            `json:"nextCursor,omitempty"`
}
type PartnerActivityFilters struct {
	StoreIDs      []string
	Kind          string
	Status        string
	PaymentMethod string
	Search        string
	From          string
	To            string
	Cursor        string
	Limit         int
}

func (c *Client) ListPartnerActivity(ctx context.Context, owner string, q PartnerActivityFilters) (PartnerActivityPage, error) {
	if strings.TrimSpace(owner) == "" || len(q.StoreIDs) == 0 {
		return PartnerActivityPage{}, fmt.Errorf("store-scoped financial activity is required")
	}
	values := url.Values{}
	for _, id := range q.StoreIDs {
		values.Add("storeId", id)
	}
	values.Set("limit", strconv.Itoa(q.Limit))
	if q.Kind != "" {
		values.Set("kind", q.Kind)
	}
	if q.Status != "" {
		values.Set("status", q.Status)
	}
	if q.PaymentMethod != "" {
		values.Set("paymentMethod", q.PaymentMethod)
	}
	if q.Search != "" {
		values.Set("search", q.Search)
	}
	if q.From != "" {
		values.Set("from", q.From)
	}
	if q.To != "" {
		values.Set("to", q.To)
	}
	if q.Cursor != "" {
		values.Set("cursor", q.Cursor)
	}
	var response PartnerActivityPage
	err := c.request(ctx, http.MethodGet, "/wlt/v1/partners/"+url.PathEscape(strings.TrimSpace(owner))+"/financial-activity?"+values.Encode(), nil, "", "", 0, &response)
	return response, err
}

func (c *Client) ReadPartnerFinancialSummary(ctx context.Context, partnerActorID string) (PartnerFinancialSummary, error) {
	var response partnerFinancialSummaryResponse
	err := c.request(ctx, http.MethodGet, "/wlt/v1/partners/"+url.PathEscape(strings.TrimSpace(partnerActorID))+"/financial-summary", nil, "", "", 0, &response)
	return response.Summary, err
}

func (c *Client) ReadPartnerFinancialSummaryForStores(ctx context.Context, partnerActorID string, storeIDs []string) (PartnerFinancialSummary, error) {
	if len(storeIDs) == 0 {
		return PartnerFinancialSummary{}, fmt.Errorf("explicit Store scope is required")
	}
	query := url.Values{}
	for _, storeID := range storeIDs {
		query.Add("storeId", storeID)
	}
	var response partnerFinancialSummaryResponse
	err := c.request(ctx, http.MethodGet, "/wlt/v1/partners/"+url.PathEscape(partnerActorID)+"/financial-summary?"+query.Encode(), nil, "", "", 0, &response)
	return response.Summary, err
}

func (c *Client) ListPartnerCommissionReceivables(ctx context.Context, actingActorID, search, sortKey, cursor string, limit int) (PartnerCommissionReceivableRegistry, error) {
	actingActorID = strings.TrimSpace(actingActorID)
	search = strings.TrimSpace(search)
	sortKey = strings.ToLower(strings.TrimSpace(sortKey))
	if actingActorID == "" || utf8.RuneCountInString(search) > 128 || (sortKey != "actor_asc" && sortKey != "actor_desc") || len(cursor) > 1024 || limit < 1 || limit > 100 {
		return PartnerCommissionReceivableRegistry{}, errors.New("partner commission receivable registry input is invalid")
	}
	query := url.Values{"limit": {strconv.Itoa(limit)}, "sort": {sortKey}}
	if search != "" {
		query.Set("search", search)
	}
	if cursor != "" {
		query.Set("cursor", cursor)
	}
	var response PartnerCommissionReceivableRegistry
	err := c.requestWithActor(ctx, actorRequest{method: http.MethodGet, path: "/wlt/v1/operator/partner-commission-receivables?" + query.Encode(), body: nil, idempotencyKey: "", correlationID: "", expectedVersion: 0, actingActorID: actingActorID, target: &response})
	return response, err
}
