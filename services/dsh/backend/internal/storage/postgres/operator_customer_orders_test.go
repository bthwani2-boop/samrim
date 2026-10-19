package postgres_test

import (
	"context"
	"database/sql"
	"encoding/base64"
	"errors"
	"testing"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

func TestOperatorCustomerOrdersRejectsCrossActorAndInvalidCursorsBeforeDatabaseRead(t *testing.T) {
	// sql.Open does not connect: invalid cursors must fail before touching persistence.
	db, err := sql.Open("postgres", "host=127.0.0.1 port=1 dbname=does_not_exist sslmode=disable")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	malformed := "not-base64!"
	_, err = postgres.ListOperatorCustomerOrders(context.Background(), db, "client-a", malformed, 10)
	if !errors.Is(err, postgres.ErrOperatorCustomerOrdersInvalidCursor) {
		t.Fatalf("malformed continuation was accepted: %v", err)
	}

	foreign := base64.RawURLEncoding.EncodeToString([]byte(`{"actorId":"client-a","createdAt":"2026-10-15T12:00:00Z","id":"order-1"}`))
	_, err = postgres.ListOperatorCustomerOrders(context.Background(), db, "client-b", foreign, 10)
	if !errors.Is(err, postgres.ErrOperatorCustomerOrdersInvalidCursor) {
		t.Fatalf("cross-client continuation was accepted: %v", err)
	}

	_, err = postgres.ListOperatorCustomerOrders(context.Background(), db, "client-b", "", 51)
	if err == nil {
		t.Fatal("oversized customer page was accepted")
	}
}
