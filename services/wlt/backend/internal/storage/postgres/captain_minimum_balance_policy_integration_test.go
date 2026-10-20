package postgres

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/bthwani2-boop/samrim/services/wlt/backend/internal/opsafety"
)

func TestCaptainMinimumBalancePolicyPostgresLifecycle(t *testing.T) {
	url := strings.TrimSpace(os.Getenv("WLT_TEST_DATABASE_URL"))
	if url == "" {
		t.Skip("WLT_TEST_DATABASE_URL is not configured")
	}
	if _, err := opsafety.RequireExpectedDatabaseTarget(url, os.Getenv); err != nil {
		t.Fatal(err)
	}
	db, err := Open(url)
	if err != nil {
		t.Fatal(err)
	}
	// The policy fixture cleanup runs with t.Cleanup, after test defers.
	// Register the database close first so cleanup can still delete its rows.
	t.Cleanup(func() { _ = db.Close() })
	ctx, cancel := context.WithTimeout(context.Background(), 35*time.Second)
	defer cancel()
	if err = migrateFieldAcquisitionTestSchema(ctx, db); err != nil {
		t.Fatal(err)
	}
	var n int
	if err = db.QueryRowContext(ctx, "SELECT COUNT(*) FROM wlt.captain_minimum_balance_policies").Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Skip("dedicated test database already contains captain minimum policies; preserve existing state")
	}
	unique := fmt.Sprintf("captain-min-test-%d", time.Now().UnixNano())
	ids := []string{}
	t.Cleanup(func() {
		for _, id := range ids {
			if _, err := db.ExecContext(context.Background(), "DELETE FROM wlt.captain_minimum_balance_policies WHERE id=$1", id); err != nil {
				t.Errorf("cleanup policy: %v", err)
			}
		}
	})
	if _, err := ReadCaptainMinimumBalancePolicy(ctx, db); !errors.Is(err, ErrCaptainMinimumBalancePolicyNotFound) {
		t.Fatalf("unconfigured policy should be absent: %v", err)
	}
	input := CreateCaptainMinimumBalancePolicyInput{MinimumAvailableMinor: 700, ExpectedVersion: 0,
		Reason: "first captain wallet minimum", ActingActorID: "test-operator", IdempotencyKey: unique + "-first", CorrelationID: unique + "-correlation"}
	a, replay, err := CreateCaptainMinimumBalancePolicy(ctx, db, input)
	if err != nil || replay || a.Version != 1 || a.MinimumAvailableMinor != 700 {
		t.Fatalf("create: %+v replay=%v err=%v", a, replay, err)
	}
	ids = append(ids, a.ID)
	again, replay, err := CreateCaptainMinimumBalancePolicy(ctx, db, input)
	if err != nil || !replay || again.ID != a.ID {
		t.Fatalf("retry: %+v replay=%v err=%v", again, replay, err)
	}
	reused := input
	reused.MinimumAvailableMinor = 800
	if _, _, err = CreateCaptainMinimumBalancePolicy(ctx, db, reused); !errors.Is(err, ErrIdempotencyConflict) {
		t.Fatalf("idempotency conflict: %v", err)
	}
	stale := input
	stale.IdempotencyKey = unique + "-stale"
	stale.MinimumAvailableMinor = 900
	if _, _, err = CreateCaptainMinimumBalancePolicy(ctx, db, stale); !errors.Is(err, ErrVersionConflict) {
		t.Fatalf("expected version conflict: %v", err)
	}
	newer := input
	newer.MinimumAvailableMinor = 1000
	newer.ExpectedVersion = 1
	newer.IdempotencyKey = unique + "-second"
	newer.Reason = "updated captain wallet minimum"
	b, replay, err := CreateCaptainMinimumBalancePolicy(ctx, db, newer)
	if err != nil || replay || b.Version != 2 {
		t.Fatalf("replace: %+v replay=%v err=%v", b, replay, err)
	}
	ids = append(ids, b.ID)
	active, err := ReadCaptainMinimumBalancePolicy(ctx, db)
	if err != nil || active.ID != b.ID || active.MinimumAvailableMinor != 1000 {
		t.Fatalf("readback: %+v err=%v", active, err)
	}
	history, err := ReadCaptainMinimumBalancePolicyHistory(ctx, db, 5)
	if err != nil || len(history) != 2 || history[0].Version != 2 || history[1].State != "RETIRED" {
		t.Fatalf("history: %+v err=%v", history, err)
	}
}
