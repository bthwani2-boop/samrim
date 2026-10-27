package session

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/bthwani2-boop/samrim/services/identity/backend/internal/actor"
	"github.com/bthwani2-boop/samrim/services/identity/backend/internal/domain"
	_ "github.com/lib/pq"
)

func TestDevelopmentOperatorSessionUsesCanonicalInitialOperator(t *testing.T) {
	ctx, db := newIsolatedIdentityDatabase(t)
	view, err := actor.New(db, "").ProvisionFirstOperatorBootstrap(ctx, "operator-bootstrap", domain.ProvisionActorRoleInput{PhoneE164: "+15555550123"})
	if err != nil {
		t.Fatalf("provision isolated initial operator: %v", err)
	}
	secret := []byte("01234567890123456789012345678901")
	service := New(db, secret, true, nil)
	pair, err := service.CreateDevelopment(ctx, "operator", "operator-development-instance")
	if err != nil {
		t.Fatalf("create canonical development operator session without a pin: %v", err)
	}
	if pair.Identity.Subject != view.ActorID || pair.Identity.Role != "operator" || !pair.Identity.CanManageOperatorPermissions {
		t.Fatalf("development session identity = %+v; want canonical permission administrator %q", pair.Identity, view.ActorID)
	}
	// Recreate the service with the same canonical database as after an app restart.
	// The existing session must remain valid without issuing a new operator identity.
	restarted := New(db, secret, true, nil)
	resolved, err := restarted.ResolveAccessToken(ctx, pair.AccessToken)
	if err != nil || resolved.Subject != view.ActorID || resolved.SessionID != pair.Identity.SessionID || !resolved.CanManageOperatorPermissions {
		t.Fatalf("session lost after Identity service restart: identity=%+v err=%v", resolved, err)
	}
	rotated, err := restarted.Refresh(ctx, domain.RefreshRequest{
		RefreshToken: pair.RefreshToken, ClientInstanceId: "operator-development-instance",
		RefreshRequestId: "operator_restart_refresh_attempt_001",
	})
	if err != nil || rotated.Identity.SessionID != pair.Identity.SessionID || rotated.Identity.Subject != view.ActorID || rotated.AccessToken == "" {
		t.Fatalf("refresh failed after Identity restart: identity=%+v err=%v", rotated.Identity, err)
	}
	if verified, verifyErr := New(db, secret, true, nil).ResolveAccessToken(ctx, rotated.AccessToken); verifyErr != nil || verified.SessionID != pair.Identity.SessionID {
		t.Fatalf("refreshed session lost across service instances: identity=%+v err=%v", verified, verifyErr)
	}

	mismatched := New(db, secret, true, map[string]string{"operator": "act_wrong_development_operator"})
	if _, err := mismatched.CreateDevelopment(ctx, "operator", "operator-mismatch-instance"); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("mismatched operator pin error = %v; want forbidden", err)
	}

	if _, err := db.ExecContext(ctx, "UPDATE identity_actor_roles SET enabled=false WHERE actor_id=$1 AND role='operator'", view.ActorID); err != nil {
		t.Fatalf("disable isolated operator role: %v", err)
	}
	if _, err := service.CreateDevelopment(ctx, "operator", "operator-disabled-instance"); !errors.Is(err, domain.ErrConflict) {
		t.Fatalf("disabled operator role error = %v; want conflict", err)
	}
	var enabled bool
	if err := db.QueryRowContext(ctx, "SELECT enabled FROM identity_actor_roles WHERE actor_id=$1 AND role='operator'", view.ActorID).Scan(&enabled); err != nil {
		t.Fatalf("read disabled operator role: %v", err)
	}
	if enabled {
		t.Fatal("development login re-enabled the disabled operator role")
	}
	if _, err := restarted.ResolveAccessToken(ctx, rotated.AccessToken); !errors.Is(err, domain.ErrUnauthenticated) {
		t.Fatalf("disabled operator role retained an active session: %v", err)
	}
	if _, err := db.ExecContext(ctx, "UPDATE identity_actor_roles SET enabled=true WHERE actor_id=$1 AND role='operator'", view.ActorID); err != nil {
		t.Fatalf("restore isolated role fixture: %v", err)
	}
	if _, err := db.ExecContext(ctx, "UPDATE identity_actors SET security_enabled=false WHERE id=$1", view.ActorID); err != nil {
		t.Fatalf("disable isolated actor security: %v", err)
	}
	if _, err := service.CreateDevelopment(ctx, "operator", "operator-security-disabled-instance"); !errors.Is(err, domain.ErrConflict) {
		t.Fatalf("disabled actor security error = %v; want conflict", err)
	}
	var securityEnabled bool
	if err := db.QueryRowContext(ctx, "SELECT security_enabled FROM identity_actors WHERE id=$1", view.ActorID).Scan(&securityEnabled); err != nil {
		t.Fatalf("read disabled actor security: %v", err)
	}
	if securityEnabled {
		t.Fatal("development login re-enabled actor security")
	}
	if _, err := restarted.ResolveAccessToken(ctx, rotated.AccessToken); !errors.Is(err, domain.ErrUnauthenticated) {
		t.Fatalf("disabled operator security retained an active session: %v", err)
	}
}

func TestRevokeRoleSessionIsScopedToTargetActor(t *testing.T) {
	ctx, db := newIsolatedIdentityDatabase(t)
	view, err := actor.New(db, "").ProvisionFirstOperatorBootstrap(ctx, "operator-bootstrap", domain.ProvisionActorRoleInput{PhoneE164: "+15555550123"})
	if err != nil {
		t.Fatalf("provision isolated initial operator: %v", err)
	}
	service := New(db, []byte("01234567890123456789012345678901"), true, nil)
	pair, err := service.CreateDevelopment(ctx, "operator", "operator-revocation-instance")
	if err != nil {
		t.Fatalf("create isolated operator session: %v", err)
	}
	rotated, err := service.Refresh(ctx, domain.RefreshRequest{
		RefreshToken: pair.RefreshToken, ClientInstanceId: "operator-revocation-instance",
		RefreshRequestId: "operator_revocation_refresh_attempt_001",
	})
	if err != nil {
		t.Fatalf("refresh isolated operator session before revocation checks: %v", err)
	}
	if rotated.Identity.SessionID != pair.Identity.SessionID || rotated.Identity.Subject != view.ActorID || rotated.Identity.Role != "operator" {
		t.Fatalf("refreshed session identity = %+v; want same actor, role, and session", rotated.Identity)
	}
	if _, err := service.ResolveAccessToken(ctx, pair.AccessToken); !errors.Is(err, domain.ErrUnauthenticated) {
		t.Fatalf("replaced access token error = %v; want unauthenticated", err)
	}

	if err := service.RevokeRoleSession(ctx, "act_unrelated_actor", "operator", pair.Identity.SessionID, "control-panel", "cross-actor-revoke", ""); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("cross-actor session revocation error = %v; want not found", err)
	}
	if err := service.RevokeRoleSession(ctx, "act_unrelated_actor", "operator", pair.Identity.SessionID, "control-panel", "cross-actor-revoke-retry", ""); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("cross-actor session revocation retry error = %v; want not found", err)
	}
	var revokedAt sql.NullTime
	if err := db.QueryRowContext(ctx, "SELECT revoked_at FROM identity_sessions WHERE id=$1 AND actor_id=$2 AND role='operator'", pair.Identity.SessionID, view.ActorID).Scan(&revokedAt); err != nil {
		t.Fatalf("read session after cross-actor revocation attempt: %v", err)
	}
	if revokedAt.Valid {
		t.Fatal("cross-actor revocation changed the protected session")
	}
	if resolved, err := service.ResolveAccessToken(ctx, rotated.AccessToken); err != nil || resolved.Subject != view.ActorID {
		t.Fatalf("owner session after cross-actor attempt = %+v, %v; want active session for %q", resolved, err, view.ActorID)
	}

	if err := service.RevokeRoleSession(ctx, view.ActorID, "operator", pair.Identity.SessionID, "control-panel", "owner-revoke", ""); err != nil {
		t.Fatalf("owner-scoped session revocation: %v", err)
	}
	if err := db.QueryRowContext(ctx, "SELECT revoked_at FROM identity_sessions WHERE id=$1 AND actor_id=$2 AND role='operator'", pair.Identity.SessionID, view.ActorID).Scan(&revokedAt); err != nil {
		t.Fatalf("read owner-revoked session: %v", err)
	}
	if !revokedAt.Valid {
		t.Fatal("owner-scoped revocation was not persisted")
	}
	if _, err := service.ResolveAccessToken(ctx, rotated.AccessToken); !errors.Is(err, domain.ErrUnauthenticated) {
		t.Fatalf("owner-revoked access token error = %v; want unauthenticated", err)
	}
}

func newIsolatedIdentityDatabase(t *testing.T) (context.Context, *sql.DB) {
	t.Helper()
	databaseURL := strings.TrimSpace(os.Getenv("IDENTITY_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("IDENTITY_DATABASE_URL is required for isolated Identity session proof")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	t.Cleanup(cancel)
	rootDB, err := sql.Open("postgres", databaseURL)
	if err != nil {
		t.Fatalf("open Identity PostgreSQL: %v", err)
	}
	t.Cleanup(func() { _ = rootDB.Close() })
	if err := rootDB.PingContext(ctx); err != nil {
		t.Fatalf("Identity PostgreSQL is not reachable: %v", err)
	}
	databaseName := fmt.Sprintf("identity_session_%d", time.Now().UnixNano())
	if _, err := rootDB.ExecContext(ctx, "CREATE DATABASE "+databaseName); err != nil {
		t.Fatalf("create isolated Identity database: %v", err)
	}
	t.Cleanup(func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cleanupCancel()
		if _, err := rootDB.ExecContext(cleanupCtx, "DROP DATABASE IF EXISTS "+databaseName+" WITH (FORCE)"); err != nil {
			t.Errorf("drop isolated Identity database: %v", err)
		}
	})
	parsedURL, err := url.Parse(databaseURL)
	if err != nil {
		t.Fatalf("parse Identity database URL: %v", err)
	}
	parsedURL.Path = "/" + databaseName
	db, err := sql.Open("postgres", parsedURL.String())
	if err != nil {
		t.Fatalf("open isolated Identity database: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	migrationDirectory := filepath.Join("..", "..", "..", "database", "migrations")
	entries, err := os.ReadDir(migrationDirectory)
	if err != nil {
		t.Fatalf("read Identity migrations: %v", err)
	}
	var migrations []string
	for _, entry := range entries {
		if !entry.IsDir() && strings.HasSuffix(entry.Name(), ".sql") {
			migrations = append(migrations, entry.Name())
		}
	}
	sort.Strings(migrations)
	for _, name := range migrations {
		script, err := os.ReadFile(filepath.Join(migrationDirectory, name))
		if err != nil {
			t.Fatalf("read Identity migration %s: %v", name, err)
		}
		if _, err := db.ExecContext(ctx, string(script)); err != nil {
			t.Fatalf("apply Identity migration %s: %v", name, err)
		}
	}
	return ctx, db
}
