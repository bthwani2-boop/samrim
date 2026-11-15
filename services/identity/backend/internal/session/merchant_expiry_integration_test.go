package session

import (
	"context"
	"database/sql"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// This test executes only within the explicit synthetic PostgreSQL owner suite.
// The caller checks that the namespace is fresh and the DB is not protected.
func verifyMerchantExpiredCustomerLockWait(
	t *testing.T, ctx context.Context, db, independent *sql.DB, reader *PostgresReader,
	schema string, exec func(string, ...any), issue func(string, string) (string, [32]byte),
) {
	t.Helper()
	actors, roles, sessions := schema+".actors", schema+".actor_roles", schema+".auth_sessions"
	server := httptest.NewServer(NewHandler(NewVerifier(reader)))
	defer server.Close()

	for _, tc := range []struct {
		id, path         string
		existingMerchant bool
	}{
		{"identity-expiry-admit", "/v1/actors/me/merchant-role", false},
		{"identity-expiry-reentry", "/v1/actors/me/merchant-session", true},
	} {
		t.Run(tc.id, func(t *testing.T) {
			exec("INSERT INTO "+actors+"(id,status,verified_at) VALUES($1,'ACTIVE',clock_timestamp())", tc.id)
			exec("INSERT INTO "+roles+"(actor_id,role,status) VALUES($1,'customer','ACTIVE')", tc.id)
			if tc.existingMerchant {
				exec("INSERT INTO "+roles+"(actor_id,role,status) VALUES($1,'merchant','ACTIVE')", tc.id)
			}
			sourceToken, sourceDigest := issue(tc.id, "customer")
			exec("UPDATE "+sessions+" SET expires_at=clock_timestamp()+interval '1700 milliseconds' WHERE token_digest=$1", sourceDigest[:])

			var priorMerchantDigest [32]byte
			if tc.existingMerchant {
				var previousToken string
				previousToken, priorMerchantDigest = issue(tc.id, "merchant")
				if previousToken == "" {
					t.Fatal("isolated prior Merchant token missing")
				}
			}

			// The actor lock holds the Identity writer AFTER it begins its
			// transaction but BEFORE it can check source credential expiry.
			lockTx, err := independent.BeginTx(ctx, nil)
			if err != nil {
				t.Fatal(err)
			}
			defer lockTx.Rollback()
			var locked string
			err = lockTx.QueryRowContext(ctx, "SELECT id FROM "+actors+" WHERE id=$1 FOR UPDATE", tc.id).Scan(&locked)
			if err != nil || locked != tc.id {
				t.Fatalf("actor lock unavailable: %v", err)
			}

			result := make(chan struct {
				status int
				err    error
			}, 1)
			go func() {
				req, e := http.NewRequestWithContext(ctx, http.MethodPost, server.URL+tc.path, nil)
				if e != nil {
					result <- struct {
						status int
						err    error
					}{err: e}
					return
				}
				req.Header.Set("Authorization", "Bearer "+sourceToken)
				response, e := server.Client().Do(req)
				if e != nil {
					result <- struct {
						status int
						err    error
					}{err: e}
					return
				}
				defer response.Body.Close()
				result <- struct {
					status int
					err    error
				}{status: response.StatusCode}
			}()

			// No PASS without proving the request really waited on the actor
			// lock while the source Customer credential was still current.
			observedLockWait := false
			pollDeadline := time.Now().Add(950 * time.Millisecond)
			for time.Now().Before(pollDeadline) {
				var waiting int
				err = db.QueryRowContext(ctx, `SELECT count(*) FROM pg_catalog.pg_stat_activity
WHERE datname=current_database() AND wait_event_type='Lock'
  AND query LIKE '%FROM auth_sessions AS s%'`).Scan(&waiting)
				if err != nil {
					t.Fatalf("cannot observe isolated DB lock wait: %v", err)
				}
				if waiting > 0 {
					observedLockWait = true
					break
				}
				time.Sleep(20 * time.Millisecond)
			}
			if !observedLockWait {
				t.Fatal("INVALIDATED: source request was not observed waiting on PostgreSQL row lock")
			}

			// Keep the lock until the DB's own clock (not the host clock) says
			// this bearer has expired. This would pass with a stale
			// transaction-start CURRENT_TIMESTAMP without an after-lock check.
			expired := false
			pollDeadline = time.Now().Add(2200 * time.Millisecond)
			for time.Now().Before(pollDeadline) {
				err = db.QueryRowContext(ctx, "SELECT clock_timestamp()>=expires_at FROM "+sessions+" WHERE token_digest=$1", sourceDigest[:]).Scan(&expired)
				if err != nil {
					t.Fatalf("expiration readback failed: %v", err)
				}
				if expired {
					break
				}
				time.Sleep(20 * time.Millisecond)
			}
			if !expired {
				t.Fatal("INVALIDATED: credential not expired by DB clock before releasing lock")
			}
			if err = lockTx.Commit(); err != nil {
				t.Fatalf("actor lock release: %v", err)
			}

			select {
			case got := <-result:
				if got.err != nil || got.status != http.StatusUnauthorized {
					t.Fatalf("expired source credential minted Merchant session: http=%d err=%v", got.status, got.err)
				}
			case <-ctx.Done():
				t.Fatal("Identity writer never completed after expired bearer lock released")
			}

			var roleCount, merchantSessions int
			if err = independent.QueryRowContext(ctx, "SELECT count(*) FROM "+roles+" WHERE actor_id=$1 AND role='merchant'", tc.id).Scan(&roleCount); err != nil {
				t.Fatal(err)
			}
			if err = independent.QueryRowContext(ctx, "SELECT count(*) FROM "+sessions+" WHERE actor_id=$1 AND role='merchant'", tc.id).Scan(&merchantSessions); err != nil {
				t.Fatal(err)
			}
			if !tc.existingMerchant && (roleCount != 0 || merchantSessions != 0) {
				t.Fatalf("expired admission created role/session: role=%d sessions=%d", roleCount, merchantSessions)
			}
			if tc.existingMerchant {
				if roleCount != 1 || merchantSessions != 1 {
					t.Fatalf("expired reentry changed merchant standing: role=%d sessions=%d", roleCount, merchantSessions)
				}
				if p, e := reader.Lookup(ctx, priorMerchantDigest); e != nil || p.ActorID != tc.id || p.Role != "merchant" {
					t.Fatalf("expired reentry revoked independent valid Merchant credential: %#v %v", p, e)
				}
			}

			// Use a synthetic read-only proof of DB clock expiration; never
			// reset auth/role versions or create a second protected identity.
			var stillExpired bool
			if err = independent.QueryRowContext(ctx, "SELECT clock_timestamp()>=expires_at FROM "+sessions+" WHERE token_digest=$1", sourceDigest[:]).Scan(&stillExpired); err != nil || !stillExpired {
				t.Fatalf("source expiration not durable: %t %v", stillExpired, err)
			}
		})
	}
	fmt.Println("IDENTITY_EXPIRED_CUSTOMER_LOCK_WAIT_FAILS_CLOSED_PASS")
}
