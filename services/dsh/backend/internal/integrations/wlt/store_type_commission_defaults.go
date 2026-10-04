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
	ChangedByActorID           string `json:"changedByActorId,omitempty"`
	ChangeReason               string `json:"changeReason,omitempty"`
}

type StoreTypeCommissionDefaultsResponse struct {
	CommercialStoreTypeID string                       `json:"commercialStoreTypeId"`
	Defaults              []StoreTypeCommissionDefault `json:"defaults"`
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
