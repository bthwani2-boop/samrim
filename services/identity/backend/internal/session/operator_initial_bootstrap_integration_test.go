package session

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/fxamacker/cbor/v2"
)

func TestInitialOperatorBootstrapRealPostgresAndWebAuthn(t *testing.T) {
	if os.Getenv("BTHWANI_OPERATOR_PASSKEY_INTEGRATION") != "true" {
		t.Skip("NOT_RUN: dedicated PostgreSQL + actual WebAuthn attestation fixture opt-in")
	}
	if os.Getenv("BTHWANI_ISOLATED_TEST_MODE") != "true" ||
		os.Getenv("BTHWANI_OPERATOR_PASSKEY_CONTAINER") != "bthwani-session02-webauthn-pg" {
		t.Fatal("refuse non-disposable Identity Operator bootstrap fixture")
	}
	dsn := os.Getenv("BTHWANI_OPERATOR_PASSKEY_DATABASE_URL")
	u, err := url.Parse(dsn)
	if err != nil || u.Scheme != "postgres" || u.Host != "127.0.0.1:5432" ||
		u.Path != "/refoundation_webauthn_s02" || u.User == nil ||
		u.User.Username() != "bthwani_fido_s02" || u.Query().Get("sslmode") != "disable" {
		t.Fatal("refuse any database except dedicated disposable WebAuthn fixture")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	db.SetMaxOpenConns(10)
	if err = db.PingContext(ctx); err != nil {
		t.Fatal(err)
	}
	nonce, err := operatorPasskeyRandom32()
	if err != nil {
		t.Fatal(err)
	}
	schema := fmt.Sprintf("identity_test_root_s02_%x", nonce[:4])
	for _, filename := range []string{
		"001_session_verification.sql", "002_operator_permission_read.sql",
		"003_verified_customer_merchant_admission.sql", "004_customer_phone_verification.sql",
		"005_operator_permission_management.sql", "006_operator_passkey_credentials.sql",
		"007_operator_merchant_permission_cutover.sql", "008_operator_initial_bootstrap.sql",
	} {
		raw, e := os.ReadFile(filepath.Join("..", "..", "..", "database", "migrations", filename))
		if e != nil {
			t.Fatal(e)
		}
		if _, e = db.ExecContext(ctx, strings.ReplaceAll(string(raw), "__SCHEMA__", schema)); e != nil {
			t.Fatalf("isolated Owner migration %s: %v", filename, e)
		}
	}
	// Remove only the newly random, disposable schema after independent
	// readback. Never touch an already-existing shared Identity namespace.
	defer func() {
		cleanupCtx, cancel := context.WithTimeout(context.Background(), 6*time.Second)
		defer cancel()
		_, _ = db.ExecContext(cleanupCtx, "DROP SCHEMA "+schema+" CASCADE")
	}()
	owner, err := NewPostgresReader(db, schema)
	if err != nil {
		t.Fatal(err)
	}
	auth, err := NewOperatorPasskeyAuth(owner, OperatorPasskeyOriginPolicy{
		RPID: "localhost", Origins: []string{"http://localhost:13000"},
	}, true)
	if err != nil {
		t.Fatal(err)
	}
	if auth.initialRootOrigin != "http://localhost:13000" {
		t.Fatal("strict initial RP origin missing")
	}
	// A preexisting (even synthetic) Operator forbids initial Root bootstrap.
	// These rows belong exclusively to this disposable per-test schema.
	_, err = db.ExecContext(ctx, "INSERT INTO "+schema+".actors(id,status) VALUES('existing-operator-fixture','ACTIVE')")
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.ExecContext(ctx, "INSERT INTO "+schema+".actor_roles(actor_id,role,status) VALUES('existing-operator-fixture','operator','ACTIVE')")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = auth.IssueInitialOperatorTicket(ctx); !errors.Is(err, ErrInitialOperatorBootstrapUnavailable) {
		t.Fatalf("preexisting Operator did not prevent first Root claim: %v", err)
	}
	_, err = db.ExecContext(ctx, "DELETE FROM "+schema+".actor_roles WHERE actor_id='existing-operator-fixture'")
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.ExecContext(ctx, "DELETE FROM "+schema+".actors WHERE id='existing-operator-fixture'")
	if err != nil {
		t.Fatal(err)
	}
	ticket, err := auth.IssueInitialOperatorTicket(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(ticket) != 43 {
		t.Fatal("no high-entropy offline ticket")
	}
	if _, err = auth.IssueInitialOperatorTicket(ctx); !errors.Is(err, ErrInitialOperatorBootstrapUnavailable) {
		t.Fatalf("unexpired ticket must not be reissued: %v", err)
	}
	invalidProof := base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{0x33}, 32))
	if _, err = auth.BeginInitialOperatorRegistration(ctx, invalidProof); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("wrong offline proof accepted: %v", err)
	}
	options, err := auth.BeginInitialOperatorRegistration(ctx, ticket)
	if err != nil {
		t.Fatal(err)
	}
	if options.Options == nil || options.Options.Response.RelyingParty.ID != "localhost" ||
		options.Options.Response.AuthenticatorSelection.UserVerification != "required" ||
		options.Options.Response.AuthenticatorSelection.ResidentKey != "required" {
		t.Fatal("WebAuthn must request resident user-verified credential")
	}
	credID, err := operatorPasskeyRandom32()
	if err != nil {
		t.Fatal(err)
	}
	privateKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	left, right := make([]byte, 32), make([]byte, 32)
	privateKey.PublicKey.X.FillBytes(left)
	privateKey.PublicKey.Y.FillBytes(right)
	cose, err := cbor.Marshal(map[int]any{1: 2, 3: -7, -1: 1, -2: left, -3: right})
	if err != nil {
		t.Fatal(err)
	}
	authData := make([]byte, 37+16+2+len(credID)+len(cose))
	rpHash := sha256.Sum256([]byte("localhost"))
	copy(authData[:32], rpHash[:])
	authData[32] = 0x45 // UP + UV + attested credential data
	binary.BigEndian.PutUint16(authData[53:55], uint16(len(credID)))
	copy(authData[55:55+len(credID)], credID)
	copy(authData[55+len(credID):], cose)
	attestation, err := cbor.Marshal(map[string]any{
		"fmt": "none", "attStmt": map[string]any{}, "authData": authData,
	})
	if err != nil {
		t.Fatal(err)
	}
	encode := base64.RawURLEncoding.EncodeToString
	buildCredential := func(origin string, challenge string) []byte {
		t.Helper()
		clientData, e := json.Marshal(map[string]any{
			"type": "webauthn.create", "challenge": challenge,
			"origin": origin, "crossOrigin": false,
		})
		if e != nil {
			t.Fatal(e)
		}
		out, e := json.Marshal(map[string]any{
			"id": encode(credID), "rawId": encode(credID), "type": "public-key",
			"response": map[string]string{
				"clientDataJSON":    encode(clientData),
				"attestationObject": encode(attestation),
			},
		})
		if e != nil {
			t.Fatal(e)
		}
		return out
	}
	// Owner sees the same WebAuthn challenge but rejects the wrong origin,
	// without creating a Root or consuming a legal human's credential.
	if err = auth.FinishInitialOperatorRegistration(ctx, ticket, options.CeremonyID,
		buildCredential("https://evil.example", options.Options.Response.Challenge.String())); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("forged WebAuthn origin accepted: %v", err)
	}
	// Exact same challenge, with a genuine library-parsed COSE credential and
	// user verification. Competing submissions race for a single Owner marker.
	proof := buildCredential("http://localhost:13000", options.Options.Response.Challenge.String())
	const contenders = 6
	var succeeded atomic.Int32
	var failed atomic.Int32
	var wg sync.WaitGroup
	for range contenders {
		wg.Add(1)
		go func() {
			defer wg.Done()
			e := auth.FinishInitialOperatorRegistration(ctx, ticket, options.CeremonyID, proof)
			if e == nil {
				succeeded.Add(1)
			} else {
				failed.Add(1)
			}
		}()
	}
	wg.Wait()
	if succeeded.Load() != 1 || failed.Load() != contenders-1 {
		t.Fatalf("concurrent registration: successful=%d rejected=%d", succeeded.Load(), failed.Load())
	}
	if _, err = auth.IssueInitialOperatorTicket(ctx); !errors.Is(err, ErrInitialOperatorBootstrapUnavailable) {
		t.Fatalf("second original Owner created: %v", err)
	}
	independent, err := sql.Open("postgres", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer independent.Close()
	var rootID string
	var grants, credentials, audit, completed, sessions int
	q := func(table string) string { return schema + "." + table }
	if err = independent.QueryRowContext(ctx, "SELECT actor_id FROM "+q("operator_bootstrap")+
		" WHERE singleton=true").Scan(&rootID); err != nil {
		t.Fatal(err)
	}
	if err = independent.QueryRowContext(ctx, "SELECT count(*) FROM "+q("operator_permissions")+
		" WHERE actor_id=$1 AND state='ACTIVE'", rootID).Scan(&grants); err != nil {
		t.Fatal(err)
	}
	if err = independent.QueryRowContext(ctx, "SELECT count(*) FROM "+q("operator_passkey_credentials")+
		" WHERE actor_id=$1 AND revoked_at IS NULL", rootID).Scan(&credentials); err != nil {
		t.Fatal(err)
	}
	if err = independent.QueryRowContext(ctx, "SELECT count(*) FROM "+q("operator_passkey_audit")+
		" WHERE actor_id=$1 AND event_kind='ENROLLED'", rootID).Scan(&audit); err != nil {
		t.Fatal(err)
	}
	if err = independent.QueryRowContext(ctx, "SELECT count(*) FROM "+q("operator_initial_bootstrap")+
		" WHERE consumed_at IS NOT NULL AND session_data IS NULL").Scan(&completed); err != nil {
		t.Fatal(err)
	}
	if err = independent.QueryRowContext(ctx, "SELECT count(*) FROM "+q("auth_sessions")+
		" WHERE actor_id=$1", rootID).Scan(&sessions); err != nil {
		t.Fatal(err)
	}
	if grants != 7 || credentials != 1 || audit != 1 || completed != 1 || sessions != 0 {
		t.Fatalf("broken original Owner transaction scopes=%d credentials=%d audit=%d completed=%d sessions=%d",
			grants, credentials, audit, completed, sessions)
	}
	// A registered authenticator still needs a NEW user-verified login
	// assertion. Enrollment must not double as session issuance.
	login, err := auth.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	clientData, err := json.Marshal(map[string]any{
		"type": "webauthn.get", "challenge": login.Options.Response.Challenge,
		"origin": "http://localhost:13000", "crossOrigin": false,
	})
	if err != nil {
		t.Fatal(err)
	}
	assertionData := make([]byte, 37)
	copy(assertionData[:32], rpHash[:])
	assertionData[32] = 0x05 // UP+UV
	binary.BigEndian.PutUint32(assertionData[33:], 1)
	clientHash := sha256.Sum256(clientData)
	signed := append(append([]byte{}, assertionData...), clientHash[:]...)
	normalized := sha256.Sum256(signed)
	signature, err := ecdsa.SignASN1(rand.Reader, privateKey, normalized[:])
	if err != nil {
		t.Fatal(err)
	}
	var handle []byte
	if err = independent.QueryRowContext(ctx, "SELECT user_handle FROM "+q("operator_passkey_users")+
		" WHERE actor_id=$1", rootID).Scan(&handle); err != nil {
		t.Fatal(err)
	}
	assertion, err := json.Marshal(map[string]any{
		"id": encode(credID), "rawId": encode(credID), "type": "public-key",
		"response": map[string]string{
			"clientDataJSON":    encode(clientData),
			"authenticatorData": encode(assertionData),
			"signature":         encode(signature), "userHandle": encode(handle),
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	issued, err := auth.Finish(ctx, login.CeremonyID, assertion)
	if err != nil {
		t.Fatalf("registration did not permit real signed login: %v", err)
	}
	principal, err := NewVerifier(owner).Verify(ctx, "Bearer "+issued.AccessToken)
	if err != nil || principal.ActorID != rootID || principal.Role != "operator" {
		t.Fatalf("signed login failed to verify original Identity Owner: %v", err)
	}
	issuedDigest, err := bearerDigest("Bearer " + issued.AccessToken)
	if err != nil {
		t.Fatal("issued bearer has invalid canonical digest")
	}
	for _, scope := range []string{"operations", "merchant", "catalog", "marketing", "finance", "hr", "platform_policies"} {
		if _, err = owner.LookupPermission(ctx, issuedDigest, scope); err != nil {
			t.Fatalf("first Owner missing canonical permission %s: %v", scope, err)
		}
	}
	if err = auth.FinishInitialOperatorRegistration(ctx, ticket, options.CeremonyID, proof); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("consumed original ticket was reusable: %v", err)
	}
}
