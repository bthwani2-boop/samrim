package session

import (
	"errors"
	"testing"

	"github.com/bthwani2-boop/samrim/services/identity/backend/internal/actor"
	"github.com/bthwani2-boop/samrim/services/identity/backend/internal/domain"
	identitysecurity "github.com/bthwani2-boop/samrim/services/identity/backend/internal/security"
)

// TestSyntheticCredentialFixturePasswordsAllowed keeps security fixtures within
// the canonical eight-character password policy before a database is available.
func TestSyntheticCredentialFixturePasswordsAllowed(t *testing.T) {
	for _, password := range []string{"CxA9!k2q", "PxB8!m3z", "KxC7!p4r"} {
		if !identitysecurity.PasswordAllowed(password) {
			t.Fatal("synthetic password fixture violates Identity admission policy")
		}
	}
}

// TestOneActorDifferentSurfaceRolesRemainSeparated creates three role-specific
// credentials on a single synthetic actor, using Identity's owner services.
// It proves that password admission, sessions and revocation are role scoped.
func TestOneActorDifferentSurfaceRolesRemainSeparated(t *testing.T) {
	ctx, db := newIsolatedIdentityDatabase(t)
	actors := actor.New(db, "")
	sessions := New(db, []byte("01234567890123456789012345678901"), false, nil)
	const phone = "+15555550491"
	passwords := map[string]string{
		"client":  "CxA9!k2q",
		"partner": "PxB8!m3z",
		"captain": "KxC7!p4r",
	}
	instances := map[string]string{
		"client":  "isolated-client-device",
		"partner": "isolated-partner-device",
		"captain": "isolated-captain-device",
	}
	pairs := make(map[string]domain.TokenPair, 3)

	clientTx, err := db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatalf("begin client fixture: %v", err)
	}
	defer func() { _ = clientTx.Rollback() }()
	client, err := actors.RegisterClientTx(ctx, clientTx, phone, passwords["client"])
	if err != nil {
		t.Fatalf("create isolated client through actor owner: %v", err)
	}
	pairs["client"], err = sessions.CreateTx(ctx, clientTx, client.ID, "client", instances["client"])
	if err != nil {
		t.Fatalf("issue isolated client session: %v", err)
	}
	if err := clientTx.Commit(); err != nil {
		t.Fatalf("commit synthetic client: %v", err)
	}

	for _, role := range []string{"partner", "captain"} {
		view, err := actors.ProvisionTrustedWithContext(ctx, "dsh",
			domain.ProvisionActorRoleInput{PhoneE164: phone, Role: role}, client.ID)
		if err != nil || view.ActorID != client.ID {
			t.Fatalf("provision %s on same actor: view=%+v err=%v", role, view, err)
		}
		tx, err := db.BeginTx(ctx, nil)
		if err != nil {
			t.Fatalf("begin isolated %s enrollment: %v", role, err)
		}
		if err := actors.MarkManagedActivatedTx(ctx, tx, client.ID, role); err != nil {
			_ = tx.Rollback()
			t.Fatalf("activate synthetic %s role: %v", role, err)
		}
		if err := actors.SetManagedPasswordTx(ctx, tx, client.ID, role, passwords[role]); err != nil {
			_ = tx.Rollback()
			t.Fatalf("set synthetic %s password: %v", role, err)
		}
		pair, err := sessions.CreateTx(ctx, tx, client.ID, role, instances[role])
		if err != nil {
			_ = tx.Rollback()
			t.Fatalf("issue synthetic %s session: %v", role, err)
		}
		if err := tx.Commit(); err != nil {
			t.Fatalf("commit synthetic %s enrollment: %v", role, err)
		}
		pairs[role] = pair
	}

	for _, role := range []string{"client", "partner", "captain"} {
		actualActor, hash, _, err := actors.PasswordCredential(ctx, phone, role)
		if err != nil || actualActor.ID != client.ID {
			t.Fatalf("read role-specific %s credential: %v", role, err)
		}
		for _, presentedRole := range []string{"client", "partner", "captain"} {
			got := identitysecurity.VerifyPassword(hash, passwords[presentedRole])
			if got != (presentedRole == role) {
				t.Fatalf("%s password credential accepted=%t for %s password", role, got, presentedRole)
			}
		}
		pair := pairs[role]
		expectedSurface, _ := domain.SurfaceForRole(role)
		if pair.Identity.Subject != client.ID || pair.Identity.Role != role || pair.Identity.Surface != expectedSurface {
			t.Fatalf("%s session was issued for wrong actor/role/surface: %+v", role, pair.Identity)
		}
		resolved, err := sessions.ResolveAccessToken(ctx, pair.AccessToken)
		if err != nil || resolved.Subject != client.ID || resolved.Role != role || resolved.Surface != expectedSurface {
			t.Fatalf("%s session resolution crossed role boundary: resolved=%+v err=%v", role, resolved, err)
		}
	}

	if err := sessions.RevokeRoleSession(ctx, client.ID, "captain", pairs["partner"].Identity.SessionID, "test-service", "wrong-role-denial", ""); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("cross-role session revoke not denied: %v", err)
	}
	if err := sessions.RevokeRoleAll(ctx, client.ID, "partner", "test-service", "partner-only-revoke", ""); err != nil {
		t.Fatalf("revoke partner role only: %v", err)
	}
	for _, role := range []string{"client", "partner", "captain"} {
		_, err := sessions.ResolveAccessToken(ctx, pairs[role].AccessToken)
		if role == "partner" {
			if !errors.Is(err, domain.ErrUnauthenticated) {
				t.Fatalf("revoked partner access still valid: %v", err)
			}
			if _, err := sessions.Refresh(ctx, domain.RefreshRequest{
				RefreshToken: pairs[role].RefreshToken, ClientInstanceId: instances[role],
				RefreshRequestId: "revoked-partner-refresh-001",
			}); !errors.Is(err, domain.ErrInvalidRefresh) {
				t.Fatalf("revoked partner refresh still valid: %v", err)
			}
			continue
		}
		if err != nil {
			t.Fatalf("%s session affected by unrelated partner revoke: %v", role, err)
		}
	}
	for _, role := range []string{"client", "partner", "captain"} {
		listed, err := sessions.ListRole(ctx, client.ID, role)
		if err != nil {
			t.Fatalf("read persisted %s sessions: %v", role, err)
		}
		expected := 1
		if role == "partner" {
			expected = 0
		}
		if len(listed) != expected {
			t.Fatalf("%s active sessions=%d; want %d", role, len(listed), expected)
		}
	}

	// A Control Panel caller cannot disable a managed Captain role, and a
	// stale DSH expectedVersion must not revoke the healthy Captain session.
	captainRole, err := actors.GetRole(ctx, "dsh", client.ID, "captain")
	if err != nil || !captainRole.Enabled {
		t.Fatalf("read active captain role version: view=%+v err=%v", captainRole, err)
	}
	if err := actors.SetRoleEnabledWithContext(ctx, "control-panel", client.ID, "captain", false,
		"synthetic-denied-role-disable", "not owner of managed role", captainRole.RoleVersion, client.ID); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("unauthorized Control Panel captain disable was not refused: %v", err)
	}
	if err := actors.SetRoleEnabledWithContext(ctx, "dsh", client.ID, "captain", false,
		"synthetic-stale-role-disable", "reject stale mutation", captainRole.RoleVersion+1, client.ID); !errors.Is(err, domain.ErrConflict) {
		t.Fatalf("stale captain role version was not rejected: %v", err)
	}
	if _, err := sessions.ResolveAccessToken(ctx, pairs["captain"].AccessToken); err != nil {
		t.Fatalf("denied captain role writes invalidated its active session: %v", err)
	}
	if err := actors.SetRoleEnabledWithContext(ctx, "dsh", client.ID, "captain", false,
		"synthetic-authorized-role-disable", "isolated role disabling proof", captainRole.RoleVersion, client.ID); err != nil {
		t.Fatalf("canonical DSH failed to disable its captain role: %v", err)
	}
	persistedRole, err := actors.GetRole(ctx, "dsh", client.ID, "captain")
	if err != nil || persistedRole.Enabled || persistedRole.RoleVersion != captainRole.RoleVersion+1 {
		t.Fatalf("canonical captain disable not persisted once: view=%+v err=%v", persistedRole, err)
	}
	if _, err := sessions.ResolveAccessToken(ctx, pairs["captain"].AccessToken); !errors.Is(err, domain.ErrUnauthenticated) {
		t.Fatalf("disabled captain retained authorized access: %v", err)
	}
	if _, err := sessions.Refresh(ctx, domain.RefreshRequest{
		RefreshToken: pairs["captain"].RefreshToken, ClientInstanceId: instances["captain"],
		RefreshRequestId: "revoked-captain-role-refresh-001",
	}); !errors.Is(err, domain.ErrInvalidRefresh) {
		t.Fatalf("disabled captain retained authorized refresh: %v", err)
	}
	if stillClient, err := sessions.ResolveAccessToken(ctx, pairs["client"].AccessToken); err != nil || stillClient.Role != "client" {
		t.Fatalf("captain role disable spilled into client role: identity=%+v err=%v", stillClient, err)
	}
	clientSessions, err := sessions.ListRole(ctx, client.ID, "client")
	if err != nil || len(clientSessions) != 1 {
		t.Fatalf("client sessions changed after captain role disabling: count=%d err=%v", len(clientSessions), err)
	}
}
