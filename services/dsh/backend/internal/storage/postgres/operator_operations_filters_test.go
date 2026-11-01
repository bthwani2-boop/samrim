package postgres

import (
	"errors"
	"testing"
	"time"
)

func TestOperatorOperationsCursorRejectsChangedFilterScope(t *testing.T) {
	baseline := OperatorOrderFilters{
		StoreID: "store-1", StoreName: "مخبز", FromDate: "2026-10-01",
		ToDate: "2026-11-01", PaymentSource: "MIXED", FulfillmentMode: "BTHWANI_CAPTAIN",
	}
	cursor := operatorOperationsCursor{
		UpdatedAt: time.Date(2026, 11, 1, 7, 0, 0, 0, time.UTC),
		ID:        "order-1", State: "CREATED", Query: "customer",
		Sort: "updated_desc", StoreID: baseline.StoreID, StoreName: baseline.StoreName,
		FromDate: baseline.FromDate, ToDate: baseline.ToDate,
		PaymentSource: baseline.PaymentSource, FulfillmentMode: baseline.FulfillmentMode,
	}
	encoded := encodeOperatorOperationsCursor(cursor)
	if got, err := decodeOperatorOperationsCursor(encoded, "CREATED", false, "customer", "updated_desc", baseline); err != nil || got.ID != "order-1" {
		t.Fatalf("valid cursor rejected: %+v, %v", got, err)
	}
	mismatches := []struct {
		name   string
		change func(*OperatorOrderFilters)
	}{
		{"store", func(f *OperatorOrderFilters) { f.StoreID = "store-2" }},
		{"store-name", func(f *OperatorOrderFilters) { f.StoreName = "غيره" }},
		{"from-date", func(f *OperatorOrderFilters) { f.FromDate = "2026-10-02" }},
		{"to-date", func(f *OperatorOrderFilters) { f.ToDate = "2026-11-02" }},
		{"payment-source", func(f *OperatorOrderFilters) { f.PaymentSource = "CASH" }},
		{"fulfillment-mode", func(f *OperatorOrderFilters) { f.FulfillmentMode = "CUSTOMER_PICKUP" }},
	}
	for _, testCase := range mismatches {
		t.Run(testCase.name, func(t *testing.T) {
			changed := baseline
			testCase.change(&changed)
			_, err := decodeOperatorOperationsCursor(encoded, "CREATED", false, "customer", "updated_desc", changed)
			if !errors.Is(err, ErrOperatorOperationInvalidCursor) {
				t.Fatalf("scope mismatch must reject cursor: %v", err)
			}
		})
	}
}
