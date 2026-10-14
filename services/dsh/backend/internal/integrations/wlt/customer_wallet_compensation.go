package wlt

import (
	"context"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type CustomerWalletCompensation struct {
	CaseID              string    `json:"caseId"`
	OrderID             string    `json:"orderId"`
	CustomerActorID     string    `json:"customerActorId"`
	AmountMinor         int64     `json:"amountMinor"`
	Currency            string    `json:"currency"`
	ApprovedByActorID   string    `json:"approvedByActorId"`
	EvidenceReference   string    `json:"evidenceReference"`
	LedgerTransactionID string    `json:"ledgerTransactionId"`
	CreatedAt           time.Time `json:"createdAt"`
}

func (c *Client) CreditReviewedCustomerWallet(ctx context.Context, caseID string, amountMinor int64,
	evidenceReference, operatorID, idempotencyKey, correlationID string) (CustomerWalletCompensation, bool, error) {
	var result struct {
		WalletCompensation CustomerWalletCompensation `json:"walletCompensation"`
		IdempotentReplay   bool                       `json:"idempotentReplay"`
	}
	err := c.requestWithActor(ctx, actorRequest{
		method:         http.MethodPost,
		path:           "/wlt/v1/operator/order-adjustment-reconciliation-cases/" + url.PathEscape(strings.TrimSpace(caseID)) + "/wallet-credit",
		body:           map[string]any{"amountMinor": amountMinor, "evidenceReference": strings.TrimSpace(evidenceReference)},
		idempotencyKey: idempotencyKey, correlationID: correlationID, actingActorID: operatorID, target: &result,
	})
	return result.WalletCompensation, result.IdempotentReplay, err
}
