package wlt

import (
	"context"
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

func (c *Client) ListCashLiability(ctx context.Context, captainActorID string) (CashLiabilityResponse, error) {
	var response CashLiabilityResponse
	err := c.request(ctx, http.MethodGet, "/wlt/v1/captains/"+url.PathEscape(strings.TrimSpace(captainActorID))+"/cash-liability", nil, "", "", 0, &response)
	return response, err
}

func (c *Client) ListOperatorCashLiability(ctx context.Context, search, sort, cursor string, limit int) (CashLiabilityRegistryResponse, error) {
	var response CashLiabilityRegistryResponse
	query := url.Values{}
	query.Set("search", strings.TrimSpace(search))
	query.Set("sort", strings.TrimSpace(sort))
	query.Set("limit", strconv.Itoa(limit))
	if strings.TrimSpace(cursor) != "" {
		query.Set("cursor", strings.TrimSpace(cursor))
	}
	err := c.request(ctx, http.MethodGet, "/wlt/v1/operator/cash-liability?"+query.Encode(), nil, "", "", 0, &response)
	return response, err
}

func (c *Client) ReconcileCashRemittance(ctx context.Context, remittanceID, evidenceDocumentID, actorID, idempotencyKey, correlationID string) (CashRemittance, bool, error) {
	body := map[string]any{"evidenceDocumentId": strings.TrimSpace(evidenceDocumentID)}
	var response cashRemittanceResponse
	path := "/wlt/v1/operator/cash-remittances/" + url.PathEscape(strings.TrimSpace(remittanceID)) + "/reconcile"
	err := c.requestWithActor(ctx, actorRequest{method: http.MethodPost, path: path, body: body, idempotencyKey: idempotencyKey, correlationID: correlationID, actingActorID: strings.TrimSpace(actorID), target: &response})
	return response.CashRemittance, response.IdempotentReplay, err
}

func (c *Client) ReadCaptainWalletState(ctx context.Context, captainActorID string) (CaptainWalletState, error) {
	var response struct {
		State CaptainWalletState `json:"state"`
	}
	err := c.request(ctx, http.MethodGet, "/wlt/v1/captains/"+url.PathEscape(strings.TrimSpace(captainActorID))+"/wallet-state", nil, "", "", 0, &response)
	return response.State, err
}

func (c *Client) ReadWalletState(ctx context.Context, actorType, actorID string) (WalletState, error) {
	var response struct {
		State WalletState `json:"state"`
	}
	path := "/wlt/v1/wallets/" + url.PathEscape(strings.ToLower(strings.TrimSpace(actorType))) + "/" + url.PathEscape(strings.TrimSpace(actorID)) + "/state"
	err := c.request(ctx, http.MethodGet, path, nil, "", "", 0, &response)
	return response.State, err
}

func (c *Client) CreateCashInFundingIntent(ctx context.Context, actorType, actorID string, amountMinor int64, idempotencyKey, correlationID string, providerKey ...string) (CashInFundingIntent, bool, bool, error) {
	body := map[string]any{"amountMinor": amountMinor}
	if len(providerKey) > 0 && strings.TrimSpace(providerKey[0]) != "" {
		body["providerKey"] = strings.TrimSpace(providerKey[0])
	}
	var response struct {
		Intent           CashInFundingIntent `json:"intent"`
		Simulator        bool                `json:"simulator"`
		IdempotentReplay bool                `json:"idempotentReplay"`
	}
	path := "/wlt/v1/wallets/" + url.PathEscape(strings.ToLower(strings.TrimSpace(actorType))) + "/" + url.PathEscape(strings.TrimSpace(actorID)) + "/funding-intents"
	err := c.requestWithActor(ctx, actorRequest{method: http.MethodPost, path: path, body: body, idempotencyKey: idempotencyKey, correlationID: correlationID, expectedVersion: 0, actingActorID: actorID, target: &response})
	return response.Intent, response.Simulator, response.IdempotentReplay, err
}

func (c *Client) ListCashInFundingIntents(ctx context.Context, actorType, actorID string, limit int) ([]CashInFundingIntent, bool, error) {
	var response struct {
		Items     []CashInFundingIntent `json:"items"`
		Simulator bool                  `json:"simulator"`
	}
	path := "/wlt/v1/wallets/" + url.PathEscape(strings.ToLower(strings.TrimSpace(actorType))) + "/" + url.PathEscape(strings.TrimSpace(actorID)) + "/funding-intents?limit=" + strconv.Itoa(limit)
	err := c.request(ctx, http.MethodGet, path, nil, "", "", 0, &response)
	return response.Items, response.Simulator, err
}

func (c *Client) ReadCashInFundingIntent(ctx context.Context, fundingIntentID string) (CashInFundingIntent, error) {
	var response struct {
		Intent CashInFundingIntent `json:"intent"`
	}
	err := c.request(ctx, http.MethodGet, "/wlt/v1/funding-intents/"+url.PathEscape(strings.TrimSpace(fundingIntentID)), nil, "", "", 0, &response)
	return response.Intent, err
}

func (c *Client) ReconcileMockCashInFundingIntent(ctx context.Context, fundingIntentID, actorID, idempotencyKey, correlationID string) (CashInFundingIntent, error) {
	var response struct {
		Intent CashInFundingIntent `json:"intent"`
	}
	path := "/wlt/v1/development/funding-intents/" + url.PathEscape(strings.TrimSpace(fundingIntentID)) + "/reconcile"
	err := c.requestWithActor(ctx, actorRequest{method: http.MethodPost, path: path, body: map[string]any{}, idempotencyKey: idempotencyKey, correlationID: correlationID, expectedVersion: 0, actingActorID: actorID, target: &response})
	return response.Intent, err
}

func (c *Client) SimulateCashInFundingOutcome(ctx context.Context, fundingIntentID, outcome, actingActorID, idempotencyKey, correlationID string) (CashInFundingIntent, bool, error) {
	body := map[string]any{"outcome": strings.ToUpper(strings.TrimSpace(outcome))}
	var response struct {
		Intent           CashInFundingIntent `json:"intent"`
		Simulator        bool                `json:"simulator"`
		IdempotentReplay bool                `json:"idempotentReplay"`
	}
	path := "/wlt/v1/development/funding-intents/" + url.PathEscape(strings.TrimSpace(fundingIntentID)) + "/simulate"
	err := c.requestWithActor(ctx, actorRequest{method: http.MethodPost, path: path, body: body, idempotencyKey: idempotencyKey, correlationID: correlationID, expectedVersion: 0, actingActorID: actingActorID, target: &response})
	return response.Intent, response.IdempotentReplay, err
}

func (c *Client) ReserveCaptainCOD(ctx context.Context, orderID, paymentIntentID, captainActorID, idempotencyKey, correlationID string) (CaptainCODReservation, bool, error) {
	body := map[string]any{"orderId": strings.TrimSpace(orderID), "paymentIntentId": strings.TrimSpace(paymentIntentID), "captainActorId": strings.TrimSpace(captainActorID)}
	var response struct {
		Reservation      CaptainCODReservation `json:"reservation"`
		IdempotentReplay bool                  `json:"idempotentReplay"`
	}
	err := c.request(ctx, http.MethodPost, "/wlt/v1/captain-cod-reservations", body, idempotencyKey, correlationID, 0, &response)
	return response.Reservation, response.IdempotentReplay, err
}

func (c *Client) ReleaseCaptainCOD(ctx context.Context, orderID, paymentIntentID, captainActorID, idempotencyKey, correlationID string) (CaptainCODReservation, bool, error) {
	return c.transitionCaptainCOD(ctx, "release", orderID, paymentIntentID, captainActorID, idempotencyKey, correlationID)
}

func (c *Client) FinalizeCaptainCOD(ctx context.Context, orderID, paymentIntentID, captainActorID, idempotencyKey, correlationID string) (CaptainCODReservation, bool, error) {
	return c.transitionCaptainCOD(ctx, "finalize", orderID, paymentIntentID, captainActorID, idempotencyKey, correlationID)
}

func (c *Client) transitionCaptainCOD(ctx context.Context, operation, orderID, paymentIntentID, captainActorID, idempotencyKey, correlationID string) (CaptainCODReservation, bool, error) {
	body := map[string]any{"paymentIntentId": strings.TrimSpace(paymentIntentID), "captainActorId": strings.TrimSpace(captainActorID)}
	var response struct {
		Reservation      CaptainCODReservation `json:"reservation"`
		IdempotentReplay bool                  `json:"idempotentReplay"`
	}
	err := c.request(ctx, http.MethodPost, "/wlt/v1/captain-cod-reservations/"+url.PathEscape(strings.TrimSpace(orderID))+"/"+operation, body, idempotencyKey, correlationID, 0, &response)
	return response.Reservation, response.IdempotentReplay, err
}
