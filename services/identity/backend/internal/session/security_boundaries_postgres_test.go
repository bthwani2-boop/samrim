package session

import (
	"database/sql"
	"errors"
	"sync"
	"testing"

	"github.com/bthwani2-boop/samrim/services/identity/backend/internal/actor"
	"github.com/bthwani2-boop/samrim/services/identity/backend/internal/domain"
	identitysecurity "github.com/bthwani2-boop/samrim/services/identity/backend/internal/security"
)

// TestConcurrentRefreshUsesOnePersistedGeneration verifies that racing refresh
// attempts cannot create two session generations or cross a request-ID boundary.
func TestConcurrentRefreshUsesOnePersistedGeneration(t *testing.T) {
	ctx, db := newIsolatedIdentityDatabase(t)
	owner, err := actor.New(db, "").ProvisionFirstOperatorBootstrap(ctx, "operator-bootstrap", domain.ProvisionActorRoleInput{PhoneE164: "+15555550123"})
	if err != nil {
		t.Fatalf("bootstrap synthetic operator: %v", err)
	}
	svc := New(db, []byte("01234567890123456789012345678901"), true, nil)
	for _, tc := range []struct {
		name      string
		requestID [2]string
	}{
		{name: "same operation is recoverable", requestID: [2]string{"same-operation-refresh-id-001", "same-operation-refresh-id-001"}},
		{name: "different operations do not both rotate", requestID: [2]string{"concurrent-operation-one-001", "concurrent-operation-two-002"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			initial, err := svc.CreateDevelopment(ctx, "operator", "synthetic-concurrent-instance")
			if err != nil {
				t.Fatalf("create isolated session: %v", err)
			}
			var results [2]domain.TokenPair
			var failures [2]error
			start := make(chan struct{})
			var wg sync.WaitGroup
			for i := 0; i < 2; i++ {
				wg.Add(1)
				go func(index int) {
					defer wg.Done()
					<-start
					results[index], failures[index] = svc.Refresh(ctx, domain.RefreshRequest{
						RefreshToken:     initial.RefreshToken,
						ClientInstanceId: "synthetic-concurrent-instance",
						RefreshRequestId: tc.requestID[index],
					})
				}(i)
			}
			close(start)
			wg.Wait()

			successes, stale := 0, 0
			var accepted domain.TokenPair
			for i := range failures {
				switch {
				case failures[i] == nil:
					successes++
					if accepted.AccessToken != "" && (accepted.AccessToken != results[i].AccessToken || accepted.RefreshToken != results[i].RefreshToken) {
						t.Fatal("concurrent refresh produced different accepted token generations")
					}
					accepted = results[i]
				case errors.Is(failures[i], domain.ErrRefreshStale):
					stale++
				default:
					t.Fatalf("unexpected concurrent refresh result %d: %v", i, failures[i])
				}
			}
			if tc.requestID[0] == tc.requestID[1] {
				if successes != 2 || stale != 0 {
					t.Fatalf("same-operation retry: successes=%d stale=%d; want 2/0", successes, stale)
				}
			} else if successes != 1 || stale != 1 {
				t.Fatalf("conflicting operation: successes=%d stale=%d; want 1/1", successes, stale)
			}
			var version, historyCount int
			var revoked sql.NullTime
			if err := db.QueryRowContext(ctx, `SELECT s.version,s.revoked_at,
				(SELECT count(*) FROM identity_refresh_token_history h WHERE h.session_id=s.id)
				FROM identity_sessions s WHERE s.id=$1 AND s.actor_id=$2`,
				initial.Identity.SessionID, owner.ActorID).Scan(&version, &revoked, &historyCount); err != nil {
				t.Fatalf("read canonical session generation: %v", err)
			}
			if version != 2 || historyCount != 1 || revoked.Valid {
				t.Fatalf("racing refresh persisted invalid state: version=%d history=%d revoked=%t", version, historyCount, revoked.Valid)
			}
			if resolved, err := New(db, []byte("01234567890123456789012345678901"), true, nil).ResolveAccessToken(ctx, accepted.AccessToken); err != nil || resolved.Subject != owner.ActorID {
				t.Fatalf("accepted session unavailable on fresh service instance: %v", err)
			}
		})
	}
}

// TestSessionActorDeviceAndExpiryIsolation exercises separate actual actors and
// confirms failed cross-actor/device requests leave their canonical state intact.
func TestSessionActorDeviceAndExpiryIsolation(t *testing.T) {
	ctx, db := newIsolatedIdentityDatabase(t)
	actors := actor.New(db, "")
	svc := New(db, []byte("01234567890123456789012345678901"), false, nil)
	issueClient := func(phone, instance string) domain.TokenPair {
		t.Helper()
		tx, err := db.BeginTx(ctx, nil)
		if err != nil {
			t.Fatalf("begin isolated client registration: %v", err)
		}
		defer func() { _ = tx.Rollback() }()
		client, err := actors.RegisterClientTx(ctx, tx, phone, "CxA9!k2q")
		if err != nil {
			t.Fatalf("register synthetic client: %v", err)
		}
		pair, err := svc.CreateTx(ctx, tx, client.ID, "client", instance)
		if err != nil {
			t.Fatalf("issue synthetic client session: %v", err)
		}
		if err := tx.Commit(); err != nil {
			t.Fatalf("commit synthetic client: %v", err)
		}
		return pair
	}
	first := issueClient("+15555550301", "synthetic-instance-A")
	second := issueClient("+15555550302", "synthetic-instance-B")
	if first.Identity.Subject == second.Identity.Subject || first.Identity.SessionID == second.Identity.SessionID {
		t.Fatal("synthetic clients unexpectedly share an actor or session")
	}
	firstRequest := domain.RefreshRequest{RefreshToken: first.RefreshToken, ClientInstanceId: "synthetic-instance-A", RefreshRequestId: "synthetic-actor-A-refresh-001"}
	if _, err := svc.Refresh(ctx, domain.RefreshRequest{RefreshToken: first.RefreshToken, ClientInstanceId: "synthetic-instance-B", RefreshRequestId: "wrong-device-refresh-request-001"}); !errors.Is(err, domain.ErrInvalidRefresh) {
		t.Fatalf("cross-device refresh was not denied: %v", err)
	}
	if err := svc.RevokeRoleSession(ctx, second.Identity.Subject, "client", first.Identity.SessionID, "test-service", "cross-actor", ""); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("cross-actor revoke was not denied: %v", err)
	}
	if err := svc.RevokeRoleSession(ctx, first.Identity.Subject, "partner", first.Identity.SessionID, "test-service", "cross-role", ""); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("cross-role revoke was not denied: %v", err)
	}
	var revoked sql.NullTime
	if err := db.QueryRowContext(ctx, "SELECT revoked_at FROM identity_sessions WHERE id=$1 AND actor_id=$2", first.Identity.SessionID, first.Identity.Subject).Scan(&revoked); err != nil || revoked.Valid {
		t.Fatalf("denied attempts altered protected session: revoked=%t err=%v", revoked.Valid, err)
	}
	firstRotated, err := svc.Refresh(ctx, firstRequest)
	if err != nil {
		t.Fatalf("owner device cannot refresh after denied attempts: %v", err)
	}
	if err := svc.RevokeRoleAll(ctx, first.Identity.Subject, "client", "test-service", "actor-A-only", ""); err != nil {
		t.Fatalf("revoke only client A: %v", err)
	}
	if _, err := svc.ResolveAccessToken(ctx, firstRotated.AccessToken); !errors.Is(err, domain.ErrUnauthenticated) {
		t.Fatalf("revoked A retains access: %v", err)
	}
	if _, err := svc.Refresh(ctx, domain.RefreshRequest{RefreshToken: firstRotated.RefreshToken, ClientInstanceId: "synthetic-instance-A", RefreshRequestId: "revoked-synthetic-refresh-001"}); !errors.Is(err, domain.ErrInvalidRefresh) {
		t.Fatalf("revoked A retains refresh: %v", err)
	}
	if resolved, err := svc.ResolveAccessToken(ctx, second.AccessToken); err != nil || resolved.Subject != second.Identity.Subject || resolved.Role != "client" {
		t.Fatalf("independent client B affected by A revocation: %v", err)
	}
	if err := db.QueryRowContext(ctx, "SELECT revoked_at FROM identity_sessions WHERE id=$1 AND actor_id=$2", second.Identity.SessionID, second.Identity.Subject).Scan(&revoked); err != nil || revoked.Valid {
		t.Fatalf("actor B session was revoked: revoked=%t err=%v", revoked.Valid, err)
	}
	if _, err := db.ExecContext(ctx, "UPDATE identity_sessions SET access_expires_at=clock_timestamp()-interval '3 seconds', refresh_expires_at=clock_timestamp()-interval '2 seconds', absolute_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1 AND actor_id=$2", second.Identity.SessionID, second.Identity.Subject); err != nil {
		t.Fatalf("expire only synthetic B session: %v", err)
	}
	if _, err := svc.ResolveAccessToken(ctx, second.AccessToken); !errors.Is(err, domain.ErrUnauthenticated) {
		t.Fatalf("expired B access was accepted: %v", err)
	}
	if _, err := svc.Refresh(ctx, domain.RefreshRequest{RefreshToken: second.RefreshToken, ClientInstanceId: "synthetic-instance-B", RefreshRequestId: "expired-synthetic-refresh-001"}); !errors.Is(err, domain.ErrInvalidRefresh) {
		t.Fatalf("expired B refresh was accepted: %v", err)
	}
}

// TestSecurityRefreshFixtureRequestIDsMatchWireContract prevents fixture
// rejections from being mistaken for concurrency or authorization failures.
func TestSecurityRefreshFixtureRequestIDsMatchWireContract(t *testing.T) {
	for _, id := range []string{
		"same-operation-refresh-id-001",
		"concurrent-operation-one-001",
		"concurrent-operation-two-002",
		"synthetic-actor-A-refresh-001",
		"wrong-device-refresh-request-001",
		"revoked-synthetic-refresh-001",
		"expired-synthetic-refresh-001",
		"revoked-partner-refresh-001",
		"expired-database-refresh-001",
		"valid-database-fast-host-refresh-001",
		"revoked-captain-role-refresh-001",
	} {
		if _, err := identitysecurity.NormalizeRefreshRequestId(id); err != nil {
			t.Errorf("synthetic refresh request ID %q violates Identity wire contract: %v", id, err)
		}
	}
}
