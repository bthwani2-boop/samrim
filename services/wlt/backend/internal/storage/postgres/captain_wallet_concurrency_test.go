package postgres

import (
	"context"
	"database/sql"
	"os"
	"testing"
	"time"

	_ "github.com/lib/pq"
)

func TestCaptainWalletBalanceLockSerializesTransactions(t *testing.T) {
	databaseURL := os.Getenv("WLT_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("WLT_TEST_DATABASE_URL is not configured")
	}
	db, err := sql.Open("postgres", databaseURL)
	if err != nil {
		t.Fatalf("open WLT concurrency test database: %v", err)
	}
	defer db.Close()
	db.SetMaxOpenConns(3)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := db.PingContext(ctx); err != nil {
		t.Fatalf("connect WLT concurrency test database: %v", err)
	}
	actorID := "captain-wallet-lock-test-" + time.Now().UTC().Format("20060102150405.000000000")
	first, err := db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatalf("begin first balance transaction: %v", err)
	}
	defer first.Rollback()
	if err := lockCaptainWalletBalance(ctx, first, actorID); err != nil {
		t.Fatalf("lock first Captain balance transaction: %v", err)
	}

	secondStarted := make(chan int, 1)
	secondResult := make(chan error, 1)
	go func() {
		second, err := db.BeginTx(ctx, nil)
		if err != nil {
			secondResult <- err
			return
		}
		defer second.Rollback()
		var pid int
		if err := second.QueryRowContext(ctx, "SELECT pg_backend_pid()").Scan(&pid); err != nil {
			secondResult <- err
			return
		}
		secondStarted <- pid
		if err := lockCaptainWalletBalance(ctx, second, actorID); err != nil {
			secondResult <- err
			return
		}
		secondResult <- second.Commit()
	}()

	var secondPID int
	select {
	case secondPID = <-secondStarted:
	case err := <-secondResult:
		t.Fatalf("start second balance transaction: %v", err)
	case <-ctx.Done():
		t.Fatal("second balance transaction did not start before timeout")
	}
	deadline := time.Now().Add(3 * time.Second)
	for {
		var waiting bool
		if err := db.QueryRowContext(ctx, "SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE pid=$1 AND wait_event_type='Lock')", secondPID).Scan(&waiting); err != nil {
			t.Fatalf("read second balance transaction wait state: %v", err)
		}
		if waiting {
			break
		}
		select {
		case err := <-secondResult:
			t.Fatalf("second balance transaction did not wait on the Captain lock: %v", err)
		case <-ctx.Done():
			t.Fatal("second balance transaction never waited on the Captain lock")
		case <-time.After(10 * time.Millisecond):
		}
		if time.Now().After(deadline) {
			t.Fatal("second balance transaction never waited on the Captain lock")
		}
	}
	if err := first.Commit(); err != nil {
		t.Fatalf("commit first balance transaction: %v", err)
	}
	select {
	case err := <-secondResult:
		if err != nil {
			t.Fatalf("second balance transaction after first released its lock: %v", err)
		}
	case <-ctx.Done():
		t.Fatal("second balance transaction did not resume after lock release")
	}
}
