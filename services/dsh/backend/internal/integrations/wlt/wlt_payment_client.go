package wlt

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"strings"
)

func (c *Client) Create(ctx context.Context, externalReference, payerActorID string, amountMinor int64, idempotencyKey, correlationID string) (PaymentIntent, bool, error) {
	body := map[string]any{
		"externalReference": strings.TrimSpace(externalReference),
		"payerActorId":      strings.TrimSpace(payerActorID),
		"amountMinor":       amountMinor,
		"currency":          "YER",
		"method":            methodCashOnDelivery,
	}
	var response paymentIntentResponse
	err := c.request(ctx, http.MethodPost, "/wlt/v1/payment-intents", body, idempotencyKey, correlationID, 0, &response)
	return response.PaymentIntent, response.IdempotentReplay, err
}

func (c *Client) CreateForOrder(ctx context.Context, orderID, externalReference, payerActorID string, amountMinor int64, allocation CustomerPaymentAllocationInput, idempotencyKey, correlationID string) (PaymentIntent, bool, error) {
	return c.CreateForOrderWithMethod(ctx, orderID, externalReference, payerActorID, amountMinor, methodCashOnDelivery, allocation, idempotencyKey, correlationID)
}

func (c *Client) CreateForOrderWithMethod(ctx context.Context, orderID, externalReference, payerActorID string, amountMinor int64, method string, allocation CustomerPaymentAllocationInput, idempotencyKey, correlationID string) (PaymentIntent, bool, error) {
	body := map[string]any{
		"orderId":                   strings.TrimSpace(orderID),
		"externalReference":         strings.TrimSpace(externalReference),
		"payerActorId":              strings.TrimSpace(payerActorID),
		"amountMinor":               amountMinor,
		"currency":                  "YER",
		"method":                    strings.TrimSpace(method),
		"customerPaymentAllocation": allocation,
	}
	var response paymentIntentResponse
	err := c.request(ctx, http.MethodPost, "/wlt/v1/payment-intents", body, idempotencyKey, correlationID, 0, &response)
	return response.PaymentIntent, response.IdempotentReplay, err
}

type PartnerStoreCashCommission struct {
	OrderID             string `json:"orderId"`
	PaymentIntentID     string `json:"paymentIntentId"`
	PartnerActorID      string `json:"partnerActorId"`
	FulfillmentMode     string `json:"fulfillmentMode"`
	Currency            string `json:"currency"`
	GrossProductMinor   int64  `json:"grossProductMinor"`
	CommissionMinor     int64  `json:"commissionMinor"`
	ProfileID           string `json:"profileId"`
	ProfileVersion      int    `json:"profileVersion"`
	PolicyVersion       string `json:"policyVersion"`
	LedgerTransactionID string `json:"ledgerTransactionId,omitempty"`
	CreatedAt           string `json:"createdAt"`
}

type PartnerCommissionRemittance struct {
	ID                  string `json:"id"`
	PartnerActorID      string `json:"partnerActorId"`
	AmountMinor         int64  `json:"amountMinor"`
	Currency            string `json:"currency"`
	RemittanceReference string `json:"remittanceReference"`
	EvidenceReference   string `json:"evidenceReference,omitempty"`
	EvidenceDocumentID  string `json:"evidenceDocumentId,omitempty"`
	VerifiedBy          string `json:"verifiedBy"`
	VerifiedAt          string `json:"verifiedAt"`
	LedgerTransactionID string `json:"ledgerTransactionId"`
	CreatedAt           string `json:"createdAt"`
}

type partnerStoreCashCommissionResponse struct {
	Commission       PartnerStoreCashCommission `json:"commission"`
	IdempotentReplay bool                       `json:"idempotentReplay"`
}

type partnerCommissionRemittanceResponse struct {
	Remittance       PartnerCommissionRemittance `json:"remittance"`
	IdempotentReplay bool                        `json:"idempotentReplay"`
}

func (c *Client) Read(ctx context.Context, intentID string) (PaymentIntent, error) {
	var response paymentIntentResponse
	err := c.request(ctx, http.MethodGet, "/wlt/v1/payment-intents/"+url.PathEscape(strings.TrimSpace(intentID)), nil, "", "", 0, &response)
	return response.PaymentIntent, err
}

func (c *Client) ReadByExternalReference(ctx context.Context, externalReference string) (PaymentIntent, error) {
	query := url.Values{}
	query.Set("externalReference", strings.TrimSpace(externalReference))
	var response paymentIntentResponse
	err := c.request(ctx, http.MethodGet, "/wlt/v1/payment-intents/by-external-reference?"+query.Encode(), nil, "", "", 0, &response)
	return response.PaymentIntent, err
}

func (c *Client) Collect(ctx context.Context, intentID, collectedByActorID, collectionReference string, amountMinor int64, expectedVersion int, idempotencyKey, correlationID string) (PaymentIntent, bool, error) {
	body := map[string]any{
		"collectedAmountMinor": amountMinor,
		"collectedByActorId":   strings.TrimSpace(collectedByActorID),
		"collectionReference":  strings.TrimSpace(collectionReference),
	}
	var response paymentIntentResponse
	err := c.request(ctx, http.MethodPost, "/wlt/v1/payment-intents/"+url.PathEscape(strings.TrimSpace(intentID))+"/collect", body, idempotencyKey, correlationID, expectedVersion, &response)
	return response.PaymentIntent, response.IdempotentReplay, err
}

func (c *Client) EnsureCollected(ctx context.Context, intentID, expectedMethod, collectedByActorID, collectionReference string, amountMinor int64, idempotencyKey, correlationID string) (PaymentIntent, error) {
	current, err := c.Read(ctx, intentID)
	if err != nil {
		return PaymentIntent{}, err
	}
	if (expectedMethod != MethodCashOnDelivery && expectedMethod != MethodCashAtStore) || current.Method != expectedMethod {
		return PaymentIntent{}, &Error{Status: http.StatusConflict, Code: "PAYMENT_METHOD_MISMATCH", Message: "WLT payment method does not match the DSH fulfillment handoff"}
	}
	if current.CustomerPaymentAllocation == nil || current.CustomerPaymentAllocation.CustomerPayableMinor != amountMinor || current.CustomerPaymentAllocation.CashAmountMinor != current.AmountMinor {
		return PaymentIntent{}, &Error{Status: http.StatusConflict, Code: "AMOUNT_MISMATCH", Message: "WLT allocation does not match the DSH order payable and cash remainder"}
	}
	cashAmountMinor := current.CustomerPaymentAllocation.CashAmountMinor
	collector := strings.TrimSpace(collectedByActorID)
	if cashAmountMinor == 0 {
		collector = ""
	}
	collectionReferenceValue := strings.TrimSpace(collectionReference)
	if cashAmountMinor == 0 {
		collectionReferenceValue = ""
	}
	validCollected := func(item PaymentIntent) bool {
		if item.Method != expectedMethod || item.State != stateCollected || item.CollectedAmountMinor == nil || *item.CollectedAmountMinor != cashAmountMinor {
			return false
		}
		if cashAmountMinor == 0 {
			return item.CollectedByActorID == nil || strings.TrimSpace(*item.CollectedByActorID) == ""
		}
		return item.CollectedByActorID != nil && strings.TrimSpace(*item.CollectedByActorID) == collector
	}
	if current.State == stateCollected {
		if !validCollected(current) {
			return PaymentIntent{}, &Error{Status: http.StatusConflict, Code: "AMOUNT_MISMATCH", Message: "collected WLT state does not match the allocated cash source"}
		}
		return current, nil
	}
	if current.State != stateRequiresCollect {
		return PaymentIntent{}, &Error{Status: http.StatusConflict, Code: "STATE_CONFLICT", Message: "WLT payment intent is not collectable"}
	}
	collected, _, collectErr := c.Collect(ctx, intentID, collector, collectionReferenceValue, cashAmountMinor, current.Version, idempotencyKey, correlationID)
	if collectErr == nil {
		if !validCollected(collected) {
			return PaymentIntent{}, &Error{Status: http.StatusConflict, Code: "AMOUNT_MISMATCH", Message: "WLT collection response does not match the allocated cash source"}
		}
		return collected, nil
	}
	var wltErr *Error
	if !errors.As(collectErr, &wltErr) || wltErr.Code != "VERSION_CONFLICT" {
		return PaymentIntent{}, collectErr
	}
	current, readErr := c.Read(ctx, intentID)
	if readErr != nil {
		return PaymentIntent{}, readErr
	}
	if validCollected(current) {
		return current, nil
	}
	return PaymentIntent{}, collectErr
}

func (c *Client) EnsureCancelled(ctx context.Context, intentID, reason, idempotencyKey, correlationID string) (PaymentIntent, error) {
	current, err := c.Read(ctx, intentID)
	if err != nil {
		return PaymentIntent{}, err
	}
	if current.State == stateCancelled {
		return current, nil
	}
	if current.State != stateRequiresCollect {
		return PaymentIntent{}, &Error{Status: http.StatusConflict, Code: "STATE_CONFLICT", Message: "WLT payment intent is not cancellable"}
	}
	body := map[string]any{"reason": strings.TrimSpace(reason)}
	var response paymentIntentResponse
	err = c.request(ctx, http.MethodPost, "/wlt/v1/payment-intents/"+url.PathEscape(strings.TrimSpace(intentID))+"/cancel", body, idempotencyKey, correlationID, current.Version, &response)
	if err == nil {
		return response.PaymentIntent, nil
	}
	var wltErr *Error
	if !errors.As(err, &wltErr) || wltErr.Code != "VERSION_CONFLICT" {
		return PaymentIntent{}, err
	}
	current, readErr := c.Read(ctx, intentID)
	if readErr == nil && current.State == stateCancelled {
		return current, nil
	}
	return PaymentIntent{}, err
}
