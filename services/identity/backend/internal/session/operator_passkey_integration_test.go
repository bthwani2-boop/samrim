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
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/fxamacker/cbor/v2"
	"github.com/go-webauthn/webauthn/webauthn"
)

// This is an opt-in live cryptographic verification test, not a fake Identity
// owner or HTTP 200 smoke. It runs ONLY inside a dedicated disposable,
// network-isolated PostgreSQL with synthetic actor/credential fixtures.
func TestOperatorPasskeyRealWebAuthnSignatureSQL(t *testing.T) {
	if os.Getenv("BTHWANI_OPERATOR_PASSKEY_INTEGRATION") != "true" {
		t.Skip("NOT_RUN: explicit synthetic PostgreSQL WebAuthn integration opt-in")
	}
	if os.Getenv("BTHWANI_ISOLATED_TEST_MODE") != "true" ||
		os.Getenv("BTHWANI_OPERATOR_PASSKEY_CONTAINER") != "bthwani-session02-webauthn-pg" {
		t.Fatal("refuse non-isolated Identity WebAuthn database")
	}
	dsn := os.Getenv("BTHWANI_OPERATOR_PASSKEY_DATABASE_URL")
	u, err := url.Parse(dsn)
	if err != nil || u.Scheme != "postgres" || u.Host != "127.0.0.1:5432" ||
		u.Path != "/refoundation_webauthn_s02" || u.User == nil ||
		u.User.Username() != "bthwani_fido_s02" || u.Query().Get("sslmode") != "disable" {
		t.Fatal("refuse any database except dedicated disposable WebAuthn fixture")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 70*time.Second)
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
	var databaseName string
	if err = db.QueryRowContext(ctx, "SELECT current_database()").Scan(&databaseName); err != nil || databaseName != "refoundation_webauthn_s02" {
		t.Fatal("unexpected DB name")
	}
	nonce, err := operatorPasskeyRandom32()
	if err != nil {
		t.Fatal(err)
	}
	schema := fmt.Sprintf("identity_test_webauthn_s02_%x", nonce[:4])
	for _, name := range []string{
		"001_session_verification.sql", "002_operator_permission_read.sql",
		"003_verified_customer_merchant_admission.sql", "004_customer_phone_verification.sql",
		"005_operator_permission_management.sql", "006_operator_passkey_credentials.sql",
		"007_operator_merchant_permission_cutover.sql",
	} {
		raw, e := os.ReadFile(filepath.Join("..", "..", "..", "database", "migrations", name))
		if e != nil {
			t.Fatalf("owner SQL missing %s: %v", name, e)
		}
		if _, e = db.ExecContext(ctx, strings.ReplaceAll(string(raw), "__SCHEMA__", schema)); e != nil {
			t.Fatalf("synthetic migration %s rejected: %v", name, e)
		}
	}
	owner, err := NewPostgresReader(db, schema)
	if err != nil {
		t.Fatal(err)
	}
	rpID := "localhost"
	origin := "http://localhost:13000"
	service, err := NewOperatorPasskeyAuth(owner, OperatorPasskeyOriginPolicy{
		RPID: rpID, Origins: []string{origin},
	}, true)
	if err != nil {
		t.Fatal(err)
	}
	handler := NewOperatorPasskeyHandler(service)
	server := httptest.NewServer(handler)
	defer server.Close()
	client := &http.Client{Timeout: 5 * time.Second}

	actor := "operator-passkey-synthetic-s02"
	userHandle, err := operatorPasskeyRandom32()
	if err != nil {
		t.Fatal(err)
	}
	credentialID, err := operatorPasskeyRandom32()
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
	// COSE EC2 / ES256, using the same public-key representation the upstream
	// WebAuthn verifier expects; only a real matching ECDSA signature can pass.
	publicKey, err := cbor.Marshal(map[int]any{1: 2, 3: -7, -1: 1, -2: left, -3: right})
	if err != nil {
		t.Fatal(err)
	}
	cred := webauthn.Credential{
		ID: credentialID, PublicKey: publicKey,
		Flags:           webauthn.CredentialFlags{UserPresent: true, UserVerified: true},
		Authenticator:   webauthn.Authenticator{SignCount: 0},
		AttestationType: "none", AttestationFormat: "none",
	}
	credJSON, err := json.Marshal(cred)
	if err != nil {
		t.Fatal(err)
	}
	q := func(table string) string { return schema + "." + table }
	if _, err = db.ExecContext(ctx, "INSERT INTO "+q("actors")+
		"(id,status,verified_at) VALUES($1,'ACTIVE',clock_timestamp())", actor); err != nil {
		t.Fatal(err)
	}
	if _, err = db.ExecContext(ctx, "INSERT INTO "+q("actor_roles")+
		"(actor_id,role,status) VALUES($1,'operator','ACTIVE')", actor); err != nil {
		t.Fatal(err)
	}
	if _, err = db.ExecContext(ctx, "INSERT INTO "+q("operator_passkey_users")+
		"(rp_id,actor_id,user_handle) VALUES($1,$2,$3)", rpID, actor, userHandle); err != nil {
		t.Fatal(err)
	}
	if _, err = db.ExecContext(ctx, "INSERT INTO "+q("operator_passkey_credentials")+
		"(rp_id,credential_id,actor_id,credential_json) VALUES($1,$2,$3,$4)",
		rpID, credentialID, actor, string(credJSON)); err != nil {
		t.Fatal(err)
	}

	begin := func() OperatorPasskeyAssertionOptions {
		t.Helper()
		request, err := http.NewRequestWithContext(ctx, http.MethodPost,
			server.URL+OperatorPasskeyOptionsPath, http.NoBody)
		if err != nil {
			t.Fatal(err)
		}
		response, err := client.Do(request)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		if response.StatusCode != 200 || response.Header.Get("Cache-Control") != "no-store" {
			t.Fatalf("WebAuthn begin HTTP %d", response.StatusCode)
		}
		var options OperatorPasskeyAssertionOptions
		if err = json.NewDecoder(io.LimitReader(response.Body, 20480)).Decode(&options); err != nil {
			t.Fatal(err)
		}
		if len(options.CeremonyID) != 43 || options.Options == nil ||
			len(options.Options.Response.Challenge) < 32 || options.Options.Response.RelyingPartyID != rpID {
			t.Fatal("invalid library-generated passkey challenge/RPID")
		}
		return options
	}
	sign := func(options OperatorPasskeyAssertionOptions, originOverride string, flags byte, counter uint32, handle []byte, wrongSignature bool) []byte {
		t.Helper()
		if originOverride == "" {
			originOverride = origin
		}
		clientData, err := json.Marshal(map[string]any{
			"type": "webauthn.get", "challenge": options.Options.Response.Challenge,
			"origin": originOverride, "crossOrigin": false,
		})
		if err != nil {
			t.Fatal(err)
		}
		authData := make([]byte, 37)
		rpHash := sha256.Sum256([]byte(rpID))
		copy(authData[:32], rpHash[:])
		authData[32] = flags
		binary.BigEndian.PutUint32(authData[33:], counter)
		cdh := sha256.Sum256(clientData)
		signed := append(append([]byte{}, authData...), cdh[:]...)
		hash := sha256.Sum256(signed)
		signature, err := ecdsa.SignASN1(rand.Reader, privateKey, hash[:])
		if err != nil {
			t.Fatal(err)
		}
		if wrongSignature {
			signature[len(signature)-1] ^= 1
		}
		encoded := func(b []byte) string { return base64.RawURLEncoding.EncodeToString(b) }
		assertion := map[string]any{
			"id": encoded(credentialID), "rawId": encoded(credentialID), "type": "public-key",
			"response": map[string]string{
				"clientDataJSON":    encoded(clientData),
				"authenticatorData": encoded(authData),
				"signature":         encoded(signature), "userHandle": encoded(handle),
			},
		}
		raw, err := json.Marshal(assertion)
		if err != nil {
			t.Fatal(err)
		}
		return raw
	}
	finish := func(options OperatorPasskeyAssertionOptions, assertion []byte, want int) MerchantAdmission {
		t.Helper()
		raw, e := json.Marshal(map[string]any{
			"ceremonyId": options.CeremonyID, "credential": json.RawMessage(assertion),
		})
		if e != nil {
			t.Fatal(e)
		}
		request, e := http.NewRequestWithContext(ctx, http.MethodPost,
			server.URL+OperatorPasskeyFinishPath, bytes.NewReader(raw))
		if e != nil {
			t.Fatal(e)
		}
		request.Header.Set("Content-Type", "application/json")
		request.Header.Set("X-Role", "operator")
		response, e := client.Do(request)
		if e != nil {
			t.Fatal(e)
		}
		defer response.Body.Close()
		if response.StatusCode != want {
			t.Fatalf("WebAuthn finish HTTP=%d wanted=%d (no sensitive body logged)", response.StatusCode, want)
		}
		if response.Header.Get("Cache-Control") != "no-store" {
			t.Fatal("auth result cacheable")
		}
		if want != 200 {
			return MerchantAdmission{}
		}
		var issued MerchantAdmission
		if e = json.NewDecoder(io.LimitReader(response.Body, 2048)).Decode(&issued); e != nil {
			t.Fatal(e)
		}
		if len(issued.AccessToken) != 43 || !issued.SessionExpiresAt.After(time.Now()) {
			t.Fatal("valid assertion did not yield canonical expiring Identity opaque token")
		}
		return issued
	}

	first := begin()
	valid := sign(first, "", 0x05, 1, userHandle, false)
	issued := finish(first, valid, 200)
	principal, err := NewVerifier(owner).Verify(ctx, "Bearer "+issued.AccessToken)
	if err != nil || principal.ActorID != actor || principal.Role != "operator" {
		t.Fatalf("library-authenticated session not accepted by canonical Identity owner: %v", err)
	}
	finish(first, valid, 401) // strict same-ceremony replay denied
	for _, tc := range []struct {
		name, alteredOrigin         string
		flags                       byte
		counter                     uint32
		wrongSignature, wrongHandle bool
	}{
		{"origin spoof", "https://evil.example", 0x05, 2, false, false},
		{"user verification missing", "", 0x01, 2, false, false},
		{"wrong raw ECDSA signature", "", 0x05, 2, true, false},
		{"cross actor user handle", "", 0x05, 2, false, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			options := begin()
			handle := userHandle
			if tc.wrongHandle {
				handle = bytes.Repeat([]byte{0x77}, 32)
			}
			finish(options, sign(options, tc.alteredOrigin, tc.flags, tc.counter, handle, tc.wrongSignature), 401)
		})
	}
	// An active bearer is not a login bypass when the original actor is
	// suspended: the owner join resolves status on each assertion.
	if _, err = db.ExecContext(ctx, "UPDATE "+q("actors")+" SET status='SUSPENDED' WHERE id=$1", actor); err != nil {
		t.Fatal(err)
	}
	suspended := begin()
	finish(suspended, sign(suspended, "", 0x05, 2, userHandle, false), 401)
	if _, err = db.ExecContext(ctx, "UPDATE "+q("actors")+" SET status='ACTIVE' WHERE id=$1", actor); err != nil {
		t.Fatal(err)
	}
	// Signature with a repeated NONZERO sign counter is clone evidence.
	// Fail closed, revoke credential and every affected Operator session.
	cloned := begin()
	finish(cloned, sign(cloned, "", 0x05, 1, userHandle, false), 401)
	if _, err = NewVerifier(owner).Verify(ctx, "Bearer "+issued.AccessToken); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("cloned credential did not revoke previous bearer: %v", err)
	}

	// Independent DB handle proves the durable owner state; the test cannot
	// claim success solely from HTTP 200 or mock signCount.
	readback, err := sql.Open("postgres", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer readback.Close()
	var status string
	var count int64
	var clone bool
	var revoked bool
	if err = readback.QueryRowContext(ctx, "SELECT sign_count,clone_warning,revoked_at IS NOT NULL FROM "+
		q("operator_passkey_credentials")+" WHERE rp_id=$1 AND credential_id=$2", rpID, credentialID).
		Scan(&count, &clone, &revoked); err != nil || count != 1 || !clone || !revoked {
		t.Fatalf("credential replay/counter not durably refused count=%d clone=%v revoked=%v error=%v", count, clone, revoked, err)
	}
	if err = readback.QueryRowContext(ctx, "SELECT status FROM "+q("actors")+" WHERE id=$1", actor).Scan(&status); err != nil || status != "ACTIVE" {
		t.Fatalf("synthetic actor state corrupted: %v", err)
	}
	var issuedSessions, revokedSessions, failedAudits, successfulAudits, clonedAudits int
	if err = readback.QueryRowContext(ctx, "SELECT count(*),count(*) FILTER (WHERE revoked_at IS NOT NULL) FROM "+
		q("auth_sessions")+" WHERE actor_id=$1 AND role='operator'", actor).
		Scan(&issuedSessions, &revokedSessions); err != nil || issuedSessions != 1 || revokedSessions != 1 {
		t.Fatalf("canonical Identity session durability wrong issued=%d revoked=%d err=%v", issuedSessions, revokedSessions, err)
	}
	if err = readback.QueryRowContext(ctx, "SELECT count(*) FILTER (WHERE event_kind='AUTH_REJECTED'),"+
		"count(*) FILTER (WHERE event_kind='AUTHENTICATED'),"+
		"count(*) FILTER (WHERE event_kind='CREDENTIAL_REVOKED') FROM "+q("operator_passkey_audit")).
		Scan(&failedAudits, &successfulAudits, &clonedAudits); err != nil || failedAudits < 5 || successfulAudits != 1 || clonedAudits != 1 {
		t.Fatalf("real SQL audit missing failed=%d pass=%d clone=%d err=%v", failedAudits, successfulAudits, clonedAudits, err)
	}
	t.Logf("PASS real ES256 signature + UV/RPID/origin/challenge verified by upstream, one-use replay blocked, persisted counter=%d, clone revoke and audit=%d/%d/%d", count, failedAudits, successfulAudits, clonedAudits)
}
