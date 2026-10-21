package postgres

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"testing"
)

// Operator cancellation must reject malformed review evidence before opening
// a database transaction; a caller must never reach decisionReason[0] unchecked.
func TestOperatorCancellationReviewRejectsMalformedEvidenceBeforeDatabase(t *testing.T) {
	db, err := sql.Open("postgres", "postgres://127.0.0.1:1/unreachable?sslmode=disable")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	for _, tc := range []struct {
		name   string
		review []string
	}{
		{name: "missing", review: nil},
		{name: "missing review flag", review: []string{"Store review was completed"}},
		{name: "short reason", review: []string{"short", "false"}},
		{name: "invalid review flag", review: []string{"Store review was completed", "yes"}},
		{name: "extra review field", review: []string{"Store review was completed", "true", "extra"}},
		{name: "whitespace reason", review: []string{"              ", "false"}},
		{name: "oversized reason", review: []string{strings.Repeat("a", 501), "false"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, _, err := transitionOrder(ctx, db, "order-proof", "CANCELLED", 1,
				"cancel-proof-key", "proof-hash", "operator", "proof-correlation",
				"operator_cancelled", tc.review...)
			if !errors.Is(err, ErrOrderTransitionInvalid) {
				t.Fatalf("malformed operator review must fail before DB: %v", err)
			}
		})
	}
	for _, approved := range []string{"true", "false"} {
		t.Run("valid shape "+approved, func(t *testing.T) {
			_, _, err := transitionOrder(ctx, db, "order-proof", "CANCELLED", 1,
				"cancel-proof-key", "proof-hash", "operator", "proof-correlation",
				"operator_cancelled", "Store review was completed", approved)
			if !errors.Is(err, context.Canceled) {
				t.Fatalf("well-formed review must proceed to DB and honor context: %v", err)
			}
		})
	}
}
