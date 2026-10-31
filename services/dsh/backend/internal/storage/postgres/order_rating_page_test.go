package postgres

import (
	"errors"
	"strings"
	"testing"
	"time"
)

func TestStoreOrderRatingCursorIsStableAndRejectsInvalidInputs(t *testing.T) {
	date := time.Date(2026, 10, 31, 12, 15, 20, 123456000, time.UTC)
	rating := OrderRatingRecord{OrderID: "order_123", StoreID: "store-a", Rating: 4, CreatedAt: date}
	cursor := storeOrderRatingNextCursor(rating)
	at, orderID, err := decodeStoreOrderRatingCursor(cursor)
	if err != nil || orderID != rating.OrderID || !at.Equal(date) {
		t.Fatalf("valid keyset cursor not preserved: %s %v %v", orderID, at, err)
	}
	zero, emptyOrder, err := decodeStoreOrderRatingCursor("")
	if err != nil || !zero.IsZero() || emptyOrder != "" {
		t.Fatal("empty first-page cursor must be accepted")
	}
	for _, input := range []string{
		"not-a-cursor", strings.Repeat("a", 1025), "eyJhdCI6ImludmFsaWQiLCJvcmRlcklkIjoib3JkZXIifQ",
		"eyJhdCI6IjIwMjYtMTAtMzFUMTI6MDA6MDBaIn0",
	} {
		_, _, err := decodeStoreOrderRatingCursor(input)
		if !errors.Is(err, ErrOrderRatingInvalid) {
			t.Fatalf("invalid cursor %q accepted: %v", input, err)
		}
	}
}

func TestStoreOrderRatingsMustNotReadWithoutCanonicalStoreAndDb(t *testing.T) {
	for _, scope := range []string{"", "store-a", strings.Repeat("s", 129)} {
		if _, err := ListStoreOrderRatings(t.Context(), nil, scope, 20, ""); !errors.Is(err, ErrOrderRatingInvalid) {
			t.Fatalf("nil DB or invalid scope %q was not rejected: %v", scope, err)
		}
	}
}
