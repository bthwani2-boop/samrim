package wlt

import (
	"context"
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

type StoreCommercialAgreementRate struct {
	FulfillmentMode   string `json:"fulfillmentMode"`
	CommissionRateBps int    `json:"commissionRateBps"`
}

type StoreCommercialAgreement struct {
	AgreementID              string                         `json:"agreementId"`
	StoreID                  string                         `json:"storeId"`
	PartnerActorID           string                         `json:"partnerActorId"`
	AgreementVersion         int                            `json:"agreementVersion"`
	Status                   string                         `json:"status"`
	Rates                    []StoreCommercialAgreementRate `json:"rates"`
	ProposedByActorID        string                         `json:"proposedByActorId"`
	ProposedAt               string                         `json:"proposedAt"`
	PartnerAcceptedByActorID *string                        `json:"partnerAcceptedByActorId"`
	PartnerAcceptedAt        *string                        `json:"partnerAcceptedAt"`
	FinanceApprovedByActorID *string                        `json:"financeApprovedByActorId"`
	FinanceApprovedAt        *string                        `json:"financeApprovedAt"`
	FinanceDecisionByActorID *string                        `json:"financeDecisionByActorId"`
	FinanceDecisionAt        *string                        `json:"financeDecisionAt"`
	FinanceDecisionReason    *string                        `json:"financeDecisionReason"`
	EffectiveAt              *string                        `json:"effectiveAt"`
	SupersededAt             *string                        `json:"supersededAt"`
	Reason                   string                         `json:"reason"`
}

type StoreCommercialAgreementPage struct {
	Agreements []StoreCommercialAgreement `json:"agreements"`
	NextCursor string                     `json:"nextCursor,omitempty"`
}

type ProposeStoreCommercialAgreementInput struct {
	StoreID                string
	PartnerActorID         string
	Rates                  []StoreCommercialAgreementRate
	ExpectedCurrentVersion int
	Reason                 string
}

type StoreCommercialAgreementDecision struct {
	AgreementVersion           int
	Decision                   string
	Reason                     string
	CurrentStorePartnerActorID string
	CurrentFulfillmentModes    []string
}

type storeCommercialAgreementResponse struct {
	Agreement        StoreCommercialAgreement `json:"agreement"`
	IdempotentReplay bool                     `json:"idempotentReplay"`
}

type storeCommercialAgreementListResponse struct {
	Agreements []StoreCommercialAgreement `json:"agreements"`
}

type storeCommercialAgreementPageResponse struct {
	Agreements []StoreCommercialAgreement `json:"agreements"`
	NextCursor string                     `json:"nextCursor,omitempty"`
}

func (c *Client) ProposeStoreCommercialAgreement(ctx context.Context, input ProposeStoreCommercialAgreementInput, idempotencyKey, correlationID, actingActorID string) (StoreCommercialAgreement, bool, error) {
	body := map[string]any{
		"storeId":                strings.TrimSpace(input.StoreID),
		"partnerActorId":         strings.TrimSpace(input.PartnerActorID),
		"rates":                  input.Rates,
		"expectedCurrentVersion": input.ExpectedCurrentVersion,
		"reason":                 strings.TrimSpace(input.Reason),
	}
	var response storeCommercialAgreementResponse
	err := c.requestWithActor(ctx, actorRequest{
		method:         http.MethodPost,
		path:           "/wlt/v1/store-commercial-agreements",
		body:           body,
		idempotencyKey: idempotencyKey,
		correlationID:  correlationID,
		actingActorID:  actingActorID,
		target:         &response,
	})
	return response.Agreement, response.IdempotentReplay, err
}

func (c *Client) ReadStoreCommercialAgreements(ctx context.Context, storeID string) ([]StoreCommercialAgreement, error) {
	query := url.Values{"storeId": {strings.TrimSpace(storeID)}}
	var response storeCommercialAgreementListResponse
	err := c.request(ctx, http.MethodGet, "/wlt/v1/store-commercial-agreements?"+query.Encode(), nil, "", "", 0, &response)
	return response.Agreements, err
}

func (c *Client) ListPartnerAcceptedStoreCommercialAgreements(ctx context.Context, cursor string, limit int) (StoreCommercialAgreementPage, error) {
	query := url.Values{"status": {"PARTNER_ACCEPTED"}}
	if limit > 0 {
		query.Set("limit", strconv.Itoa(limit))
	}
	if strings.TrimSpace(cursor) != "" {
		query.Set("cursor", strings.TrimSpace(cursor))
	}
	var response storeCommercialAgreementPageResponse
	err := c.request(ctx, http.MethodGet, "/wlt/v1/operator/store-commercial-agreements?"+query.Encode(), nil, "", "", 0, &response)
	return StoreCommercialAgreementPage{Agreements: response.Agreements, NextCursor: response.NextCursor}, err
}

func (c *Client) AcceptStoreCommercialAgreement(ctx context.Context, agreementID string, expectedAgreementVersion int, reason, idempotencyKey, correlationID, actingActorID string) (StoreCommercialAgreement, bool, error) {
	body := map[string]any{"expectedAgreementVersion": expectedAgreementVersion, "reason": strings.TrimSpace(reason)}
	var response storeCommercialAgreementResponse
	path := "/wlt/v1/store-commercial-agreements/" + url.PathEscape(strings.TrimSpace(agreementID)) + "/accept"
	err := c.requestWithActor(ctx, actorRequest{
		method:         http.MethodPost,
		path:           path,
		body:           body,
		idempotencyKey: idempotencyKey,
		correlationID:  correlationID,
		actingActorID:  actingActorID,
		target:         &response,
	})
	return response.Agreement, response.IdempotentReplay, err
}

func (c *Client) DecideStoreCommercialAgreement(ctx context.Context, agreementID string, input StoreCommercialAgreementDecision, idempotencyKey, correlationID, actingActorID string) (StoreCommercialAgreement, bool, error) {
	body := map[string]any{
		"expectedAgreementVersion": input.AgreementVersion,
		"decision":                 strings.ToUpper(strings.TrimSpace(input.Decision)),
		"reason":                   strings.TrimSpace(input.Reason),
	}
	if strings.TrimSpace(input.CurrentStorePartnerActorID) != "" || len(input.CurrentFulfillmentModes) > 0 {
		body["currentStorePartnerActorId"] = strings.TrimSpace(input.CurrentStorePartnerActorID)
		body["currentFulfillmentModes"] = input.CurrentFulfillmentModes
	}
	var response storeCommercialAgreementResponse
	path := "/wlt/v1/operator/store-commercial-agreements/" + url.PathEscape(strings.TrimSpace(agreementID)) + "/decision"
	err := c.requestWithActor(ctx, actorRequest{
		method:         http.MethodPost,
		path:           path,
		body:           body,
		idempotencyKey: idempotencyKey,
		correlationID:  correlationID,
		actingActorID:  actingActorID,
		target:         &response,
	})
	return response.Agreement, response.IdempotentReplay, err
}
