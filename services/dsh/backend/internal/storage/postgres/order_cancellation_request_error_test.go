package postgres_test

import (
	"context"
	"database/sql"
	"errors"
	"testing"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

// An interrupted database read must not be misreported as a missing/foreign Order.
func TestReadClientCancellationRequestPreservesDatabaseError(t *testing.T) {
	db, err := sql.Open("postgres", "postgres://127.0.0.1:1/unreachable?sslmode=disable")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	_, err = postgres.ReadClientCancellationRequest(ctx, db, "order_test", "actor_test")
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("expected context cancellation, not a misleading missing-order error: %v", err)
	}
	if errors.Is(err, postgres.ErrCancellationRequestNotFound) {
		t.Fatalf("database failure was masked as a missing or foreign order: %v", err)
	}
}
