package cashin

import (
	"context"
	"errors"
	"testing"
)

func TestDevelopmentSimulatorCreatePayment(t *testing.T) {
	simulator := DevelopmentSimulator{}
	result, err := simulator.CreatePayment(context.Background(), CreatePaymentRequest{
		IntentID: "funding-1", ExternalReference: "external-1", AmountMinor: 1500, Currency: "YER",
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.ProviderReference != "SIM-external-1" || result.State != "PENDING_PROVIDER" || !result.Simulator {
		t.Fatalf("unexpected simulated payment: %+v", result)
	}

	_, err = simulator.CreatePayment(context.Background(), CreatePaymentRequest{
		IntentID: "funding-1", ExternalReference: "external-1", AmountMinor: 0, Currency: "YER",
	})
	if !errors.Is(err, ErrInvalidRequest) {
		t.Fatalf("invalid payment request error = %v, want ErrInvalidRequest", err)
	}
}

func TestDevelopmentSimulatorInquiryIsUnknown(t *testing.T) {
	result, err := (DevelopmentSimulator{}).InquirePayment(context.Background(), PaymentInquiryRequest{
		IntentID: "funding-1", ProviderReference: "SIM-external-1",
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.Outcome != "UNKNOWN" || result.ProviderTransactionReference != "" {
		t.Fatalf("inquiry must remain non-authoritative until an outcome is simulated: %+v", result)
	}
}

func TestDevelopmentSimulatorOutcomes(t *testing.T) {
	tests := []struct {
		outcome       string
		wantReference string
	}{
		{outcome: "SUCCESS", wantReference: "SIM-TXN-funding-1"},
		{outcome: "FAILURE"},
		{outcome: "UNKNOWN"},
		{outcome: "DELAYED"},
	}
	for _, test := range tests {
		t.Run(test.outcome, func(t *testing.T) {
			result, err := (DevelopmentSimulator{}).Simulate(test.outcome, "funding-1")
			if err != nil {
				t.Fatal(err)
			}
			if result.Outcome != test.outcome || result.ProviderTransactionReference != test.wantReference {
				t.Fatalf("unexpected simulated result: %+v", result)
			}
		})
	}
	if _, err := (DevelopmentSimulator{}).Simulate("PAID", "funding-1"); !errors.Is(err, ErrInvalidRequest) {
		t.Fatalf("unsupported outcome error = %v, want ErrInvalidRequest", err)
	}
}
