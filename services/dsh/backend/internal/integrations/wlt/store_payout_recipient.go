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
