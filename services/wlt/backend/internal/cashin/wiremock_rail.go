package cashin

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
)

// WireMockRail exercises only the local, provider-neutral HTTP test contract.
// Real providers will require their own documented protocol adapters.
type WireMockRail struct {
	baseURL string
	client  *http.Client
}

var (
	ErrProviderUnavailable = errors.New("payment provider response is unavailable or invalid")
	mockProviderKeyPattern = regexp.MustCompile(`^wallet_provider_[a-z0-9_]{2,60}$`)
)

func ValidMockProviderKey(key string) bool {
	return len(key) <= 64 && mockProviderKeyPattern.MatchString(strings.ToLower(strings.TrimSpace(key)))
}

func NewWireMockRail(rawURL string) (*WireMockRail, error) {
	rawURL = strings.TrimSpace(rawURL)
	u, err := url.Parse(rawURL)
	if err != nil || u.Scheme != "http" || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") {
		return nil, ErrInvalidRequest
	}
	host := strings.ToLower(u.Hostname())
	if host != "payment-mock" && host != "localhost" && host != "127.0.0.1" {
		return nil, ErrInvalidRequest
	}
	return &WireMockRail{baseURL: strings.TrimSuffix(rawURL, "/"), client: &http.Client{Timeout: 3 * time.Second}}, nil
}

func (r *WireMockRail) CreatePayment(ctx context.Context, input CreatePaymentRequest) (CreatePaymentResult, error) {
	if !ValidMockProviderKey(input.ProviderKey) || strings.TrimSpace(input.IntentID) == "" || strings.TrimSpace(input.ExternalReference) == "" || input.AmountMinor <= 0 || input.Currency != "YER" {
		return CreatePaymentResult{}, ErrInvalidRequest
	}
	provider := strings.ToLower(strings.TrimSpace(input.ProviderKey))
	payload, err := json.Marshal(map[string]any{"intentId": input.IntentID, "externalReference": input.ExternalReference, "amountMinor": input.AmountMinor, "currency": input.Currency})
	if err != nil {
		return CreatePaymentResult{}, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, r.baseURL+"/v1/providers/"+provider+"/payments", bytes.NewReader(payload))
	if err != nil {
		return CreatePaymentResult{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotency-Key", input.ExternalReference)
	resp, err := r.client.Do(req)
	if err != nil {
		return CreatePaymentResult{}, fmt.Errorf("%w: create request: %v", ErrProviderUnavailable, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		return CreatePaymentResult{}, fmt.Errorf("%w: create HTTP %d", ErrProviderUnavailable, resp.StatusCode)
	}
	var body struct {
		ProviderKey       string `json:"providerKey"`
		ProviderReference string `json:"providerReference"`
		State             string `json:"state"`
	}
	expectedPrefix := "WM-" + provider + "-"
	if err := json.NewDecoder(io.LimitReader(resp.Body, 4096)).Decode(&body); err != nil ||
		body.ProviderKey != provider || !strings.HasPrefix(body.ProviderReference, expectedPrefix) || len(body.ProviderReference) > 160 || body.State != "PENDING_PROVIDER" {
		return CreatePaymentResult{}, ErrProviderUnavailable
	}
	return CreatePaymentResult{ProviderReference: body.ProviderReference, State: body.State, Simulator: true}, nil
}

func (r *WireMockRail) InquirePayment(ctx context.Context, input PaymentInquiryRequest) (PaymentInquiryResult, error) {
	if !ValidMockProviderKey(input.ProviderKey) || strings.TrimSpace(input.IntentID) == "" {
		return PaymentInquiryResult{}, ErrInvalidRequest
	}
	provider := strings.ToLower(strings.TrimSpace(input.ProviderKey))
	if !strings.HasPrefix(input.ProviderReference, "WM-"+provider+"-") || len(input.ProviderReference) > 160 ||
		strings.ContainsAny(input.ProviderReference, "/\\?#") {
		return PaymentInquiryResult{}, ErrInvalidRequest
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, r.baseURL+"/v1/providers/"+provider+"/payments/"+url.PathEscape(input.ProviderReference), nil)
	if err != nil {
		return PaymentInquiryResult{}, err
	}
	resp, err := r.client.Do(req)
	if err != nil {
		return PaymentInquiryResult{}, fmt.Errorf("%w: inquiry request: %v", ErrProviderUnavailable, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return PaymentInquiryResult{}, fmt.Errorf("%w: inquiry HTTP %d", ErrProviderUnavailable, resp.StatusCode)
	}
	var body struct {
		ProviderKey                  string `json:"providerKey"`
		ProviderReference            string `json:"providerReference"`
		Outcome                      string `json:"outcome"`
		ProviderTransactionReference string `json:"providerTransactionReference"`
		ProviderFeeMinor             int64  `json:"providerFeeMinor"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 4096)).Decode(&body); err != nil ||
		body.ProviderKey != provider || body.ProviderReference != input.ProviderReference || body.ProviderFeeMinor < 0 {
		return PaymentInquiryResult{}, ErrProviderUnavailable
	}
	switch body.Outcome {
	case "SUCCESS":
		if strings.TrimSpace(body.ProviderTransactionReference) == "" || len(body.ProviderTransactionReference) > 160 ||
			!strings.HasPrefix(body.ProviderTransactionReference, "WM-TXN-"+provider+"-") || body.ProviderFeeMinor < 0 {
			return PaymentInquiryResult{}, ErrProviderUnavailable
		}
	case "FAILURE", "UNKNOWN", "DELAYED":
		if body.ProviderTransactionReference != "" || body.ProviderFeeMinor != 0 {
			return PaymentInquiryResult{}, ErrProviderUnavailable
		}
	default:
		return PaymentInquiryResult{}, ErrProviderUnavailable
	}
	return PaymentInquiryResult{Outcome: body.Outcome, ProviderTransactionReference: body.ProviderTransactionReference, ProviderFeeMinor: body.ProviderFeeMinor}, nil
}
