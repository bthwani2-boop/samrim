package storeaccess

import (
	"context"
	"database/sql"
	"os"
	"strings"
	"testing"
	"time"

	_ "github.com/lib/pq"
)

// A Store's recipient selection cannot cross a concurrent revoke's WLT
// review-to-DSH-commit boundary, even when calls use distinct DB connections.
func TestPayoutRecipientStoreLockSerializesAcrossConnections(t *testing.T) {
	dsn := strings.TrimSpace(os.Getenv("DSH_DATABASE_URL"))
	if dsn == "" {
		t.Skip("isolated DSH_DATABASE_URL required")
	}
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	db.SetMaxOpenConns(3)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	s := &Service{db: db}

	unlockFirst, err := s.lockPayoutRecipientStore(ctx, "gateproof-store-one")
	if err != nil {
		t.Fatal(err)
	}
	firstReleased := false
	defer func() {
		if !firstReleased {
			unlockFirst()
		}
	}()

	second := make(chan error, 1)
	go func() {
		unlock, err := s.lockPayoutRecipientStore(ctx, " gateproof-store-one ")
		if err == nil {
			unlock()
		}
		second <- err
	}()
	// A different Store is not blocked by the first Store's pending payout.
	unlockOther, err := s.lockPayoutRecipientStore(ctx, "gateproof-store-other")
	if err != nil {
		t.Fatalf("unrelated Store blocked: %v", err)
	}
	unlockOther()

	select {
	case err := <-second:
		t.Fatalf("same Store lock was acquired before first transaction ended: %v", err)
	case <-time.After(100 * time.Millisecond):
	}
	unlockFirst()
	firstReleased = true
	select {
	case err := <-second:
		if err != nil {
			t.Fatalf("waiting Store operation failed after unlock: %v", err)
		}
	case <-ctx.Done():
		t.Fatalf("Store lock was not released: %v", ctx.Err())
	}
}
