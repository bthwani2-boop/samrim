package session

import (
	"database/sql"
	"errors"
	"testing"

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

	// Isolated time-travel fixture: age only this synthetic historical row.
	// No shared session, wallet, Root Owner or production data is modified.
	if _, err := db.ExecContext(ctx, `UPDATE identity_refresh_token_history
        SET rotated_at=clock_timestamp()-interval '6 minutes'
        WHERE session_id=$1 AND refresh_request_id=$2`, original.Identity.SessionID, firstRequest.RefreshRequestId); err != nil {
		t.Fatalf("age isolated historical token: %v", err)
	}
	if _, err := svc.Refresh(ctx, firstRequest); !errors.Is(err, domain.ErrInvalidRefresh) {
		t.Fatalf("aged replay must be rejected as compromised: %v", err)
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
