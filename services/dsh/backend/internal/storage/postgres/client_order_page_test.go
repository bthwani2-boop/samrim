package postgres

import (
	"errors"
	"strings"
	"testing"
	"time"
)

func TestClientOrdersCursorBoundToActorAndStablePage(t *testing.T) {
	expected := clientOrdersCursor{CreatedAt: time.Date(2026, time.October, 15, 2, 0, 0, 0, time.UTC), ID: "order-17", ActorID: "client-a"}
	cursor := encodeClientOrdersCursor(expected)
	got, err := decodeClientOrdersCursor(cursor, "client-a")
	if err != nil || got != expected {
		t.Fatalf("cursor roundtrip = %+v, %v", got, err)
	}
	for _, raw := range []string{"", "not base64", strings.Repeat("X", 4097), encodeClientOrdersCursor(clientOrdersCursor{ID: "bad", ActorID: "client-a"})} {
		if _, err := decodeClientOrdersCursor(raw, "client-a"); !errors.Is(err, ErrClientOrdersInvalidCursor) {
			t.Fatalf("expected invalid cursor for %q, got %v", raw[:min(len(raw), 30)], err)
		}
	}
	if _, err := decodeClientOrdersCursor(cursor, "client-b"); !errors.Is(err, ErrClientOrdersInvalidCursor) {
		t.Fatalf("cross-client cursor accepted: %v", err)
	}
}
