package session

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// The isolated owner-backed suite invokes this after bootstrapping a fresh
// identity_test_* schema. A request admitted before expiration may not use
// its transaction-start timestamp after waiting for a competing row lock.
func verifyExpiredLogoutLockWait(
	t *testing.T, ctx context.Context, db, independent *sql.DB, reader *PostgresReader,
	schema string, exec func(string, ...any), issue func(string, string) (string, [32]byte),
) {
	t.Helper()
	const actor = "identity-expiring-logout"
	actors, roles, sessions := schema+".actors", schema+".actor_roles", schema+".auth_sessions"
	exec("INSERT INTO "+actors+"(id,status) VALUES($1,'ACTIVE')", actor)
	exec("INSERT INTO "+roles+"(actor_id,role,status) VALUES($1,'customer','ACTIVE')", actor)
	token, digest := issue(actor, "customer")
	exec("UPDATE "+sessions+" SET expires_at=clock_timestamp()+interval '2200 milliseconds' WHERE token_digest=$1", digest[:])

	lockTx, err := independent.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer lockTx.Rollback()
	var lockedDigest []byte
	if err := lockTx.QueryRowContext(ctx,
		"SELECT token_digest FROM "+sessions+" WHERE token_digest=$1 FOR UPDATE", digest[:],
	).Scan(&lockedDigest); err != nil || len(lockedDigest) != len(digest) {
		t.Fatalf("cannot lock synthetic current session: %v", err)
	}

	server := httptest.NewServer(NewHandler(NewVerifier(reader)))
	defer server.Close()
	type result struct {
		status int
		err    error
	}
	outcome := make(chan result, 1)
	go func() {
		req, err := http.NewRequestWithContext(ctx, http.MethodDelete, server.URL+"/v1/sessions/current", nil)
		if err != nil {
			outcome <- result{err: err}
			return
		}
		req.Header.Set("Authorization", "Bearer "+token)
		response, err := server.Client().Do(req)
		if err != nil {
			outcome <- result{err: err}
			return
		}
		defer response.Body.Close()
		outcome <- result{status: response.StatusCode}
	}()

	observedWait := false
	deadline := time.Now().Add(1100 * time.Millisecond)
	for time.Now().Before(deadline) {
		var waiters int
		err := db.QueryRowContext(ctx, `SELECT count(*) FROM pg_catalog.pg_stat_activity
WHERE datname=current_database() AND wait_event_type='Lock'
AND (query LIKE '%UPDATE auth_sessions AS s%' OR query LIKE '%SELECT token_digest FROM auth_sessions%')`).Scan(&waiters)
		if err != nil {
			t.Fatalf("cannot observe synthetic lock wait: %v", err)
		}
		if waiters > 0 {
			observedWait = true
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if !observedWait {
		t.Fatal("INVALIDATED: logout did not wait for locked session")
	}

	expired := false
	deadline = time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if err := db.QueryRowContext(ctx,
			"SELECT clock_timestamp()>=expires_at FROM "+sessions+" WHERE token_digest=$1", digest[:],
		).Scan(&expired); err != nil {
			t.Fatal("cannot check owner clock:", err)
		}
		if expired {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if !expired {
		t.Fatal("INVALIDATED: source bearer did not expire while logout waited")
	}
	if err := lockTx.Commit(); err != nil {
		t.Fatal("failed to release isolated session lock:", err)
	}

	select {
	case got := <-outcome:
		if got.err != nil || got.status != http.StatusUnauthorized {
			t.Fatalf("expired bearer was authorized after lock wait: status=%d err=%v", got.status, got.err)
		}
	case <-ctx.Done():
		t.Fatal("logout did not return after the competing lock was released")
	}
	var stillUnrevoked, stillExpired bool
	if err := independent.QueryRowContext(ctx, `SELECT revoked_at IS NULL,
clock_timestamp()>=expires_at FROM `+sessions+` WHERE token_digest=$1`, digest[:],
	).Scan(&stillUnrevoked, &stillExpired); err != nil || !stillUnrevoked || !stillExpired {
		t.Fatalf("expired logout modified durable session: unrevoked=%t expired=%t err=%v",
			stillUnrevoked, stillExpired, err)
	}
	if _, err := reader.Lookup(ctx, digest); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("expired bearer remained authenticated: %v", err)
	}
}
