package wlt

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const (
	methodCashOnDelivery = "CASH_ON_DELIVERY"
	stateRequiresCollect = "REQUIRES_COLLECTION"
	stateCollected       = "COLLECTED"
	stateCancelled       = "CANCELLED"
)

type Client struct {
	baseURL      string
	serviceToken string
	httpClient   *http.Client
}

type PaymentIntent struct {
	ID                   string  `json:"id"`
	ExternalReference    string  `json:"externalReference"`
	PayerActorID         string  `json:"payerActorId"`
	AmountMinor          int64   `json:"amountMinor"`
	Currency             string  `json:"currency"`
	Method               string  `json:"method"`
	State                string  `json:"state"`
	Version              int     `json:"version"`
	CollectedAmountMinor *int64  `json:"collectedAmountMinor"`
	CollectedByActorID   *string `json:"collectedByActorId"`
	CollectionReference  *string `json:"collectionReference"`
	CancellationReason   *string `json:"cancellationReason"`
}

type paymentIntentResponse struct {
	PaymentIntent    PaymentIntent `json:"paymentIntent"`
	IdempotentReplay bool          `json:"idempotentReplay"`
}

type CashLiability struct {
	PaymentIntentID   string `json:"paymentIntentId"`
	ExternalReference string `json:"externalReference"`
	CaptainActorID    string `json:"captainActorId"`
	AmountMinor       int64  `json:"amountMinor"`
	Currency          string `json:"currency"`
	PaymentVersion    int    `json:"paymentVersion"`
	CollectedAt       string `json:"collectedAt"`
}

type CashLiabilityResponse struct {
	Items            []CashLiability `json:"items"`
	TotalAmountMinor int64           `json:"totalAmountMinor"`
}

type CashRemittance struct {
	ID                  string `json:"id"`
	PaymentIntentID     string `json:"paymentIntentId"`
	CaptainActorID      string `json:"captainActorId"`
	AmountMinor         int64  `json:"amountMinor"`
	Currency            string `json:"currency"`
	RemittanceReference string `json:"remittanceReference"`
	State               string `json:"state"`
	CreatedAt           string `json:"createdAt"`
}

type cashRemittanceResponse struct {
	CashRemittance   CashRemittance `json:"cashRemittance"`
	IdempotentReplay bool           `json:"idempotentReplay"`
}

type Error struct {
	Status  int
	Code    string
	Message string
}

func (e *Error) Error() string {
	return fmt.Sprintf("WLT request failed with status %d and code %s: %s", e.Status, e.Code, e.Message)
}

func New(rawBaseURL, environment, serviceToken string) (*Client, error) {
	baseURL, err := ResolveBaseURL(rawBaseURL, environment)
	if err != nil {
		return nil, err
	}
	serviceToken = strings.TrimSpace(serviceToken)
	if serviceToken == "" {
		return nil, errors.New("WLT service token is required")
	}
	return &Client{baseURL: baseURL, serviceToken: serviceToken, httpClient: &http.Client{Timeout: 8 * time.Second}}, nil
}

func ResolveBaseURL(raw, environment string) (string, error) {
	environment = strings.ToLower(strings.TrimSpace(environment))
	if environment != "development" && environment != "test" && environment != "staging" && environment != "production" {
		return "", errors.New("BTHWANI_ENV must be development, test, staging, or production")
	}
	value := strings.TrimRight(strings.TrimSpace(raw), "/")
	if value == "" {
		if environment == "development" || environment == "test" {
			value = "http://wlt:8083"
		} else {
			return "", errors.New("DSH_WLT_API_BASE_URL is required outside local environments")
		}
	}
	parsed, err := url.Parse(value)
	if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return "", errors.New("DSH_WLT_API_BASE_URL is invalid")
	}
	if (environment == "staging" || environment == "production") && parsed.Scheme != "https" {
		return "", errors.New("DSH_WLT_API_BASE_URL must use HTTPS outside local environments")
	}
	return value, nil
}

func DerivedIdempotencyKey(scope, source string) string {
	digest := sha256.Sum256([]byte(strings.TrimSpace(scope) + "\x00" + strings.TrimSpace(source)))
	return "wlt-" + hex.EncodeToString(digest[:])
}

func DerivedExternalReference(scope, source string) string {
	digest := sha256.Sum256([]byte(strings.TrimSpace(scope) + "\x00" + strings.TrimSpace(source)))
	return "dsh-" + strings.TrimSpace(scope) + "-" + hex.EncodeToString(digest[:])
}

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

func (c *Client) Read(ctx context.Context, intentID string) (PaymentIntent, error) {
	var response paymentIntentResponse
	err := c.request(ctx, http.MethodGet, "/wlt/v1/payment-intents/"+url.PathEscape(strings.TrimSpace(intentID)), nil, "", "", 0, &response)
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

func (c *Client) EnsureCollected(ctx context.Context, intentID, collectedByActorID, collectionReference string, amountMinor int64, idempotencyKey, correlationID string) (PaymentIntent, error) {
	current, err := c.Read(ctx, intentID)
	if err != nil {
		return PaymentIntent{}, err
	}
	if current.AmountMinor != amountMinor {
		return PaymentIntent{}, &Error{Status: http.StatusConflict, Code: "AMOUNT_MISMATCH", Message: "WLT amount does not match the DSH order total"}
	}
	if current.State == stateCollected {
		return current, nil
	}
	if current.State != stateRequiresCollect {
		return PaymentIntent{}, &Error{Status: http.StatusConflict, Code: "STATE_CONFLICT", Message: "WLT payment intent is not collectable"}
	}
	collected, _, collectErr := c.Collect(ctx, intentID, collectedByActorID, collectionReference, amountMinor, current.Version, idempotencyKey, correlationID)
	if collectErr == nil {
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
	if current.State == stateCollected && current.AmountMinor == amountMinor {
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

func (c *Client) ListCashLiability(ctx context.Context, captainActorID string) (CashLiabilityResponse, error) {
	var response CashLiabilityResponse
	err := c.request(ctx, http.MethodGet, "/wlt/v1/captains/"+url.PathEscape(strings.TrimSpace(captainActorID))+"/cash-liability", nil, "", "", 0, &response)
	return response, err
}

func (c *Client) RemitCash(ctx context.Context, intentID, captainActorID string, amountMinor int64, remittanceReference string, expectedPaymentVersion int, idempotencyKey, correlationID string) (CashRemittance, bool, error) {
	body := map[string]any{
		"captainActorId":      strings.TrimSpace(captainActorID),
		"amountMinor":         amountMinor,
		"remittanceReference": strings.TrimSpace(remittanceReference),
	}
	var response cashRemittanceResponse
	err := c.request(ctx, http.MethodPost, "/wlt/v1/payment-intents/"+url.PathEscape(strings.TrimSpace(intentID))+"/remit", body, idempotencyKey, correlationID, expectedPaymentVersion, &response)
	return response.CashRemittance, response.IdempotentReplay, err
}

func (c *Client) request(ctx context.Context, method, path string, body any, idempotencyKey, correlationID string, expectedVersion int, target any) error {
	if c == nil || c.httpClient == nil || strings.TrimSpace(c.baseURL) == "" || strings.TrimSpace(c.serviceToken) == "" {
		return errors.New("WLT client is not configured")
	}
	var reader io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			return err
		}
		reader = strings.NewReader(string(encoded))
	}
	request, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, reader)
	if err != nil {
		return err
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("Authorization", "Bearer "+c.serviceToken)
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	if strings.TrimSpace(idempotencyKey) != "" {
		request.Header.Set("Idempotency-Key", strings.TrimSpace(idempotencyKey))
	}
	if strings.TrimSpace(correlationID) != "" {
		request.Header.Set("X-Correlation-ID", strings.TrimSpace(correlationID))
	}
	if expectedVersion > 0 {
		request.Header.Set("X-Expected-Version", fmt.Sprintf("%d", expectedVersion))
	}
	response, err := c.httpClient.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if !targetedStatus(response.StatusCode) {
		var payload struct {
			Error struct {
				Code    string `json:"code"`
				Message string `json:"message"`
			} `json:"error"`
		}
		_ = json.NewDecoder(response.Body).Decode(&payload)
		return &Error{Status: response.StatusCode, Code: payload.Error.Code, Message: payload.Error.Message}
	}
	if target == nil {
		return nil
	}
	return json.NewDecoder(response.Body).Decode(target)
}

func targetedStatus(status int) bool {
	return status >= http.StatusOK && status < http.StatusMultipleChoices
}
