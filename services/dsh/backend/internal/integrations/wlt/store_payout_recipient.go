package wlt

import (
	"context"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type StorePayoutRecipientRecord struct {
	StoreID            string `json:"storeId"`
	State              string `json:"state"`
	BeneficiaryActorID string `json:"beneficiaryActorId"`
	Version            int    `json:"version"`
	EffectiveAt        string `json:"effectiveAt,omitempty"`
	OrderCount         int64  `json:"orderCount"`
	PartnerNetMinor    int64  `json:"partnerNetMinor"`
	LastEarningAt      string `json:"lastEarningAt,omitempty"`
}

type StorePayoutRecipientReadback struct {
	PartnerActorID string                       `json:"partnerActorId"`
	Currency       string                       `json:"currency"`
	Recipients     []StorePayoutRecipientRecord `json:"recipients"`
	ReviewStores   []string                     `json:"reviewStores"`
}

type StorePayoutRecipientAssignment struct {
	ID                 string `json:"id"`
	StoreID            string `json:"storeId"`
	PartnerActorID     string `json:"partnerActorId"`
	BeneficiaryActorID string `json:"beneficiaryActorId"`
	State              string `json:"state"`
	Version            int    `json:"version"`
	EffectiveAt        string `json:"effectiveAt"`
	Reason             string `json:"reason"`
}

type storePayoutRecipientAssignmentResponse struct {
	Assignment StorePayoutRecipientAssignment `json:"assignment"`
	Replayed   bool                           `json:"idempotentReplay"`
}

type storePayoutRecipientRecordResponse struct {
	StoreID            string `json:"storeId"`
	State              string `json:"state"`
	BeneficiaryActorID string `json:"beneficiaryActorId"`
	Version            int    `json:"version"`
}

// Store payout-recipient assignment states owned by WLT
// (PARTNER_CAPTAIN_FIELD_EARNINGS_SETTLEMENT): absence of a row means DEFAULT_OWNER.
const (
	StorePayoutRecipientStateDefaultOwner   = "DEFAULT_OWNER"
	StorePayoutRecipientStateSelectedStaff  = "SELECTED_VERIFIED_STAFF"
	StorePayoutRecipientStateReviewRequired = "RECIPIENT_REVIEW_REQUIRED"
)

func (c *Client) ListPartnerStorePayoutRecipients(ctx context.Context, partnerActorID string) (StorePayoutRecipientReadback, error) {
	var response StorePayoutRecipientReadback
	err := c.request(ctx, http.MethodGet, "/wlt/v1/partners/"+url.PathEscape(strings.TrimSpace(partnerActorID))+"/store-payout-recipients", nil, "", "", 0, &response)
	return response, err
}

func (c *Client) ReadStorePayoutRecipient(ctx context.Context, partnerActorID, storeID string) (StorePayoutRecipientRecord, error) {
	var response storePayoutRecipientRecordResponse
	path := "/wlt/v1/partners/" + url.PathEscape(strings.TrimSpace(partnerActorID)) + "/store-payout-recipients/" + url.PathEscape(strings.TrimSpace(storeID))
	err := c.request(ctx, http.MethodGet, path, nil, "", "", 0, &response)
	if err != nil {
		return StorePayoutRecipientRecord{}, err
	}
	return StorePayoutRecipientRecord{StoreID: response.StoreID, State: response.State, BeneficiaryActorID: response.BeneficiaryActorID, Version: response.Version}, nil
}

func (c *Client) SelectStorePayoutRecipient(ctx context.Context, storeID string, partnerActorID, beneficiaryActorID string, beneficiaryFacts IdentityFacts, reason, idempotencyKey, correlationID string) (StorePayoutRecipientAssignment, bool, error) {
	body := map[string]any{"partnerActorId": strings.TrimSpace(partnerActorID), "beneficiaryActorId": strings.TrimSpace(beneficiaryActorID), "beneficiaryFacts": beneficiaryFacts, "reason": strings.TrimSpace(reason)}
	var response storePayoutRecipientAssignmentResponse
	err := c.request(ctx, http.MethodPut, "/wlt/v1/store-payout-recipients/"+url.PathEscape(strings.TrimSpace(storeID)), body, idempotencyKey, correlationID, 0, &response)
	return response.Assignment, response.Replayed, err
}

func (c *Client) RevertStorePayoutRecipient(ctx context.Context, storeID, partnerActorID, reason, idempotencyKey, correlationID string) (bool, error) {
	body := map[string]any{"partnerActorId": strings.TrimSpace(partnerActorID), "reason": strings.TrimSpace(reason)}
	var response struct {
		State            string `json:"state"`
		IdempotentReplay bool   `json:"idempotentReplay"`
	}
	err := c.request(ctx, http.MethodPost, "/wlt/v1/store-payout-recipients/"+url.PathEscape(strings.TrimSpace(storeID))+"/revert", body, idempotencyKey, correlationID, 0, &response)
	return response.IdempotentReplay, err
}

func (c *Client) MarkStorePayoutRecipientReviewRequired(ctx context.Context, storeID, partnerActorID, reason, correlationID string) error {
	body := map[string]any{"partnerActorId": strings.TrimSpace(partnerActorID), "reason": strings.TrimSpace(reason)}
	var response struct {
		State   string `json:"state"`
		Applied bool   `json:"applied"`
	}
	idempotencyKey := "system-review-" + strings.TrimSpace(storeID) + "-" + formatRecipientClock(time.Now())
	return c.request(ctx, http.MethodPost, "/wlt/v1/store-payout-recipients/"+url.PathEscape(strings.TrimSpace(storeID))+"/review-required", body, idempotencyKey, correlationID, 0, &response)
}

func formatRecipientClock(t time.Time) string {
	return strings.ReplaceAll(t.UTC().Format("150405.000000000"), ".", "")
}

// PartnerPayoutStoreAmount carries one explicit per-Store amount for a
// SPECIFIED partitioned payout request.
type PartnerPayoutStoreAmount struct {
	StoreID     string `json:"storeId"`
	AmountMinor int64  `json:"amountMinor"`
}

// PartnerPayoutRequestInput is the Store-scoped payout request sent to WLT.
// BeneficiaryIdentityFacts carries current verified wallet facts per effective
// beneficiary actor; WLT re-verifies each group destination against them.
type PartnerPayoutRequestInput struct {
	ScopeMode                string                     `json:"scopeMode"`
	StoreIDs                 []string                   `json:"storeIds,omitempty"`
	StoreAmounts             []PartnerPayoutStoreAmount `json:"storeAmounts,omitempty"`
	BeneficiaryIdentityFacts map[string]IdentityFacts   `json:"beneficiaryIdentityFacts,omitempty"`
}

// PartnerPayoutStoreAllocation is the immutable per-Store allocation line on a
// partitioned payout.
type PartnerPayoutStoreAllocation struct {
	StoreID                    string `json:"storeId"`
	AmountMinor                int64  `json:"amountMinor"`
	BeneficiaryActorID         string `json:"beneficiaryActorId"`
	RecipientAssignmentVersion int64  `json:"recipientAssignmentVersion"`
	Currency                   string `json:"currency"`
}

// PartnerPayoutRequest is the canonical readback of one partitioned request.
type PartnerPayoutRequest struct {
	ID               string                         `json:"id"`
	Status           string                         `json:"status"`
	ScopeMode        string                         `json:"scopeMode"`
	TotalAmountMinor int64                          `json:"totalAmountMinor"`
	Currency         string                         `json:"currency"`
	Stores           []PartnerPayoutStoreAllocation `json:"stores"`
	Payouts          []PayoutRequest                `json:"payouts"`
	CreatedAt        string                         `json:"createdAt"`
}

// CreatePartnerPayoutRequest creates a Store-scoped partitioned payout request;
// WLT groups the selected Stores by effective beneficiary and verified
// destination and never mixes two beneficiaries in one transfer.
func (c *Client) CreatePartnerPayoutRequest(ctx context.Context, partnerActorID string, input PartnerPayoutRequestInput, idempotencyKey, correlationID string) (PartnerPayoutRequest, bool, error) {
	var response struct {
		Request          PartnerPayoutRequest `json:"request"`
		IdempotentReplay bool                 `json:"idempotentReplay"`
	}
	path := "/wlt/v1/partners/" + url.PathEscape(strings.TrimSpace(partnerActorID)) + "/payout-requests"
	err := c.request(ctx, http.MethodPost, path, input, idempotencyKey, correlationID, 0, &response)
	return response.Request, response.IdempotentReplay, err
}

// ReadPartnerPayoutRequest returns the canonical partitioned payout request
// readback with immutable per-Store allocations.
func (c *Client) ReadPartnerPayoutRequest(ctx context.Context, partnerActorID, requestID string) (PartnerPayoutRequest, error) {
	var response struct {
		Request PartnerPayoutRequest `json:"request"`
	}
	path := "/wlt/v1/partners/" + url.PathEscape(strings.TrimSpace(partnerActorID)) + "/payout-requests/" + url.PathEscape(strings.TrimSpace(requestID))
	err := c.request(ctx, http.MethodGet, path, nil, "", "", 0, &response)
	return response.Request, err
}

func (c *Client) ReadPartnerPayoutRequestByKey(ctx context.Context, partnerActorID, idempotencyKey string) (PartnerPayoutRequest, error) {
	var response struct {
		Request PartnerPayoutRequest `json:"request"`
	}
	path := "/wlt/v1/partners/" + url.PathEscape(strings.TrimSpace(partnerActorID)) + "/payout-requests?idempotencyKey=" + url.QueryEscape(strings.TrimSpace(idempotencyKey))
	err := c.request(ctx, http.MethodGet, path, nil, "", "", 0, &response)
	return response.Request, err
}
