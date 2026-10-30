package wlt

import (
	"context"
	"net/http"
	"net/url"
	"strings"
)

func (c *Client) QuoteDeliveryFee(ctx context.Context, input DeliveryFeeQuoteInput) (DeliveryFeeQuote, error) {
	var response deliveryFeeQuoteResponse
	err := c.request(ctx, http.MethodPost, "/wlt/v1/delivery-quotes", input, "", "", 0, &response)
	return response.Quote, err
}

func (c *Client) ReadDeliveryFeePolicy(ctx context.Context, serviceCityID string) (DeliveryFeePolicy, error) {
	var response deliveryFeePolicyResponse
	path := "/wlt/v1/operator/delivery-fee-policies?serviceCityId=" + url.QueryEscape(strings.TrimSpace(serviceCityID))
	err := c.request(ctx, http.MethodGet, path, nil, "", "", 0, &response)
	return response.Policy, err
}

func (c *Client) ReadPartnerFinancialTermsPolicy(ctx context.Context) (PartnerFinancialTermsPolicy, error) {
	var response partnerFinancialTermsPolicyResponse
	err := c.request(ctx, http.MethodGet, "/wlt/v1/operator/partner-financial-terms-policy", nil, "", "", 0, &response)
	return response.Policy, err
}

func (c *Client) CreatePartnerFinancialTermsPolicy(ctx context.Context, settlementPeriod string, expectedVersion int, reason, idempotencyKey, correlationID, actingActorID string) (PartnerFinancialTermsPolicy, bool, error) {
	body := map[string]any{"settlementPeriod": strings.ToUpper(strings.TrimSpace(settlementPeriod)), "expectedVersion": expectedVersion, "reason": strings.TrimSpace(reason)}
	var response partnerFinancialTermsPolicyResponse
	err := c.requestWithActor(ctx, actorRequest{method: http.MethodPost, path: "/wlt/v1/operator/partner-financial-terms-policy", body: body, idempotencyKey: idempotencyKey, correlationID: correlationID, expectedVersion: 0, actingActorID: actingActorID, target: &response})
	return response.Policy, response.IdempotentReplay, err
}

func (c *Client) CreateDeliveryFeePolicy(ctx context.Context, policy DeliveryFeePolicy, expectedVersion int, reason, idempotencyKey, correlationID, actingActorID string) (DeliveryFeePolicy, bool, error) {
	body := map[string]any{
		"serviceCityId":          strings.TrimSpace(policy.ServiceCityID),
		"baseFeeMinor":           policy.BaseFeeMinor,
		"distanceUnitMeters":     policy.DistanceUnitMeters,
		"distanceRateMinor":      policy.DistanceRateMinor,
		"orderSizeUnitBaseUnits": policy.OrderSizeUnitBaseUnits,
		"orderSizeRateMinor":     policy.OrderSizeRateMinor,
		"zoneSurchargeMinor":     policy.ZoneSurchargeMinor,
		"roundingUnitMinor":      policy.RoundingUnitMinor,
		"expectedVersion":        expectedVersion,
		"reason":                 strings.TrimSpace(reason),
	}
	var response deliveryFeePolicyResponse
	err := c.requestWithActor(ctx, actorRequest{method: http.MethodPost, path: "/wlt/v1/operator/delivery-fee-policies", body: body, idempotencyKey: idempotencyKey, correlationID: correlationID, expectedVersion: 0, actingActorID: actingActorID, target: &response})
	return response.Policy, response.IdempotentReplay, err
}
