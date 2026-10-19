package wlt

import (
	"context"
	"net/http"
	"net/url"
	"strings"
)

type SettlementIntakeStore struct {
	StoreID     string `json:"storeId"`
	AmountMinor int64  `json:"amountMinor"`
}
type SettlementIntake struct {
	ID                   string                  `json:"id"`
	ActorType            string                  `json:"actorType"`
	ActorID              string                  `json:"actorId"`
	RequestedBy          string                  `json:"requestedBy"`
	AmountMode           string                  `json:"amountMode"`
	RequestedAmountMinor *int64                  `json:"requestedAmountMinor,omitempty"`
	ResolvedAmountMinor  int64                   `json:"resolvedAmountMinor"`
	Currency             string                  `json:"currency"`
	StoreAllocations     []SettlementIntakeStore `json:"storeAllocations"`
	Status               string                  `json:"status"`
	PayoutReference      *string                 `json:"payoutReference,omitempty"`
	PayoutStatus         string                  `json:"payoutStatus,omitempty"`
	PayoutUpdatedAt      *string                 `json:"payoutUpdatedAt,omitempty"`
	CreatedAt            string                  `json:"createdAt"`
}
type SettlementIntakeInput struct {
	ActorType    string                  `json:"actorType"`
	ActorID      string                  `json:"actorId"`
	RequestedBy  string                  `json:"requestedBy"`
	AmountMode   string                  `json:"amountMode"`
	AmountMinor  *int64                  `json:"amountMinor,omitempty"`
	StoreIDs     []string                `json:"storeIds,omitempty"`
	StoreAmounts []SettlementIntakeStore `json:"storeAmounts,omitempty"`
}

func (c *Client) CreateSettlementIntake(ctx context.Context, input SettlementIntakeInput, idempotencyKey, correlationID string) (SettlementIntake, bool, error) {
	var response struct {
		Intake           SettlementIntake `json:"intake"`
		IdempotentReplay bool             `json:"idempotentReplay"`
	}
	err := c.request(ctx, http.MethodPost, "/wlt/v1/settlement-intakes", input, idempotencyKey, correlationID, 0, &response)
	return response.Intake, response.IdempotentReplay, err
}
func (c *Client) ListSettlementIntakes(ctx context.Context, actorType, actorID string) ([]SettlementIntake, error) {
	var response struct {
		Intakes []SettlementIntake `json:"intakes"`
	}
	path := "/wlt/v1/settlement-intakes/" + url.PathEscape(strings.TrimSpace(actorType)) + "/" + url.PathEscape(strings.TrimSpace(actorID))
	err := c.request(ctx, http.MethodGet, path, nil, "", "", 0, &response)
	return response.Intakes, err
}
func (c *Client) ReadSettlementIntake(ctx context.Context, id string) (SettlementIntake, error) {
	var response struct {
		Intake SettlementIntake `json:"intake"`
	}
	err := c.request(ctx, http.MethodGet, "/wlt/v1/settlement-intakes/by-id/"+url.PathEscape(strings.TrimSpace(id)), nil, "", "", 0, &response)
	return response.Intake, err
}
func (c *Client) ConvertSettlementIntake(ctx context.Context, id, payoutID, idempotencyKey, correlationID, operatorID string) (SettlementIntake, error) {
	var response struct {
		Intake SettlementIntake `json:"intake"`
	}
	err := c.requestWithActor(ctx, actorRequest{method: http.MethodPost, path: "/wlt/v1/operator/settlement-intakes/" + url.PathEscape(strings.TrimSpace(id)) + "/convert", body: map[string]any{"payoutReference": payoutID}, idempotencyKey: idempotencyKey, correlationID: correlationID, actingActorID: operatorID, target: &response})
	return response.Intake, err
}
func (c *Client) CancelSettlementIntake(ctx context.Context, id, reason, idempotencyKey, correlationID, operatorID string) (SettlementIntake, error) {
	var response struct {
		Intake SettlementIntake `json:"intake"`
	}
	err := c.requestWithActor(ctx, actorRequest{method: http.MethodPost, path: "/wlt/v1/operator/settlement-intakes/" + url.PathEscape(strings.TrimSpace(id)) + "/cancel", body: map[string]any{"reason": reason}, idempotencyKey: idempotencyKey, correlationID: correlationID, actingActorID: operatorID, target: &response})
	return response.Intake, err
}
func (c *Client) ListOperatorSettlementIntakes(ctx context.Context, actingActorID string) ([]SettlementIntake, error) {
	var response struct {
		Intakes []SettlementIntake `json:"intakes"`
	}
	err := c.requestWithActor(ctx, actorRequest{method: http.MethodGet, path: "/wlt/v1/operator/settlement-intakes?status=REQUESTED", actingActorID: actingActorID, target: &response})
	return response.Intakes, err
}
