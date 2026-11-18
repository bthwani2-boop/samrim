package session

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

type captainStandingFixture struct {
	actor    string
	token    string
	approved bool
	ownerDB  *sql.DB
}

func (f *captainStandingFixture) Approved(ctx context.Context, bearer, actorID string) error {
	if f.ownerDB != nil {
		// The real DSH owner may require a second DB connection. Holding the
		// Identity write transaction open can deadlock when the pool is size one.
		probeCtx, cancel := context.WithTimeout(ctx, 400*time.Millisecond)
		defer cancel()
		var probe int
		if err := f.ownerDB.QueryRowContext(probeCtx, "SELECT 1").Scan(&probe); err != nil {
			return err
		}
		if probe != 1 {
			return errors.New("unexpected owner database probe result")
		}
	}
	if f.approved && actorID == f.actor && bearer == f.token {
		return nil
	}
	return ErrCaptainStandingNotApproved
}

// Exercises real Identity PostgreSQL persistence, verified Customer lock, role
// creation, 256-bit opaque session rotation, no self-recovery from suspension,
// and independently committed readback. DSH persistence is tested separately
// against a real DSH-owned synthetic schema on the same disposable container.
func TestCaptainIdentityVerifiedAdmissionRealPostgres(t *testing.T) {
	if os.Getenv("BTHWANI_ISOLATED_TEST_MODE") != "true" {
		t.Skip("NOT_RUN: isolated Captain Identity database not configured")
	}
	rawDSN := os.Getenv("BTHWANI_CAPTAIN_TEST_DATABASE_URL")
	if rawDSN == "" {
		t.Skip("NOT_RUN: isolated Captain Identity DB URL missing")
	}
	u, err := url.Parse(rawDSN)
	if err != nil || u.Scheme != "postgres" ||
		u.Host != "127.0.0.1:5432" ||
		u.Path != "/refoundation_captain_agent02" ||
		u.User == nil || u.User.Username() != "bt_cap_s02" ||
		u.Query().Get("sslmode") != "disable" ||
		os.Getenv("BTHWANI_CAPTAIN_TEST_CONTAINER") != "bthwani-session02-captain-pg" {
		t.Fatal("refuse any Identity DB other than session-02 disposable PostgreSQL")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 40*time.Second)
	defer cancel()
	db, err := sql.Open("postgres", rawDSN)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err = db.PingContext(ctx); err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(1)
	var databaseName string
	if err = db.QueryRowContext(ctx, "SELECT current_database()").Scan(&databaseName); err != nil || databaseName != "refoundation_captain_agent02" {
		t.Fatal("not isolated DB")
	}
	random := make([]byte, 5)
	if _, err = rand.Read(random); err != nil {
		t.Fatal(err)
	}
	schema := "identity_test_captain_s02_" + hex.EncodeToString(random)
	for _, migration := range []string{
		"001_session_verification.sql",
		"002_operator_permission_read.sql",
		"003_verified_customer_merchant_admission.sql",
		"004_customer_phone_verification.sql",
	} {
		sqlBytes, e := os.ReadFile(filepath.Join("..", "..", "..", "database", "migrations", migration))
		if e != nil {
			t.Fatal(e)
		}
		if _, e = db.ExecContext(ctx, strings.ReplaceAll(string(sqlBytes), "__SCHEMA__", schema)); e != nil {
			t.Fatalf("Identity migration %s failed: %v", migration, e)
		}
	}
	actors := schema + ".actors"
	roles := schema + ".actor_roles"
	sessions := schema + ".auth_sessions"
	actor := "captain-identity-s02"
	if _, err = db.ExecContext(ctx, "INSERT INTO "+actors+
		"(id,status,verified_at) VALUES($1,'ACTIVE',clock_timestamp()-interval '1 hour')", actor); err != nil {
		t.Fatal(err)
	}
	if _, err = db.ExecContext(ctx, "INSERT INTO "+roles+"(actor_id,role,status) VALUES($1,'customer','ACTIVE')", actor); err != nil {
		t.Fatal(err)
	}
	secret := make([]byte, 32)
	if _, err = rand.Read(secret); err != nil {
		t.Fatal(err)
	}
	customerBearer := base64.RawURLEncoding.EncodeToString(secret)
	digest := sha256.Sum256(secret)
	_, err = db.ExecContext(ctx, "INSERT INTO "+sessions+
		"(token_digest,actor_id,role,actor_version,role_version,issued_at,expires_at) VALUES($1,$2,'customer',1,1,clock_timestamp()-interval '1 minute',clock_timestamp()+interval '30 minutes')", digest[:], actor)
	if err != nil {
		t.Fatal(err)
	}
	reader, err := NewPostgresReader(db, schema)
	if err != nil {
		t.Fatal(err)
	}
	standing := &captainStandingFixture{actor: actor, token: customerBearer, ownerDB: db}
	service := NewCaptainAdmission(reader, standing)
	if _, err = service.Admit(ctx, "Bearer "+customerBearer); !errors.Is(err, ErrCaptainStandingNotApproved) {
		t.Fatalf("unapproved DSH standing granted Captain role: %v", err)
	}
	var roleCount int
	if err = db.QueryRowContext(ctx, "SELECT count(*) FROM "+roles+" WHERE actor_id=$1 AND role='captain'", actor).Scan(&roleCount); err != nil || roleCount != 0 {
		t.Fatalf("approval bypass persisted %d roles err=%v", roleCount, err)
	}
	standing.approved = true
	handler := NewCaptainHandler(service)
	invoke := func(path string) (*httptest.ResponseRecorder, MerchantAdmission) {
		t.Helper()
		req := httptest.NewRequest(http.MethodPost, path, nil)
		req.Header.Set("Authorization", "Bearer "+customerBearer)
		req.Header.Set("X-Actor-ID", "another-captain")
		req.Header.Set("X-Role", "operator")
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, req)
		var issued MerchantAdmission
		if w.Code == http.StatusCreated || w.Code == http.StatusOK {
			if err := json.Unmarshal(w.Body.Bytes(), &issued); err != nil {
				t.Fatal(err)
			}
		}
		return w, issued
	}
	admitted, first := invoke(CaptainAdmitPath)
	if admitted.Code != http.StatusCreated || first.AccessToken == "" ||
		admitted.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("approved Customer not admitted: status=%d", admitted.Code)
	}
	verify := NewVerifier(reader)
	if actual, err := verify.Verify(ctx, "Bearer "+first.AccessToken); err != nil || actual.ActorID != actor || actual.Role != "captain" {
		t.Fatalf("initial Captain role session not owner-backed: %+v %v", actual, err)
	}
	if duplicate, _ := invoke(CaptainAdmitPath); duplicate.Code != http.StatusConflict {
		t.Fatalf("duplicate self-provisioning accepted: %d", duplicate.Code)
	}
	reentry, second := invoke(CaptainReentryPath)
	if reentry.Code != http.StatusOK || second.AccessToken == "" || second.AccessToken == first.AccessToken {
		t.Fatalf("Captain reentry did not rotate session: %d", reentry.Code)
	}
	if _, err = verify.Verify(ctx, "Bearer "+first.AccessToken); !errors.Is(err, ErrUnauthorized) {
		t.Fatal("previous Captain credential not durably revoked")
	}
	if actual, err := verify.Verify(ctx, "Bearer "+second.AccessToken); err != nil || actual.ActorID != actor || actual.Role != "captain" {
		t.Fatalf("new Captain credential was not valid: %+v %v", actual, err)
	}
	if actual, err := verify.Verify(ctx, "Bearer "+customerBearer); err != nil || actual.ActorID != actor || actual.Role != "customer" {
		t.Fatalf("Customer source credential unexpectedly revoked: %+v %v", actual, err)
	}
	standing.approved = false
	if denied, _ := invoke(CaptainReentryPath); denied.Code != http.StatusForbidden {
		t.Fatalf("new Captain session granted after DSH denial: %d", denied.Code)
	}
	if _, err = db.ExecContext(ctx, "UPDATE "+roles+" SET status='SUSPENDED' WHERE actor_id=$1 AND role='captain'", actor); err != nil {
		t.Fatal(err)
	}
	standing.approved = true
	if denied, _ := invoke(CaptainReentryPath); denied.Code != http.StatusForbidden {
		t.Fatalf("suspended Captain self-reactivated: %d", denied.Code)
	}
	other, err := sql.Open("postgres", rawDSN)
	if err != nil {
		t.Fatal(err)
	}
	defer other.Close()
	var status string
	if err = other.QueryRowContext(ctx, "SELECT status FROM "+roles+
		" WHERE actor_id=$1 AND role='captain'", actor).Scan(&status); err != nil || status != "SUSPENDED" {
		t.Fatalf("separate DB connection observed wrong role: %s err=%v", status, err)
	}
	var roleSessions int
	if err = other.QueryRowContext(ctx, "SELECT count(*) FROM "+sessions+
		" WHERE actor_id=$1 AND role='captain'", actor).Scan(&roleSessions); err != nil || roleSessions != 2 {
		t.Fatalf("Captain must have exactly two recorded issuance events: count=%d err=%v", roleSessions, err)
	}
}
