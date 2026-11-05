package session

import (
	"database/sql"
	"errors"
	"testing"
	"time"

	"github.com/bthwani2-boop/samrim/services/identity/backend/internal/actor"
	"github.com/bthwani2-boop/samrim/services/identity/backend/internal/domain"
)

// TestHistoricalRefreshReconciliationUsesDatabaseTime exercises real persisted
// token rotation and replay, including a lost response across distinct clocks.
func TestHistoricalRefreshReconciliationUsesDatabaseTime(t *testing.T) {
	ctx, db := newIsolatedIdentityDatabase(t)
	operator, err := actor.New(db, "").ProvisionFirstOperatorBootstrap(ctx, "operator-bootstrap", domain.ProvisionActorRoleInput{PhoneE164: "+15555550123"})
	if err != nil {
		t.Fatalf("bootstrap isolated operator: %v", err)
	}
	svc := New(db, []byte("01234567890123456789012345678901"), true, nil)
	original, err := svc.CreateDevelopment(ctx, "operator", "integration-refresh-client")
	if err != nil {
		t.Fatalf("create isolated session: %v", err)
	}
	if original.Identity.Subject != operator.ActorID {
		t.Fatal("session belongs to wrong actor")
	}

	firstRequest := domain.RefreshRequest{
		RefreshToken:     original.RefreshToken,
		ClientInstanceId: "integration-refresh-client",
		RefreshRequestId: "original-refresh-operation-001",
	}
	first, err := svc.Refresh(ctx, firstRequest)
	if err != nil {
		t.Fatalf("first rotation: %v", err)
	}
	retry, err := svc.Refresh(ctx, firstRequest)
	if err != nil || retry.AccessToken != first.AccessToken || retry.RefreshToken != first.RefreshToken {
		t.Fatalf("lost-response retry must recover identical current token pair: %v", err)
	}

	secondRequest := domain.RefreshRequest{
		RefreshToken:     first.RefreshToken,
		ClientInstanceId: "integration-refresh-client",
		RefreshRequestId: "second-refresh-operation-002",
	}
	second, err := svc.Refresh(ctx, secondRequest)
	if err != nil || second.AccessToken == first.AccessToken {
		t.Fatalf("second rotation must advance token generation: %v", err)
	}
	if _, err := svc.Refresh(ctx, firstRequest); !errors.Is(err, domain.ErrRefreshStale) {
		t.Fatalf("older generation must not recover newest token: %v", err)
	}
	if resolved, err := svc.ResolveAccessToken(ctx, second.AccessToken); err != nil || resolved.Subject != operator.ActorID {
		t.Fatalf("recent old-generation replay must not revoke healthy session: actor=%+v err=%v", resolved, err)
	}
	secondRetry, err := svc.Refresh(ctx, secondRequest)
	if err != nil || secondRetry.AccessToken != second.AccessToken || secondRetry.RefreshToken != second.RefreshToken {
		t.Fatalf("latest-generation recovery should be stable: %v", err)
	}

	// Age both synthetic history rows with the second rotation still latest.
	// This ensures the five-minute limit, not the latest-generation guard,
	// rejects the second request. No shared session or user data is changed.
	if _, err := db.ExecContext(ctx, `UPDATE identity_refresh_token_history
        SET rotated_at=CASE
            WHEN refresh_request_id=$2 THEN clock_timestamp()-interval '7 minutes'
            WHEN refresh_request_id=$3 THEN clock_timestamp()-interval '6 minutes'
        END
        WHERE session_id=$1 AND refresh_request_id IN ($2,$3)`,
		original.Identity.SessionID, firstRequest.RefreshRequestId, secondRequest.RefreshRequestId); err != nil {
		t.Fatalf("age isolated historical tokens: %v", err)
	}
	var latestRequestID string
	var latestRotation time.Time
	var pastDatabaseGrace bool
	if err := db.QueryRowContext(ctx, `SELECT refresh_request_id,rotated_at,
        clock_timestamp() > rotated_at + interval '5 minutes'
        FROM identity_refresh_token_history
        WHERE session_id=$1 ORDER BY rotated_at DESC LIMIT 1`,
		original.Identity.SessionID).Scan(&latestRequestID, &latestRotation, &pastDatabaseGrace); err != nil {
		t.Fatalf("read isolated rotation ordering and database age: %v", err)
	}
	if latestRequestID != secondRequest.RefreshRequestId || !pastDatabaseGrace {
		t.Fatalf("test must replay latest row past database grace: latest=%q dbExpired=%t", latestRequestID, pastDatabaseGrace)
	}
	// The server's deliberately skewed clock sees an age within five minutes,
	// while PostgreSQL sees an age beyond five minutes. The implementation must
	// use the database's clock when deciding whether to recover credentials.
	svc.now = func() time.Time { return time.Now().Add(-2 * time.Minute) }
	hostAge := svc.now().Sub(latestRotation)
	if hostAge < 0 || hostAge >= 5*time.Minute {
		t.Fatalf("test requires host-clock age inside grace; got %v", hostAge)
	}
	if _, err := svc.Refresh(ctx, secondRequest); !errors.Is(err, domain.ErrInvalidRefresh) {
		t.Fatalf("aged latest retry must be rejected as compromised: %v", err)
	}
	var revoked, compromised sql.NullTime
	if err := db.QueryRowContext(ctx, "SELECT revoked_at,compromised_at FROM identity_sessions WHERE id=$1 AND actor_id=$2", original.Identity.SessionID, operator.ActorID).Scan(&revoked, &compromised); err != nil {
		t.Fatalf("read persisted compromise result: %v", err)
	}
	if !revoked.Valid || !compromised.Valid {
		t.Fatalf("old token replay did not persist session revocation: revoked=%t compromised=%t", revoked.Valid, compromised.Valid)
	}
	if _, err := svc.ResolveAccessToken(ctx, second.AccessToken); !errors.Is(err, domain.ErrUnauthenticated) {
		t.Fatalf("revoked session retained authorization: %v", err)
	}
}
