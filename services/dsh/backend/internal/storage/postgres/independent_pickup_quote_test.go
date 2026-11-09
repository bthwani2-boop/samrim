package postgres

import (
	"context"
	"errors"
	"strings"
	"testing"
)

func TestIndependentPickupQuoteInputFailsClosedBeforeDB(t *testing.T) {
	valid := []IndependentDirectOrderLineRequest{{OfferID: "offer-a", QuantityBaseUnits: 2}}
	for _, tc := range []struct {
		name  string
		lines []IndependentDirectOrderLineRequest
	}{
		{"missing items", nil},
		{"duplicate Offer", []IndependentDirectOrderLineRequest{{OfferID: "offer-a", QuantityBaseUnits: 1}, {OfferID: "offer-a", QuantityBaseUnits: 2}}},
		{"duplicate after whitespace normalization", []IndependentDirectOrderLineRequest{{OfferID: " offer-a ", QuantityBaseUnits: 1}, {OfferID: "offer-a", QuantityBaseUnits: 2}}},
		{"zero quantity", []IndependentDirectOrderLineRequest{{OfferID: "offer-a", QuantityBaseUnits: 0}}},
		{"negative quantity", []IndependentDirectOrderLineRequest{{OfferID: "offer-a", QuantityBaseUnits: -1}}},
		{"newline in Offer", []IndependentDirectOrderLineRequest{{OfferID: "offer-a\nforged", QuantityBaseUnits: 1}}},
		{"invalid unicode", []IndependentDirectOrderLineRequest{{OfferID: string([]byte{0xff}), QuantityBaseUnits: 1}}},
		{"oversized Offer ID", []IndependentDirectOrderLineRequest{{OfferID: strings.Repeat("x", 129), QuantityBaseUnits: 1}}},
		{"too many items", func() []IndependentDirectOrderLineRequest {
			items := make([]IndependentDirectOrderLineRequest, 21)
			for i := range items {
				items[i] = IndependentDirectOrderLineRequest{OfferID: strings.Repeat("x", i+1), QuantityBaseUnits: 1}
			}
			return items
		}()},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := QuoteIndependentPickup(context.Background(), nil, "legal-v1", "store-a", tc.lines); !errors.Is(err, ErrIndependentOrderInvalid) {
				t.Fatalf("untrusted quote cart reached database: %v", err)
			}
		})
	}
	if _, err := QuoteIndependentPickup(context.Background(), nil, "legal-v1", "store-a", valid); !errors.Is(err, ErrIndependentOrderUnavailable) {
		t.Fatalf("quote without DSH owner must remain unavailable: %v", err)
	}
	if _, err := QuoteIndependentPickup(context.Background(), nil, "", "store-a", valid); !errors.Is(err, ErrIndependentOrderUnavailable) {
		t.Fatalf("quote without legally admitted Terms must remain unavailable: %v", err)
	}
}

func TestIndependentPickupQuoteDoesNotMutateCallerCart(t *testing.T) {
	original := []IndependentDirectOrderLineRequest{
		{OfferID: " offer-a ", QuantityBaseUnits: 2},
		{OfferID: "offer-b", QuantityBaseUnits: 1},
	}
	normalized, err := normalizeIndependentPickupQuoteLines(original)
	if err != nil {
		t.Fatal(err)
	}
	if original[0].OfferID != " offer-a " || normalized[0].OfferID != "offer-a" {
		t.Fatalf("quote normalization mutated client cart: caller=%+v own=%+v", original, normalized)
	}
	normalized[0].QuantityBaseUnits = 99
	if original[0].QuantityBaseUnits != 2 {
		t.Fatal("normalized quote lines must own separate backing storage")
	}
}
