package wlt

import (
	"context"
	"net/http"
	"net/url"
	"strings"
)

type LegacyCODRecoveryReview struct {
	ID                 string  `json:"id"`
	OrderID            string  `json:"orderId"`
	PaymentIntentID    string  `json:"paymentIntentId"`
	CaptainActorID     string  `json:"captainActorId"`
	AmountMinor        int64   `json:"amountMinor"`
	EvidenceDocumentID string  `json:"evidenceDocumentId"`
	SubmittedBy        string  `json:"submittedBy"`
	Status             string  `json:"status"`
	ApprovedBy         string  `json:"approvedBy,omitempty"`
	ReservationID      string  `json:"reservationId,omitempty"`
	CreatedAt          string  `json:"createdAt"`
	ApprovedAt         *string `json:"approvedAt,omitempty"`
}

type LegacyCODRecoveryResponse struct {
	Review           LegacyCODRecoveryReview `json:"review"`
	IdempotentReplay bool                    `json:"idempotentReplay,omitempty"`
}

func (c *Client) SubmitLegacyCODRecovery(ctx context.Context, paymentIntentID, evidenceDocumentID, actorID, idempotencyKey, correlationID string) (LegacyCODRecoveryResponse, error) {
	var response LegacyCODRecoveryResponse
	err := c.requestWithActor(ctx, actorRequest{
		method: http.MethodPost, path: "/wlt/v1/operator/captain-cod-legacy-reviews",
		body:          map[string]any{"paymentIntentId": strings.TrimSpace(paymentIntentID), "evidenceDocumentId": strings.TrimSpace(evidenceDocumentID)},
		actingActorID: strings.TrimSpace(actorID), idempotencyKey: idempotencyKey, correlationID: correlationID, target: &response,
	})
	return response, err
}

func (c *Client) ReadLegacyCODRecoveryByPayment(ctx context.Context, paymentIntentID, actorID string) (LegacyCODRecoveryResponse, error) {
	var response LegacyCODRecoveryResponse
	err := c.requestWithActor(ctx, actorRequest{
		method: http.MethodGet, path: "/wlt/v1/operator/captain-cod-legacy-reviews/by-payment/" + url.PathEscape(strings.TrimSpace(paymentIntentID)),
		actingActorID: strings.TrimSpace(actorID), target: &response,
	})
	return response, err
}

func (c *Client) ApproveLegacyCODRecovery(ctx context.Context, reviewID, actorID, idempotencyKey, correlationID string) (LegacyCODRecoveryResponse, error) {
	var response LegacyCODRecoveryResponse
	err := c.requestWithActor(ctx, actorRequest{
		method: http.MethodPost, path: "/wlt/v1/operator/captain-cod-legacy-reviews/" + url.PathEscape(strings.TrimSpace(reviewID)) + "/approve",
		body:          map[string]any{},
		actingActorID: strings.TrimSpace(actorID), idempotencyKey: idempotencyKey, correlationID: correlationID, target: &response,
	})
	return response, err
}
