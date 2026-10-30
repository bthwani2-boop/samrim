package wlt

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"unicode/utf8"
)

func (c *Client) CreateOfficialWalletDestination(ctx context.Context, destination OfficialWalletDestination, identityFacts IdentityFacts, changeReason, verificationEvidenceReference, changeEvidenceReference, idempotencyKey, correlationID, actingActorID string) (OfficialWalletDestination, bool, error) {
	body := map[string]any{
		"actorType":                     strings.TrimSpace(destination.ActorType),
		"actorId":                       strings.TrimSpace(destination.ActorID),
		"providerKey":                   strings.TrimSpace(destination.ProviderKey),
		"identityFacts":                 identityFacts,
		"changeReason":                  strings.TrimSpace(changeReason),
		"verificationEvidenceReference": strings.TrimSpace(verificationEvidenceReference),
		"changeEvidenceReference":       strings.TrimSpace(changeEvidenceReference),
	}
	var response officialWalletDestinationResponse
	err := c.requestWithActor(ctx, actorRequest{method: http.MethodPost, path: "/wlt/v1/operator/official-wallet-destinations", body: body, idempotencyKey: idempotencyKey, correlationID: correlationID, expectedVersion: 0, actingActorID: actingActorID, target: &response})
	return response.Destination, response.IdempotentReplay, err
}

func (c *Client) CreateCustomerWithdrawalIntake(ctx context.Context, customerActorID, providerKey string, identityFacts IdentityFacts, reason, evidenceDocumentID, idempotencyKey, correlationID, actingActorID string) (CustomerWithdrawalIntake, bool, error) {
	body := map[string]any{
		"customerActorId":           strings.TrimSpace(customerActorID),
		"providerKey":               strings.TrimSpace(providerKey),
		"identityFacts":             identityFacts,
		"requestReason":             strings.TrimSpace(reason),
		"requestEvidenceDocumentId": strings.TrimSpace(evidenceDocumentID),
	}
	var response struct {
		Intake           CustomerWithdrawalIntake `json:"intake"`
		IdempotentReplay bool                     `json:"idempotentReplay"`
	}
	err := c.requestWithActor(ctx, actorRequest{method: http.MethodPost, path: customerWithdrawalIntakesPath, body: body, idempotencyKey: idempotencyKey, correlationID: correlationID, expectedVersion: 0, actingActorID: actingActorID, target: &response})
	return response.Intake, response.IdempotentReplay, err
}

func (c *Client) RecordOrderAdjustmentReconciliationCase(ctx context.Context, item OrderAdjustmentReconciliationCase, idempotencyKey, correlationID, actingActorID string) (OrderAdjustmentReconciliationCase, bool, error) {
	body := map[string]any{
		"orderId": strings.TrimSpace(item.OrderID), "adjustmentId": strings.TrimSpace(item.AdjustmentID),
		"paymentIntentId": strings.TrimSpace(item.PaymentIntentID), "adjustmentKind": strings.TrimSpace(item.AdjustmentKind),
		"requestedByActorId": strings.TrimSpace(item.RequestedByActor), "customerActorId": strings.TrimSpace(item.CustomerActorID),
	}
	var response struct {
		ReconciliationCase OrderAdjustmentReconciliationCase `json:"reconciliationCase"`
		IdempotentReplay   bool                              `json:"idempotentReplay"`
	}
	err := c.requestWithActor(ctx, actorRequest{method: http.MethodPost, path: orderAdjustmentCasesPath, body: body, idempotencyKey: idempotencyKey, correlationID: correlationID, actingActorID: actingActorID, target: &response})
	return response.ReconciliationCase, response.IdempotentReplay, err
}

func (c *Client) ListOrderAdjustmentReconciliationCases(ctx context.Context, orderID, actingActorID string) (OrderAdjustmentReconciliationCases, error) {
	orderID = strings.TrimSpace(orderID)
	if orderID == "" || len(orderID) > 128 {
		return OrderAdjustmentReconciliationCases{}, errors.New("invalid order adjustment reconciliation query")
	}
	query := url.Values{"orderId": {orderID}}
	var response OrderAdjustmentReconciliationCases
	err := c.requestWithActor(ctx, actorRequest{method: http.MethodGet, path: orderAdjustmentCasesPath + "?" + query.Encode(), actingActorID: actingActorID, target: &response})
	return response, err
}

func (c *Client) ListCustomerWithdrawalIntakes(ctx context.Context, status, search, sort, cursor string, limit int, actingActorID string) (CustomerWithdrawalIntakeList, error) {
	if limit < 1 || limit > 100 || utf8.RuneCountInString(strings.TrimSpace(search)) > 128 || len(strings.TrimSpace(cursor)) > 1024 {
		return CustomerWithdrawalIntakeList{}, errors.New("invalid customer withdrawal registry query")
	}
	query := url.Values{"limit": {strconv.Itoa(limit)}, "sort": {strings.TrimSpace(sort)}}
	if value := strings.TrimSpace(status); value != "" {
		query.Set("status", value)
	}
	if value := strings.TrimSpace(search); value != "" {
		query.Set("search", value)
	}
	if value := strings.TrimSpace(cursor); value != "" {
		query.Set("cursor", value)
	}
	var response customerWithdrawalIntakeListResponse
	err := c.requestWithActor(ctx, actorRequest{method: http.MethodGet, path: customerWithdrawalIntakesPath + "?" + query.Encode(), body: nil, idempotencyKey: "", correlationID: "", expectedVersion: 0, actingActorID: actingActorID, target: &response})
	return CustomerWithdrawalIntakeList{Intakes: response.Intakes, NextCursor: response.NextCursor, Limit: response.Limit}, err
}

func (c *Client) ReadCustomerWithdrawalIntake(ctx context.Context, intakeID, actingActorID string) (CustomerWithdrawalIntake, error) {
	var response customerWithdrawalIntakeResponse
	err := c.requestWithActor(ctx, actorRequest{method: http.MethodGet, path: customerWithdrawalIntakesPath + "/" + url.PathEscape(strings.TrimSpace(intakeID)), body: nil, idempotencyKey: "", correlationID: "", expectedVersion: 0, actingActorID: actingActorID, target: &response})
	return response.Intake, err
}

func (c *Client) PrepareCustomerWithdrawalDestination(ctx context.Context, intakeID string, identityFacts IdentityFacts, reason, idempotencyKey, correlationID, actingActorID string) (OfficialWalletDestination, error) {
	var response officialWalletDestinationResponse
	body := map[string]any{"reason": strings.TrimSpace(reason), "identityFacts": identityFacts}
	err := c.requestWithActor(ctx, actorRequest{method: http.MethodPost, path: customerWithdrawalIntakesPath + "/" + url.PathEscape(strings.TrimSpace(intakeID)) + "/prepare-destination", body: body, idempotencyKey: idempotencyKey, correlationID: correlationID, expectedVersion: 0, actingActorID: actingActorID, target: &response})
	return response.Destination, err
}

func (c *Client) AcceptCustomerWithdrawal(ctx context.Context, intakeID string, identityFacts IdentityFacts, reason, idempotencyKey, correlationID, actingActorID string) (PayoutRequest, error) {
	var response payoutRequestResponse
	body := map[string]any{"reason": strings.TrimSpace(reason), "identityFacts": identityFacts}
	err := c.requestWithActor(ctx, actorRequest{method: http.MethodPost, path: customerWithdrawalIntakesPath + "/" + url.PathEscape(strings.TrimSpace(intakeID)) + "/accept", body: body, idempotencyKey: idempotencyKey, correlationID: correlationID, expectedVersion: 0, actingActorID: actingActorID, target: &response})
	return response.Payout, err
}

func (c *Client) RejectCustomerWithdrawal(ctx context.Context, intakeID, reason, idempotencyKey, correlationID, actingActorID string) (CustomerWithdrawalIntake, error) {
	var response customerWithdrawalIntakeResponse
	err := c.requestWithActor(ctx, actorRequest{method: http.MethodPost, path: customerWithdrawalIntakesPath + "/" + url.PathEscape(strings.TrimSpace(intakeID)) + "/reject", body: map[string]any{"reason": strings.TrimSpace(reason)}, idempotencyKey: idempotencyKey, correlationID: correlationID, expectedVersion: 0, actingActorID: actingActorID, target: &response})
	return response.Intake, err
}

func (c *Client) VerifyOfficialWalletDestination(ctx context.Context, destinationID, evidenceReference string, identityFacts IdentityFacts, idempotencyKey, correlationID, actingActorID string) (OfficialWalletDestination, error) {
	var response officialWalletDestinationResponse
	body := map[string]any{"evidenceReference": strings.TrimSpace(evidenceReference), "identityFacts": identityFacts}
	err := c.requestWithActor(ctx, actorRequest{method: http.MethodPost, path: "/wlt/v1/operator/official-wallet-destinations/" + url.PathEscape(strings.TrimSpace(destinationID)) + "/verify", body: body, idempotencyKey: idempotencyKey, correlationID: correlationID, expectedVersion: 0, actingActorID: actingActorID, target: &response})
	return response.Destination, err
}

func (c *Client) ActivateOfficialWalletDestination(ctx context.Context, destinationID string, identityFacts IdentityFacts, idempotencyKey, correlationID, actingActorID string) (OfficialWalletDestination, error) {
	var response officialWalletDestinationResponse
	body := map[string]any{"identityFacts": identityFacts}
	err := c.requestWithActor(ctx, actorRequest{method: http.MethodPost, path: "/wlt/v1/operator/official-wallet-destinations/" + url.PathEscape(strings.TrimSpace(destinationID)) + "/activate", body: body, idempotencyKey: idempotencyKey, correlationID: correlationID, expectedVersion: 0, actingActorID: actingActorID, target: &response})
	return response.Destination, err
}

func (c *Client) ReadOfficialWalletDestination(ctx context.Context, actorType, actorID string) (OfficialWalletDestination, error) {
	var response officialWalletDestinationResponse
	err := c.request(ctx, http.MethodGet, "/wlt/v1/official-wallet-destinations/"+url.PathEscape(strings.TrimSpace(actorType))+"/"+url.PathEscape(strings.TrimSpace(actorID)), nil, "", "", 0, &response)
	return response.Destination, err
}

func (c *Client) ReadOfficialWalletDestinationByID(ctx context.Context, destinationID string) (OfficialWalletDestination, error) {
	var response officialWalletDestinationResponse
	err := c.request(ctx, http.MethodGet, "/wlt/v1/official-wallet-destinations/by-id/"+url.PathEscape(strings.TrimSpace(destinationID)), nil, "", "", 0, &response)
	return response.Destination, err
}

func (c *Client) CreatePayoutIntent(ctx context.Context, actorType, actorID, amountMode string, amountMinor *int64, identityFacts IdentityFacts, idempotencyKey, correlationID string) (PayoutRequest, bool, error) {
	body := map[string]any{"actorType": strings.TrimSpace(actorType), "actorId": strings.TrimSpace(actorID), "amountMode": strings.TrimSpace(amountMode), "identityFacts": identityFacts}
	if amountMinor != nil {
		body["amountMinor"] = *amountMinor
	}
	var response payoutRequestResponse
	err := c.request(ctx, http.MethodPost, "/wlt/v1/payout-intents", body, idempotencyKey, correlationID, 0, &response)
	return response.Payout, response.IdempotentReplay, err
}

func (c *Client) ReadPayoutState(ctx context.Context, actorType, actorID string) (PayoutState, error) {
	var response payoutStateResponse
	path := "/wlt/v1/payout-state/" + url.PathEscape(strings.ToLower(strings.TrimSpace(actorType))) + "/" + url.PathEscape(strings.TrimSpace(actorID))
	err := c.request(ctx, http.MethodGet, path, nil, "", "", 0, &response)
	return response.State, err
}

func (c *Client) ListPayoutRequests(ctx context.Context, status, actingActorID string) ([]PayoutRequest, error) {
	path := payoutRequestsPath
	if strings.TrimSpace(status) != "" {
		path += "?status=" + url.QueryEscape(strings.TrimSpace(status))
	}
	var response payoutListResponse
	err := c.requestWithActor(ctx, actorRequest{method: http.MethodGet, path: path, body: nil, idempotencyKey: "", correlationID: "", expectedVersion: 0, actingActorID: actingActorID, target: &response})
	return response.Payouts, err
}

func (c *Client) ListBeneficiaryPayoutStates(ctx context.Context, actorType, search, status, sortKey, cursor string, limit int, actingActorID string) (PayoutStateRegistry, error) {
	query := url.Values{}
	if strings.TrimSpace(actorType) != "" {
		query.Set("actorType", strings.TrimSpace(actorType))
	}
	if strings.TrimSpace(search) != "" {
		query.Set("search", strings.TrimSpace(search))
	}
	if strings.TrimSpace(status) != "" {
		query.Set("status", strings.TrimSpace(status))
	}
	if strings.TrimSpace(sortKey) != "" {
		query.Set("sort", strings.TrimSpace(sortKey))
	}
	if strings.TrimSpace(cursor) != "" {
		query.Set("cursor", strings.TrimSpace(cursor))
	}
	if limit > 0 {
		query.Set("limit", strconv.Itoa(limit))
	}
	path := "/wlt/v1/operator/beneficiaries"
	if encoded := query.Encode(); encoded != "" {
		path += "?" + encoded
	}
	var response PayoutStateRegistry
	err := c.requestWithActor(ctx, actorRequest{method: http.MethodGet, path: path, body: nil, idempotencyKey: "", correlationID: "", expectedVersion: 0, actingActorID: actingActorID, target: &response})
	return response, err
}
