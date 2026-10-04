package wlt

import (
	"context"
	"net/http"
	"net/url"
	"strings"
)

type StoreTypeCommissionDefault struct {
	CommercialStoreTypeID      string `json:"commercialStoreTypeId"`
	FulfillmentMode            string `json:"fulfillmentMode"`
	SuggestedCommissionRateBps int    `json:"suggestedCommissionRateBps"`
	DefaultVersion             int    `json:"defaultVersion"`
	UpdatedAt                  string `json:"updatedAt"`
	ChangedByActorID           string `json:"changedByActorId,omitempty"`
	ChangeReason               string `json:"changeReason,omitempty"`
}

type StoreTypeCommissionDefaultsResponse struct {
	CommercialStoreTypeID string                       `json:"commercialStoreTypeId"`
	Defaults              []StoreTypeCommissionDefault `json:"defaults"`
}

type StoreTypeCommissionDefaultUpdateInput struct {
	CommercialStoreTypeID      string
	FulfillmentMode            string
	SuggestedCommissionRateBps int
	ExpectedDefaultVersion     int
	Reason                     string
	IdempotencyKey             string
	CorrelationID              string
	ActingActorID              string
}

type StoreTypeCommissionDefaultUpdateResponse struct {
	Default          StoreTypeCommissionDefault `json:"default"`
	IdempotentReplay bool                       `json:"idempotentReplay"`
}

func (c *Client) ReadStoreTypeCommissionDefaults(ctx context.Context, commercialStoreTypeID string) (StoreTypeCommissionDefaultsResponse, error) {
	typeID := strings.TrimSpace(commercialStoreTypeID)
	if typeID == "" || len(typeID) > 128 {
		return StoreTypeCommissionDefaultsResponse{}, &Error{Status: http.StatusBadRequest, Code: "INVALID_INPUT", Message: "commercial Store Type is required"}
	}
	query := url.Values{"commercialStoreTypeId": {typeID}}
	var response StoreTypeCommissionDefaultsResponse
	err := c.request(ctx, http.MethodGet, "/wlt/v1/operator/commercial-store-type-commission-defaults?"+query.Encode(), nil, "", "", 0, &response)
	return response, err
}

func (c *Client) UpdateStoreTypeCommissionDefault(ctx context.Context, input StoreTypeCommissionDefaultUpdateInput) (StoreTypeCommissionDefaultUpdateResponse, error) {
	body := map[string]any{
		"commercialStoreTypeId":      strings.TrimSpace(input.CommercialStoreTypeID),
		"fulfillmentMode":            strings.TrimSpace(input.FulfillmentMode),
		"suggestedCommissionRateBps": input.SuggestedCommissionRateBps,
		"expectedDefaultVersion":     input.ExpectedDefaultVersion,
		"reason":                     strings.TrimSpace(input.Reason),
	}
	var response StoreTypeCommissionDefaultUpdateResponse
	err := c.requestWithActor(ctx, actorRequest{
		method: http.MethodPost, path: "/wlt/v1/operator/commercial-store-type-commission-defaults", body: body,
		idempotencyKey: input.IdempotencyKey, correlationID: input.CorrelationID, expectedVersion: 0,
		actingActorID: input.ActingActorID, target: &response,
	})
	return response, err
}
