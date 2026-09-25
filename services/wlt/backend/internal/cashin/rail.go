package cashin

import (
	"context"
	"errors"
	"strings"
)

type CreatePaymentRequest struct {
	IntentID          string
	ExternalReference string
	AmountMinor       int64
	Currency          string
}

type CreatePaymentResult struct {
	ProviderReference string
	State             string
	Simulator         bool
}

type PaymentInquiryRequest struct {
	IntentID          string
	ProviderReference string
}

type PaymentInquiryResult struct {
	Outcome                      string
	ProviderTransactionReference string
}

type CashInRail interface {
	CreatePayment(context.Context, CreatePaymentRequest) (CreatePaymentResult, error)
	InquirePayment(context.Context, PaymentInquiryRequest) (PaymentInquiryResult, error)
}

type DevelopmentSimulator struct{}

var ErrInvalidRequest = errors.New("cash-in rail request is invalid")

func (DevelopmentSimulator) CreatePayment(_ context.Context, request CreatePaymentRequest) (CreatePaymentResult, error) {
	if strings.TrimSpace(request.IntentID) == "" || strings.TrimSpace(request.ExternalReference) == "" || request.AmountMinor <= 0 || strings.TrimSpace(request.Currency) != "YER" {
		return CreatePaymentResult{}, ErrInvalidRequest
	}
	return CreatePaymentResult{ProviderReference: "SIM-" + request.ExternalReference, State: "PENDING_PROVIDER", Simulator: true}, nil
}

func (DevelopmentSimulator) InquirePayment(_ context.Context, request PaymentInquiryRequest) (PaymentInquiryResult, error) {
	if strings.TrimSpace(request.IntentID) == "" || strings.TrimSpace(request.ProviderReference) == "" {
		return PaymentInquiryResult{}, ErrInvalidRequest
	}
	return PaymentInquiryResult{Outcome: "UNKNOWN"}, nil
}

func (DevelopmentSimulator) Simulate(outcome string, intentID string) (PaymentInquiryResult, error) {
	outcome = strings.ToUpper(strings.TrimSpace(outcome))
	intentID = strings.TrimSpace(intentID)
	if intentID == "" || (outcome != "SUCCESS" && outcome != "FAILURE" && outcome != "UNKNOWN" && outcome != "DELAYED") {
		return PaymentInquiryResult{}, ErrInvalidRequest
	}
	result := PaymentInquiryResult{Outcome: outcome}
	if outcome == "SUCCESS" {
		result.ProviderTransactionReference = "SIM-TXN-" + intentID
	}
	return result, nil
}
