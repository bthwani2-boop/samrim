package session

import (
	"database/sql"
	"errors"
	"testing"
	"time"

	"github.com/bthwani2-boop/samrim/services/identity/backend/internal/actor"
	"github.com/bthwani2-boop/samrim/services/identity/backend/internal/domain"
)

// TestRefreshRejectsExpiredDatabaseLifetimeDespiteHostClockSkew proves that
// the persisted PostgreSQL expiry, not a lagging app-host clock, controls
// whether an already expired refresh credential may rotate.
func TestRefreshRejectsExpiredDatabaseLifetimeDespiteHostClockSkew(t *testing.T) {
	ctx, db := newIsolatedIdentityDatabase(t)
	synthetic, err := actor.New(db, "").ProvisionFirstOperatorBootstrap(ctx,
		"operator-bootstrap", domain.ProvisionActorRoleInput{PhoneE164: "+15555550591"})
	if err != nil {
		t.Fatalf("bootstrap synthetic operator in disposable database: %v", err)
	}
	svc := New(db, []byte("01234567890123456789012345678901"), true, nil)
	initial, err := svc.CreateDevelopment(ctx, "operator", "isolated-expiry-client")
	if err != nil || initial.Identity.Subject != synthetic.ActorID {
		t.Fatalf("create synthetic session for operator: identity=%+v err=%v", initial.Identity, err)
	}
	if _, err := db.ExecContext(ctx, `UPDATE identity_sessions
		SET access_expires_at=clock_timestamp()-interval '2 seconds', refresh_expires_at=clock_timestamp()-interval '1 second'
		WHERE id=$1 AND actor_id=$2`, initial.Identity.SessionID, synthetic.ActorID); err != nil {
		t.Fatalf("expire synthetic session refresh time in owner DB: %v", err)
	}
	var databaseNow, expiresAt time.Time
	if err := db.QueryRowContext(ctx, `SELECT clock_timestamp(),refresh_expires_at
		FROM identity_sessions WHERE id=$1 AND actor_id=$2`,
		initial.Identity.SessionID, synthetic.ActorID).Scan(&databaseNow, &expiresAt); err != nil {
		t.Fatalf("read authoritative expiry: %v", err)
	}
	svc.now = func() time.Time { return time.Now().Add(-3 * time.Minute) }
	if !databaseNow.After(expiresAt) || !svc.now().Before(expiresAt) {
		t.Fatalf("fixture failed to produce DB-expired but host-unexpired refresh (dbExpired=%t hostSeesValid=%t)",
			databaseNow.After(expiresAt), svc.now().Before(expiresAt))
	}
	_, err = svc.Refresh(ctx, domain.RefreshRequest{
		RefreshToken: initial.RefreshToken, ClientInstanceId: "isolated-expiry-client",
		RefreshRequestId: "expired-database-refresh-001",
	})
	if !errors.Is(err, domain.ErrInvalidRefresh) {
		t.Fatalf("expired PostgreSQL refresh was accepted under host clock skew: %v", err)
	}
	var version, historyCount int
	var revoked sql.NullTime
	if err := db.QueryRowContext(ctx, `SELECT s.version,s.revoked_at,
		(SELECT count(*) FROM identity_refresh_token_history h WHERE h.session_id=s.id)
		FROM identity_sessions s WHERE s.id=$1 AND s.actor_id=$2`,
		initial.Identity.SessionID, synthetic.ActorID).Scan(&version, &revoked, &historyCount); err != nil {
		t.Fatalf("read synthetic session state after expired refresh: %v", err)
	}
	if version != 1 || historyCount != 0 || revoked.Valid {
		t.Fatalf("expired refresh changed persisted generation: version=%d history=%d revoked=%t", version, historyCount, revoked.Valid)
	}

	// A fast application host must not prematurely reject a still-valid
	// PostgreSQL refresh lifetime. Use a second synthetic session so that the
	// earlier intentionally expired fixture remains unaffected.
	fastHost := New(db, []byte("01234567890123456789012345678901"), true, nil)
	stillValid, err := fastHost.CreateDevelopment(ctx, "operator", "isolated-fast-host-instance")
	if err != nil {
		t.Fatalf("create second synthetic valid session: %v", err)
	}
	var validDBNow, validRefreshExpiry time.Time
	if err := db.QueryRowContext(ctx, `SELECT clock_timestamp(),refresh_expires_at
		FROM identity_sessions WHERE id=$1 AND actor_id=$2`,
		stillValid.Identity.SessionID, synthetic.ActorID).Scan(&validDBNow, &validRefreshExpiry); err != nil {
		t.Fatalf("read valid database lifetime: %v", err)
	}
	fastHost.now = func() time.Time { return time.Now().Add(40 * 24 * time.Hour) }
	if !validRefreshExpiry.After(validDBNow) || !fastHost.now().After(validRefreshExpiry) {
		t.Fatalf("fixture requires DB-valid but host-expired refresh (dbValid=%t hostExpired=%t)",
			validRefreshExpiry.After(validDBNow), fastHost.now().After(validRefreshExpiry))
	}
	rotated, err := fastHost.Refresh(ctx, domain.RefreshRequest{
		RefreshToken: stillValid.RefreshToken, ClientInstanceId: "isolated-fast-host-instance",
		RefreshRequestId: "valid-database-fast-host-refresh-001",
	})
	if err != nil || rotated.RefreshToken == stillValid.RefreshToken {
		t.Fatalf("fast host clock rejected a database-valid refresh: %v", err)
	}
	if err := db.QueryRowContext(ctx, `SELECT s.version,s.revoked_at,
		(SELECT count(*) FROM identity_refresh_token_history h WHERE h.session_id=s.id)
		FROM identity_sessions s WHERE s.id=$1 AND s.actor_id=$2`,
		stillValid.Identity.SessionID, synthetic.ActorID).Scan(&version, &revoked, &historyCount); err != nil {
		t.Fatalf("read rotated session persisted state: %v", err)
	}
	if version != 2 || historyCount != 1 || revoked.Valid {
		t.Fatalf("database-valid refresh did not rotate once: version=%d history=%d revoked=%t", version, historyCount, revoked.Valid)
	}
	if resolved, err := New(db, []byte("01234567890123456789012345678901"), true, nil).ResolveAccessToken(ctx, rotated.AccessToken); err != nil || resolved.Subject != synthetic.ActorID {
		t.Fatalf("fresh service could not resolve rotated access: resolved=%+v err=%v", resolved, err)
	}
}

// TestSessionCreationUsesDatabaseClockDespiteHostSkew protects the session
// creation boundary, where the expiry origin must match PostgreSQL checks.
func TestSessionCreationUsesDatabaseClockDespiteHostSkew(t *testing.T) {
	ctx, db := newIsolatedIdentityDatabase(t)
	synthetic, err := actor.New(db, "").ProvisionFirstOperatorBootstrap(ctx,
		"operator-bootstrap", domain.ProvisionActorRoleInput{PhoneE164: "+15555550592"})
	if err != nil {
		t.Fatalf("bootstrap disposable operator: %v", err)
	}

	for _, tc := range []struct {
		name     string
		skew     time.Duration
		instance string
	}{
		{name: "app host one year slow", skew: -365 * 24 * time.Hour, instance: "isolated-creation-slow-host"},
		{name: "app host one year fast", skew: 365 * 24 * time.Hour, instance: "isolated-creation-fast-host"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			svc := New(db, []byte("01234567890123456789012345678901"), true, nil)
			svc.now = func() time.Time { return time.Now().Add(tc.skew) }
			pair, err := svc.CreateDevelopment(ctx, "operator", tc.instance)
			if err != nil || pair.Identity.Subject != synthetic.ActorID {
				t.Fatalf("create operator session with skewed app host: pair=%+v err=%v", pair.Identity, err)
			}

			var databaseNow, lastUsedAt, accessExpiry, refreshExpiry, absoluteExpiry time.Time
			err = db.QueryRowContext(ctx, `SELECT clock_timestamp(),last_used_at,access_expires_at,
				refresh_expires_at,absolute_expires_at FROM identity_sessions
				WHERE id=$1 AND actor_id=$2`, pair.Identity.SessionID, synthetic.ActorID).
				Scan(&databaseNow, &lastUsedAt, &accessExpiry, &refreshExpiry, &absoluteExpiry)
			if err != nil {
				t.Fatalf("read canonical session from disposable PostgreSQL: %v", err)
			}
			if elapsed := databaseNow.Sub(lastUsedAt); elapsed < 0 || elapsed > 5*time.Second {
				t.Fatalf("persisted session creation used host rather than PostgreSQL time: delta=%s", elapsed)
			}
			expectedAccess, expectedRefresh, valid := calculateSessionExpiries(
				"operator", lastUsedAt, lastUsedAt.Add(sessionAbsoluteLifetime("operator", true)), true)
			if !valid || !accessExpiry.Equal(expectedAccess) || !refreshExpiry.Equal(expectedRefresh) ||
				!absoluteExpiry.Equal(lastUsedAt.Add(sessionAbsoluteLifetime("operator", true))) {
				t.Fatalf("creation expiries do not match DB-origin lifetimes: valid=%t access=%s refresh=%s absolute=%s",
					valid, accessExpiry, refreshExpiry, absoluteExpiry)
			}
			if !pair.AccessExpiry.Equal(accessExpiry) {
				t.Fatalf("returned and persisted access expiries disagree: returned=%s DB=%s", pair.AccessExpiry, accessExpiry)
			}
			rotated, err := svc.Refresh(ctx, domain.RefreshRequest{
				RefreshToken: pair.RefreshToken, ClientInstanceId: tc.instance,
				RefreshRequestId: "creation-skew-" + tc.instance,
			})
			if err != nil || rotated.RefreshToken == pair.RefreshToken {
				t.Fatalf("newly created DB-valid session is not refreshable: %v", err)
			}
		})
	}
}
