package cashin

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestWireMockRailContract(t *testing.T) {
	var createCount int
	const providerKey = "wallet_provider_test_alpha"
	var inquiryOutcome = "UNKNOWN"
	var inquiryFee int64
	var mismatch bool
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/v1/providers/"+providerKey+"/payments":
			createCount++
			if r.Header.Get("Idempotency-Key") != "ext-123" {
				http.Error(w, "missing idempotency", http.StatusBadRequest)
				return
			}
			w.WriteHeader(http.StatusCreated)
			_, _ = w.Write([]byte(`{"providerKey":"wallet_provider_test_alpha","providerReference":"WM-wallet_provider_test_alpha-ext-123","state":"PENDING_PROVIDER"}`))
		case r.Method == http.MethodGet && r.URL.Path == "/v1/providers/"+providerKey+"/payments/WM-"+providerKey+"-ext-123":
			if inquiryOutcome == "HTTP_500" {
				http.Error(w, "provider error", http.StatusInternalServerError)
				return
			}
			if inquiryOutcome == "TIMEOUT" {
				time.Sleep(150 * time.Millisecond)
				return
			}
			reference := "WM-" + providerKey + "-ext-123"
			if mismatch {
				reference = "WM-other"
			}
			transaction := ""
			if inquiryOutcome == "SUCCESS" {
				transaction = "WM-TXN-" + providerKey + "-ext-123"
			}
			_, _ = fmt.Fprintf(w, `{"providerKey":%q,"providerReference":%q,"outcome":%q,"providerTransactionReference":%q,"providerFeeMinor":%d}`, providerKey, reference, inquiryOutcome, transaction, inquiryFee)
		default:
			http.NotFound(w, r)
		}
	}))
	defer provider.Close()
	rail, err := NewWireMockRail(provider.URL)
	if err != nil {
		t.Fatal(err)
	}
	input := CreatePaymentRequest{ProviderKey: providerKey, IntentID: "funding-123", ExternalReference: "ext-123", AmountMinor: 10000, Currency: "YER"}
	for i := 0; i < 2; i++ {
		got, err := rail.CreatePayment(context.Background(), input)
		if err != nil || got.ProviderReference != "WM-"+providerKey+"-ext-123" || got.State != "PENDING_PROVIDER" {
			t.Fatalf("create attempt %d: %+v err=%v", i, got, err)
		}
	}
	if createCount != 2 {
		t.Fatalf("retry request count = %d", createCount)
	}
	inquiry := PaymentInquiryRequest{ProviderKey: providerKey, IntentID: input.IntentID, ProviderReference: "WM-" + providerKey + "-ext-123"}
	for _, test := range []struct {
		outcome string
		fee     int64
	}{
		{"UNKNOWN", 0}, {"DELAYED", 0}, {"FAILURE", 0}, {"SUCCESS", 37},
	} {
		inquiryOutcome, inquiryFee = test.outcome, test.fee
		got, err := rail.InquirePayment(context.Background(), inquiry)
		if err != nil || got.Outcome != test.outcome || got.ProviderFeeMinor != test.fee {
			t.Fatalf("inquiry %s: %+v err=%v", test.outcome, got, err)
		}
		if test.outcome == "SUCCESS" && got.ProviderTransactionReference != "WM-TXN-"+providerKey+"-ext-123" {
			t.Fatalf("settled provider transaction reference = %q", got.ProviderTransactionReference)
		}
	}
	inquiryOutcome, inquiryFee = "HTTP_500", 0
	if _, err := rail.InquirePayment(context.Background(), inquiry); !errors.Is(err, ErrProviderUnavailable) {
		t.Fatalf("HTTP 500 must leave payment unresolved: %v", err)
	}
	inquiryOutcome = "TIMEOUT"
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Millisecond)
	defer cancel()
	if _, err := rail.InquirePayment(ctx, inquiry); !errors.Is(err, ErrProviderUnavailable) {
		t.Fatalf("timeout must leave payment unresolved: %v", err)
	}
	inquiryOutcome, mismatch = "SUCCESS", true
	if _, err := rail.InquirePayment(context.Background(), inquiry); !errors.Is(err, ErrProviderUnavailable) {
		t.Fatalf("mismatched provider identity accepted: %v", err)
	}
	mismatch, inquiryFee = false, -1
	if _, err := rail.InquirePayment(context.Background(), inquiry); !errors.Is(err, ErrProviderUnavailable) {
		t.Fatalf("negative provider fee accepted: %v", err)
	}
}

func TestWireMockRailConfigurationFailsClosed(t *testing.T) {
	for _, value := range []string{
		"", "https://example.com", "http://example.com:80",
		"http://user:pass@localhost:8080", "http://localhost:8080/?foo=bar",
		"http://localhost:8080/admin", "file:///etc/passwd",
	} {
		if rail, err := NewWireMockRail(value); err == nil || rail != nil {
			t.Fatalf("accepted forbidden development provider endpoint %q", value)
		}
	}
	if _, err := NewWireMockRail("http://payment-mock:8080"); err != nil {
		t.Fatal(err)
	}
	rail, err := NewWireMockRail("http://127.0.0.1:8080")
	if err != nil {
		t.Fatal(err)
	}
	_, err = rail.CreatePayment(context.Background(), CreatePaymentRequest{
		ProviderKey: "wallet_provider_test_alpha", IntentID: "i", ExternalReference: "e", AmountMinor: 0, Currency: "YER",
	})
	if !errors.Is(err, ErrInvalidRequest) {
		t.Fatalf("invalid amount error = %v", err)
	}
	_, err = rail.InquirePayment(context.Background(), PaymentInquiryRequest{
		ProviderKey: "wallet_provider_test_alpha", IntentID: "i", ProviderReference: "WM-../escape",
	})
	if !errors.Is(err, ErrInvalidRequest) {
		t.Fatalf("path escape error = %v", err)
	}
	if !strings.HasPrefix(ErrProviderUnavailable.Error(), "payment provider") {
		t.Fatal("error must remain provider-scoped")
	}
}
