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
	"strings"
	"time"
)

// WireMockRail exercises the external HTTP boundary in development only.
// Its protocol is deliberately a test contract, NOT an undocumented real provider API.
type WireMockRail struct {
	baseURL string
	client  *http.Client
}

var ErrProviderUnavailable = errors.New("payment provider response is unavailable or invalid")

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
	if strings.TrimSpace(input.IntentID) == "" || strings.TrimSpace(input.ExternalReference) == "" || input.AmountMinor <= 0 || input.Currency != "YER" {
		return CreatePaymentResult{}, ErrInvalidRequest
	}
	payload, err := json.Marshal(map[string]any{
		"intentId": input.IntentID, "externalReference": input.ExternalReference,
		"amountMinor": input.AmountMinor, "currency": input.Currency,
	})
	if err != nil {
		return CreatePaymentResult{}, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, r.baseURL+"/v1/payments", bytes.NewReader(payload))
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
		ProviderReference string `json:"providerReference"`
		State             string `json:"state"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 4096)).Decode(&body); err != nil ||
		!strings.HasPrefix(body.ProviderReference, "WM-") || len(body.ProviderReference) > 160 ||
		body.State != "PENDING_PROVIDER" {
		return CreatePaymentResult{}, ErrProviderUnavailable
	}
	return CreatePaymentResult{ProviderReference: body.ProviderReference, State: body.State, Simulator: true}, nil
}

func (r *WireMockRail) InquirePayment(ctx context.Context, input PaymentInquiryRequest) (PaymentInquiryResult, error) {
	if strings.TrimSpace(input.IntentID) == "" || !strings.HasPrefix(input.ProviderReference, "WM-") || len(input.ProviderReference) > 160 ||
		strings.ContainsAny(input.ProviderReference, "/\\?#") {
		return PaymentInquiryResult{}, ErrInvalidRequest
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, r.baseURL+"/v1/payments/"+url.PathEscape(input.ProviderReference), nil)
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
		ProviderReference            string `json:"providerReference"`
		Outcome                      string `json:"outcome"`
		ProviderTransactionReference string `json:"providerTransactionReference"`
		ProviderFeeMinor             int64  `json:"providerFeeMinor"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 4096)).Decode(&body); err != nil ||
		body.ProviderReference != input.ProviderReference || body.ProviderFeeMinor < 0 {
		return PaymentInquiryResult{}, ErrProviderUnavailable
	}
	switch body.Outcome {
	case "SUCCESS":
		if strings.TrimSpace(body.ProviderTransactionReference) == "" || len(body.ProviderTransactionReference) > 160 {
			return PaymentInquiryResult{}, ErrProviderUnavailable
		}
	case "FAILURE", "UNKNOWN", "DELAYED":
		if body.ProviderTransactionReference != "" || body.ProviderFeeMinor != 0 {
			return PaymentInquiryResult{}, ErrProviderUnavailable
		}
	default:
		return PaymentInquiryResult{}, ErrProviderUnavailable
	}
	return PaymentInquiryResult{
		Outcome: body.Outcome, ProviderTransactionReference: body.ProviderTransactionReference,
		ProviderFeeMinor: body.ProviderFeeMinor,
	}, nil
}
