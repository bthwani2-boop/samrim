package authentication

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
	"github.com/bthwani2-boop/samrim/services/identity/backend/internal/session"
	_ "github.com/lib/pq"
)

// This test uses real Identity owners and PostgreSQL, never retained users or
// the shared Captain app. The runner must supply a task-owned disposable DB.
func TestCaptainTwoActorsLoginRefreshAndReauthentication(t *testing.T) {
	ctx, db := newCaptainProofIdentityDatabase(t)
	actors := actor.New(db, "")
	sessions := session.New(db, []byte("01234567890123456789012345678901"), false, nil)
	auth := New(db, actors, sessions)

	type captainFixture struct {
		phone, password, device, actorID string
	}
	a := captainFixture{phone: "+15555550801", password: "KxC7!p4r", device: "captain-a-test-device"}
	b := captainFixture{phone: "+15555550802", password: "KyC8!q5s", device: "captain-b-test-device"}
	activate := func(f *captainFixture) {
		t.Helper()
		tx, err := db.BeginTx(ctx, nil)
		if err != nil {
			t.Fatal(err)
		}
		client, err := actors.RegisterClientTx(ctx, tx, f.phone, "CxA9!k2q")
		if err != nil {
			_ = tx.Rollback()
			t.Fatal(err)
		}
		if err := tx.Commit(); err != nil {
			t.Fatal(err)
		}
		f.actorID = client.ID
		view, err := actors.ProvisionTrustedWithContext(ctx, "dsh",
			domain.ProvisionActorRoleInput{PhoneE164: f.phone, Role: "captain"}, client.ID)
		if err != nil || view.ActorID != f.actorID {
			t.Fatalf("provision captain for isolated actor: %v", err)
		}
		tx, err = db.BeginTx(ctx, nil)
		if err != nil {
			t.Fatal(err)
		}
		if err := actors.MarkManagedActivatedTx(ctx, tx, client.ID, "captain"); err != nil {
			_ = tx.Rollback()
			t.Fatal(err)
		}
		if err := actors.SetManagedPasswordTx(ctx, tx, client.ID, "captain", f.password); err != nil {
			_ = tx.Rollback()
			t.Fatal(err)
		}
		if err := tx.Commit(); err != nil {
			t.Fatal(err)
		}
	}
	activate(&a)
	activate(&b)
	if a.actorID == "" || b.actorID == "" || a.actorID == b.actorID {
		t.Fatal("two captains did not get separate canonical actors")
	}

	login := func(f captainFixture) domain.TokenPair {
		t.Helper()
		pair, err := auth.LoginManaged(ctx, domain.ManagedPasswordLoginRequest{
			Phone: f.phone, Password: f.password, Role: "captain",
			ClientInstanceId: f.device,
		}, strings.Repeat("a", 64))
		if err != nil {
			t.Fatalf("real managed Captain login: %v", err)
		}
		if pair.Identity.Subject != f.actorID || pair.Identity.Role != "captain" ||
			pair.Identity.Surface != "app-captain" || pair.Identity.SessionID == "" {
			t.Fatal("Captain login returned an unexpected actor, role, or surface")
		}
		return pair
	}
	firstA, firstB := login(a), login(b)
	if firstA.Identity.SessionID == firstB.Identity.SessionID ||
		firstA.AccessToken == firstB.AccessToken {
		t.Fatal("two independent captains shared a session")
	}
	assertOwner := func(token, expectedActor string) {
		t.Helper()
		got, err := sessions.ResolveAccessToken(ctx, token)
		if err != nil || got.Subject != expectedActor ||
			got.Role != "captain" || got.Surface != "app-captain" {
			t.Fatalf("session resolved outside its owner: err=%v", err)
		}
	}
	assertOwner(firstA.AccessToken, a.actorID)
	assertOwner(firstB.AccessToken, b.actorID)

	// Another Captain's real password cannot be used to take over actor B.
	if _, err := auth.LoginManaged(ctx, domain.ManagedPasswordLoginRequest{
		Phone: b.phone, Password: a.password, Role: "captain",
		ClientInstanceId: b.device,
	}, strings.Repeat("b", 64)); !errors.Is(err, domain.ErrUnauthenticated) {
		t.Fatalf("another Captain password was accepted: %v", err)
	}

	// Renewing actor A must keep A, rotate the credential, and not touch B.
	refreshedA, err := sessions.Refresh(ctx, domain.RefreshRequest{
		RefreshToken: firstA.RefreshToken, ClientInstanceId: a.device,
		RefreshRequestId: "captain-a-session-refresh-attempt-001",
	})
	if err != nil || refreshedA.AccessToken == firstA.AccessToken ||
		refreshedA.Identity.Subject != a.actorID ||
		refreshedA.Identity.SessionID != firstA.Identity.SessionID {
		t.Fatalf("Captain A refresh did not preserve actor/session and rotate token: %v", err)
	}
	if _, err := sessions.ResolveAccessToken(ctx, firstA.AccessToken); !errors.Is(err, domain.ErrUnauthenticated) {
		t.Fatalf("previous access token survived a real refresh: %v", err)
	}
	assertOwner(refreshedA.AccessToken, a.actorID)
	assertOwner(firstB.AccessToken, b.actorID)

	// Switching away from A/logging out must not revoke B; new A login is a
	// distinct session and the former A response cannot regain authorization.
	if err := sessions.Logout(ctx, refreshedA.AccessToken); err != nil {
		t.Fatalf("logout Captain A: %v", err)
	}
	if _, err := sessions.ResolveAccessToken(ctx, refreshedA.AccessToken); !errors.Is(err, domain.ErrUnauthenticated) {
		t.Fatalf("logged-out Captain A remains authorized: %v", err)
	}
	assertOwner(firstB.AccessToken, b.actorID)
	reloggedA := login(a)
	if reloggedA.Identity.SessionID == firstA.Identity.SessionID ||
		reloggedA.AccessToken == firstA.AccessToken {
		t.Fatal("Captain A reauthentication reused a revoked session")
	}
	assertOwner(reloggedA.AccessToken, a.actorID)
	assertOwner(firstB.AccessToken, b.actorID)

	for _, f := range []captainFixture{a, b} {
		active, err := sessions.ListRole(ctx, f.actorID, "captain")
		if err != nil || len(active) != 1 {
			t.Fatalf("Captain has unexpected persisted active sessions: %v count=%d", err, len(active))
		}
	}
}

func newCaptainProofIdentityDatabase(t *testing.T) (context.Context, *sql.DB) {
	t.Helper()
	raw := strings.TrimSpace(os.Getenv("IDENTITY_DATABASE_URL"))
	if os.Getenv("BTHWANI_CAPTAIN_AUTH_PROOF_ISOLATED") != "1" || raw == "" {
		t.Skip("requires explicit isolated Captain Identity PostgreSQL proof")
	}
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Hostname() != "127.0.0.1" ||
		parsed.Path != "/bthwani_captain_identity_proof" ||
		parsed.User == nil || parsed.User.Username() != "captain_proof" {
		t.Fatal("refusing Captain Identity proof against a non-disposable database")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	t.Cleanup(cancel)
	root, err := sql.Open("postgres", raw)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = root.Close() })
	if err := root.PingContext(ctx); err != nil {
		t.Fatal(err)
	}
	name := fmt.Sprintf("identity_captain_test_%d", time.Now().UnixNano())
	if _, err := root.ExecContext(ctx, "CREATE DATABASE "+name); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		if _, err := root.ExecContext(cleanup, "DROP DATABASE IF EXISTS "+name+" WITH (FORCE)"); err != nil {
			t.Errorf("disposable Captain Identity database cleanup: %v", err)
		}
	})
	childURL := *parsed
	childURL.Path = "/" + name
	db, err := sql.Open("postgres", childURL.String())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if err := db.PingContext(ctx); err != nil {
		t.Fatal(err)
	}
	migrationDir := filepath.Join("..", "..", "..", "database", "migrations")
	entries, err := os.ReadDir(migrationDir)
	if err != nil {
		t.Fatal(err)
	}
	names := []string{}
	for _, entry := range entries {
		if !entry.IsDir() && strings.HasSuffix(entry.Name(), ".sql") {
			names = append(names, entry.Name())
		}
	}
	sort.Strings(names)
	for _, migration := range names {
		script, err := os.ReadFile(filepath.Join(migrationDir, migration))
		if err != nil {
			t.Fatal(err)
		}
		if _, err := db.ExecContext(ctx, string(script)); err != nil {
			t.Fatalf("apply disposable Identity migration %s: %v", migration, err)
		}
	}
	return ctx, db
}
