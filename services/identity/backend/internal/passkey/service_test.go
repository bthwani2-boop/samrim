package passkey

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
	"time"

	identityactor "github.com/bthwani2-boop/samrim/services/identity/backend/internal/actor"
	"github.com/bthwani2-boop/samrim/services/identity/backend/internal/challenge"
	"github.com/bthwani2-boop/samrim/services/identity/backend/internal/domain"
	identitysecurity "github.com/bthwani2-boop/samrim/services/identity/backend/internal/security"
	"github.com/bthwani2-boop/samrim/services/identity/backend/internal/session"
	webauthn "github.com/go-webauthn/webauthn/webauthn"
	_ "github.com/lib/pq"
)

func TestOperatorRecoveryKeepsAccessUntilVerifiedReplacementAndCanRetry(t *testing.T) {
	ctx, db := newIsolatedIdentityDatabase(t)
	actors := identityactor.New(db, "")
	root, err := actors.ProvisionFirstOperatorBootstrap(ctx, "operator-bootstrap", domain.ProvisionActorRoleInput{PhoneE164: "+15555550123"})
	if err != nil {
		t.Fatalf("provision isolated founder: %v", err)
	}

	const secret = "isolated-operator-recovery-proof-secret-32"
	recoveryCredential, err := identitysecurity.RandomRecoveryCredential()
	if err != nil {
		t.Fatalf("create isolated recovery credential: %v", err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO identity_operator_recovery_credentials(id,actor_id,credential_hash)
VALUES('operator-recovery-proof',$1,$2)`, root.ActorID, identitysecurity.SHA256Hex(recoveryCredential)); err != nil {
		t.Fatalf("create isolated recovery credential fixture: %v", err)
	}
	oldPasskey := webauthn.Credential{
		ID: []byte("old-operator-passkey"), PublicKey: []byte("test-only-public-key"),
		Flags: webauthn.CredentialFlags{UserPresent: true, UserVerified: true},
	}
	oldPasskeyJSON, err := json.Marshal(oldPasskey)
	if err != nil {
		t.Fatalf("encode old passkey fixture: %v", err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO identity_webauthn_credentials(actor_id,rp_id,credential_id,credential_json)
VALUES($1,'localhost',$2,$3)`, root.ActorID, oldPasskey.ID, oldPasskeyJSON); err != nil {
		t.Fatalf("create old passkey fixture: %v", err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO identity_sessions(id,actor_id,role,access_token_hash,refresh_token_hash,client_instance_id_hash,access_expires_at,refresh_expires_at,absolute_expires_at)
VALUES('operator-recovery-old-session',$1,'operator',repeat('a',64),repeat('b',64),repeat('c',64),clock_timestamp()+interval '15 minutes',clock_timestamp()+interval '1 hour',clock_timestamp()+interval '2 hours')`, root.ActorID); err != nil {
		t.Fatalf("create old session fixture: %v", err)
	}

	sessions := session.New(db, []byte(strings.Repeat("s", 32)), false, nil)
	challengeService := challenge.New(db, actors, sessions, []byte(secret), nil)
	service, err := New(db, sessions, challengeService, Config{RPID: "localhost", Origins: []string{"http://localhost:13000"}, RPName: "Bthwani test"})
	if err != nil {
		t.Fatalf("configure isolated passkey service: %v", err)
	}
	authentication, err := service.BeginAuthentication(ctx)
	if err != nil {
		t.Fatalf("begin isolated operator passkey login: %v", err)
	}
	var authenticationOptions struct {
		UserVerification string `json:"userVerification"`
	}
	if err := json.Unmarshal(authentication.PublicKey, &authenticationOptions); err != nil || authenticationOptions.UserVerification != "required" {
		t.Fatalf("operator passkey login options = %+v (decode error %v); want user verification required", authenticationOptions, err)
	}
	if _, err := service.FinishAuthentication(ctx, domain.OperatorPasskeyAuthenticationFinishRequest{CeremonyID: authentication.CeremonyID, Credential: json.RawMessage(`{}`), ClientInstanceId: "invalid-authenticator-proof"}); !errors.Is(err, domain.ErrUnauthenticated) {
		t.Fatalf("invalid operator passkey login error = %v; want unauthenticated", err)
	}
	var sessionsAfterInvalidLogin int
	if err := db.QueryRowContext(ctx, "SELECT count(*) FROM identity_sessions WHERE actor_id=$1 AND revoked_at IS NULL", root.ActorID).Scan(&sessionsAfterInvalidLogin); err != nil || sessionsAfterInvalidLogin != 1 {
		t.Fatalf("invalid passkey login changed active sessions: count=%d err=%v", sessionsAfterInvalidLogin, err)
	}
	insertRecoveryChallenge(t, ctx, db, root.ActorID, root.PhoneE164, []byte(secret), "operator-recovery-first", "123456")
	input := domain.OperatorPasskeyRecoveryRegistrationOptionsRequest{Phone: root.PhoneE164, RecoveryCredential: recoveryCredential, VerificationCode: "123456"}
	first, err := service.BeginRecoveryRegistration(ctx, input)
	if err != nil {
		t.Fatalf("begin isolated operator passkey recovery: %v", err)
	}
	var options struct {
		AuthenticatorSelection struct {
			ResidentKey        string `json:"residentKey"`
			UserVerification   string `json:"userVerification"`
			RequireResidentKey *bool  `json:"requireResidentKey"`
		} `json:"authenticatorSelection"`
	}
	if err := json.Unmarshal(first.PublicKey, &options); err != nil {
		t.Fatalf("decode recovery WebAuthn options: %v", err)
	}
	if options.AuthenticatorSelection.ResidentKey != "required" || options.AuthenticatorSelection.UserVerification != "required" || options.AuthenticatorSelection.RequireResidentKey == nil || !*options.AuthenticatorSelection.RequireResidentKey {
		t.Fatalf("recovery WebAuthn requirements = %+v; want resident key and user verification required", options.AuthenticatorSelection)
	}
	assertRecoveryAccessUnchanged(t, ctx, db, root.ActorID, first.CeremonyID, true)

	if _, err := service.FinishRecoveryRegistration(ctx, domain.OperatorPasskeyRecoveryFinishRequest{CeremonyID: first.CeremonyID, Credential: json.RawMessage(`{}`), ClientInstanceId: "recovery-attempt-one"}); !errors.Is(err, domain.ErrInvalidChallenge) {
		t.Fatalf("invalid replacement authenticator response error = %v; want invalid challenge", err)
	}
	assertRecoveryAccessUnchanged(t, ctx, db, root.ActorID, first.CeremonyID, true)

	if _, err := db.ExecContext(ctx, "UPDATE identity_webauthn_ceremonies SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1", first.CeremonyID); err != nil {
		t.Fatalf("expire abandoned recovery ceremony fixture: %v", err)
	}
	if _, err := service.FinishRecoveryRegistration(ctx, domain.OperatorPasskeyRecoveryFinishRequest{CeremonyID: first.CeremonyID, Credential: json.RawMessage(`{}`), ClientInstanceId: "recovery-expired-attempt"}); !errors.Is(err, domain.ErrInvalidChallenge) {
		t.Fatalf("expired recovery ceremony error = %v; want invalid challenge", err)
	}
	assertRecoveryAccessUnchanged(t, ctx, db, root.ActorID, first.CeremonyID, true)

	insertRecoveryChallenge(t, ctx, db, root.ActorID, root.PhoneE164, []byte(secret), "operator-recovery-retry", "654321")
	input.VerificationCode = "654321"
	second, err := service.BeginRecoveryRegistration(ctx, input)
	if err != nil {
		t.Fatalf("retry recovery after abandoned ceremony: %v", err)
	}
	assertRecoveryAccessUnchanged(t, ctx, db, root.ActorID, second.CeremonyID, true)

	rollbackTx, err := db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatalf("begin rollback proof transaction: %v", err)
	}
	if err := completeRecoveryTx(ctx, rollbackTx, root.ActorID, second.CeremonyID); err != nil {
		_ = rollbackTx.Rollback()
		t.Fatalf("stage recovery completion for rollback proof: %v", err)
	}
	if err := rollbackTx.Rollback(); err != nil {
		t.Fatalf("roll back recovery completion proof: %v", err)
	}
	assertRecoveryAccessUnchanged(t, ctx, db, root.ActorID, second.CeremonyID, true)

	completionTx, err := db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatalf("begin successful recovery transaction fixture: %v", err)
	}
	defer func() { _ = completionTx.Rollback() }()
	if err := completeRecoveryTx(ctx, completionTx, root.ActorID, second.CeremonyID); err != nil {
		t.Fatalf("complete recovery revocation transition: %v", err)
	}
	replacement := &webauthn.Credential{ID: []byte("replacement-operator-passkey"), PublicKey: []byte("replacement-test-key"), Flags: webauthn.CredentialFlags{UserPresent: true, UserVerified: true}}
	if err := storeCredentialTx(ctx, completionTx, root.ActorID, "localhost", replacement); err != nil {
		t.Fatalf("store replacement passkey fixture: %v", err)
	}
	newRecoveryCredential, err := storeRecoveryCredentialTx(ctx, completionTx, root.ActorID)
	if err != nil || newRecoveryCredential == "" {
		t.Fatalf("rotate recovery credential after replacement: hasCredential=%t err=%v", newRecoveryCredential != "", err)
	}
	if _, err := completionTx.ExecContext(ctx, "UPDATE identity_actor_roles SET activated_at=COALESCE(activated_at,clock_timestamp()),version=version+1,updated_at=clock_timestamp() WHERE actor_id=$1 AND role='operator' AND enabled=true", root.ActorID); err != nil {
		t.Fatalf("activate recovered operator role: %v", err)
	}
	if err := markCeremonyConsumedTx(ctx, completionTx, second.CeremonyID); err != nil {
		t.Fatalf("consume completed recovery ceremony: %v", err)
	}
	if _, err := sessions.CreateTx(ctx, completionTx, root.ActorID, "operator", "operator-recovery-complete"); err != nil {
		t.Fatalf("create replacement session: %v", err)
	}
	if err := completionTx.Commit(); err != nil {
		t.Fatalf("commit successful recovery transition: %v", err)
	}
	assertRecoveryAccessReplaced(t, ctx, db, root.ActorID)

	replayTx, err := db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatalf("begin completed ceremony replay proof: %v", err)
	}
	defer func() { _ = replayTx.Rollback() }()
	if err := lockUnconsumedCeremony(ctx, replayTx, second.CeremonyID, ceremonyRecovery); !errors.Is(err, domain.ErrInvalidChallenge) {
		t.Fatalf("completed recovery ceremony replay error = %v; want invalid challenge", err)
	}
}

func assertRecoveryAccessUnchanged(t *testing.T, ctx context.Context, db *sql.DB, actorID, ceremonyID string, reserved bool) {
	t.Helper()
	var sessionRevoked, passkeyRevoked, recoveryUsed, recoveryRevoked sql.NullTime
	var reservation sql.NullString
	if err := db.QueryRowContext(ctx, "SELECT revoked_at FROM identity_sessions WHERE id='operator-recovery-old-session'").Scan(&sessionRevoked); err != nil {
		t.Fatalf("read old operator session: %v", err)
	}
	if err := db.QueryRowContext(ctx, "SELECT revoked_at FROM identity_webauthn_credentials WHERE actor_id=$1 AND credential_id=$2", actorID, []byte("old-operator-passkey")).Scan(&passkeyRevoked); err != nil {
		t.Fatalf("read old operator passkey: %v", err)
	}
	if err := db.QueryRowContext(ctx, "SELECT used_at,revoked_at,reserved_by_ceremony_id FROM identity_operator_recovery_credentials WHERE id='operator-recovery-proof'").Scan(&recoveryUsed, &recoveryRevoked, &reservation); err != nil {
		t.Fatalf("read existing recovery credential: %v", err)
	}
	if sessionRevoked.Valid || passkeyRevoked.Valid || recoveryUsed.Valid || recoveryRevoked.Valid {
		t.Fatalf("recovery attempt changed canonical access before replacement: sessionRevoked=%t passkeyRevoked=%t recoveryUsed=%t recoveryRevoked=%t", sessionRevoked.Valid, passkeyRevoked.Valid, recoveryUsed.Valid, recoveryRevoked.Valid)
	}
	if reserved && (!reservation.Valid || reservation.String != ceremonyID) {
		t.Fatalf("recovery credential reservation = %q; want ceremony %q", reservation.String, ceremonyID)
	}
	if !reserved && reservation.Valid {
		t.Fatalf("expired recovery reservation still active: %q", reservation.String)
	}
}

func assertRecoveryAccessReplaced(t *testing.T, ctx context.Context, db *sql.DB, actorID string) {
	t.Helper()
	var oldSessionRevoked, oldPasskeyRevoked, oldRecoveryUsed, oldRecoveryRevoked sql.NullTime
	var oldReservation sql.NullString
	if err := db.QueryRowContext(ctx, "SELECT revoked_at FROM identity_sessions WHERE id='operator-recovery-old-session'").Scan(&oldSessionRevoked); err != nil {
		t.Fatalf("read revoked old operator session: %v", err)
	}
	if err := db.QueryRowContext(ctx, "SELECT revoked_at FROM identity_webauthn_credentials WHERE actor_id=$1 AND credential_id=$2", actorID, []byte("old-operator-passkey")).Scan(&oldPasskeyRevoked); err != nil {
		t.Fatalf("read revoked old passkey: %v", err)
	}
	if err := db.QueryRowContext(ctx, "SELECT used_at,revoked_at,reserved_by_ceremony_id FROM identity_operator_recovery_credentials WHERE id='operator-recovery-proof'").Scan(&oldRecoveryUsed, &oldRecoveryRevoked, &oldReservation); err != nil {
		t.Fatalf("read used recovery credential: %v", err)
	}
	var replacementCount, activeRecoveryCount, activeSessionCount int
	if err := db.QueryRowContext(ctx, "SELECT count(*) FROM identity_webauthn_credentials WHERE actor_id=$1 AND credential_id=$2 AND revoked_at IS NULL", actorID, []byte("replacement-operator-passkey")).Scan(&replacementCount); err != nil {
		t.Fatalf("read replacement passkey: %v", err)
	}
	if err := db.QueryRowContext(ctx, "SELECT count(*) FROM identity_operator_recovery_credentials WHERE actor_id=$1 AND used_at IS NULL AND revoked_at IS NULL", actorID).Scan(&activeRecoveryCount); err != nil {
		t.Fatalf("read replacement recovery credential: %v", err)
	}
	if err := db.QueryRowContext(ctx, "SELECT count(*) FROM identity_sessions WHERE actor_id=$1 AND role='operator' AND revoked_at IS NULL", actorID).Scan(&activeSessionCount); err != nil {
		t.Fatalf("read replacement session: %v", err)
	}
	if !oldSessionRevoked.Valid || !oldPasskeyRevoked.Valid || !oldRecoveryUsed.Valid || !oldRecoveryRevoked.Valid || oldReservation.Valid || replacementCount != 1 || activeRecoveryCount != 1 || activeSessionCount != 1 {
		t.Fatalf("successful recovery state: oldSessionRevoked=%t oldPasskeyRevoked=%t oldRecoveryUsed=%t oldRecoveryRevoked=%t oldReservation=%t replacement=%d activeRecovery=%d activeSessions=%d", oldSessionRevoked.Valid, oldPasskeyRevoked.Valid, oldRecoveryUsed.Valid, oldRecoveryRevoked.Valid, oldReservation.Valid, replacementCount, activeRecoveryCount, activeSessionCount)
	}
}

func insertRecoveryChallenge(t *testing.T, ctx context.Context, db *sql.DB, actorID, phone string, secret []byte, challengeID, code string) {
	t.Helper()
	if _, err := db.ExecContext(ctx, `INSERT INTO identity_challenges(id,actor_id,role,purpose,phone_e164,code_hash,request_ip_hash,admissible,status,attempts,expires_at)
VALUES($1,$2,'operator',$3,$4,$5,repeat('a',64),true,'pending',0,clock_timestamp()+interval '10 minutes')`, challengeID, actorID, domain.ChallengeOperatorRecover, phone, identitysecurity.HMAC256Hex(secret, challengeID, domain.ChallengeOperatorRecover, code)); err != nil {
		t.Fatalf("create isolated recovery challenge fixture: %v", err)
	}
}

func newIsolatedIdentityDatabase(t *testing.T) (context.Context, *sql.DB) {
	t.Helper()
	databaseURL := strings.TrimSpace(os.Getenv("IDENTITY_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("IDENTITY_DATABASE_URL is required for isolated Identity passkey proof")
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
	databaseName := fmt.Sprintf("identity_passkey_%d", time.Now().UnixNano())
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
