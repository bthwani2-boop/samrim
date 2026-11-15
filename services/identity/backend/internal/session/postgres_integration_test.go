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
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	_ "github.com/lib/pq"
)

// This integration test is opt-in and never uses a pre-existing Identity
// namespace. The dedicated development PostgreSQL DB must be explicitly
// selected by the operator. No protected users, balances, or existing schemas
// are modified or dropped.
func TestPostgresIdentitySessionReadback(t *testing.T) {
	if os.Getenv("BTHWANI_ISOLATED_TEST_MODE") != "true" {
		t.Skip("NOT_RUN: explicitly isolated synthetic PostgreSQL not configured")
	}
	connectionURL := os.Getenv("IDENTITY_TEST_DATABASE_URL")
	if connectionURL == "" {
		user, pass, database := os.Getenv("REF_POSTGRES_USER"), os.Getenv("REF_POSTGRES_PASSWORD"), os.Getenv("REF_POSTGRES_DB")
		if user == "" || pass == "" || !strings.Contains(strings.ToLower(database), "refoundation") {
			t.Fatal("isolated synthetic PostgreSQL credentials are absent")
		}
		connection := &url.URL{Scheme: "postgres", Host: "postgres:5432", Path: "/" + database, User: url.UserPassword(user, pass)}
		connection.RawQuery = "sslmode=disable"
		connectionURL = connection.String()
	}
	db, err := sql.Open("postgres", connectionURL)
	if err != nil {
		t.Fatal("isolated Identity database driver unavailable")
	}
	defer db.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 40*time.Second)
	defer cancel()
	if err = db.PingContext(ctx); err != nil {
		t.Fatal("isolated Identity database unreachable")
	}
	var databaseName string
	if err = db.QueryRowContext(ctx, "SELECT current_database()").Scan(&databaseName); err != nil {
		t.Fatal("cannot establish isolated database identity")
	}
	// The verified refoundation DB is not a protected production identity DB.
	if !strings.Contains(strings.ToLower(databaseName), "refoundation") {
		t.Fatal("denied: target is not an explicitly isolated refoundation database")
	}
	randomName := make([]byte, 8)
	if _, err = rand.Read(randomName); err != nil {
		t.Fatal(err)
	}
	schema := "identity_test_agent03_" + hex.EncodeToString(randomName)
	if !schemaRule.MatchString(schema) {
		t.Fatal("invalid synthetic schema name")
	}
	var preexisting int
	if err = db.QueryRowContext(ctx, "SELECT count(*) FROM pg_catalog.pg_namespace WHERE nspname=$1", schema).Scan(&preexisting); err != nil || preexisting != 0 {
		t.Fatal("synthetic namespace collides with preexisting schema")
	}
	migrationPath := os.Getenv("IDENTITY_SESSION_MIGRATION_SQL_PATH")
	if migrationPath == "" {
		migrationPath = filepath.Join("..", "..", "..", "database", "migrations", "001_session_verification.sql")
	}
	source, err := os.ReadFile(migrationPath)
	if err != nil {
		t.Fatal("Identity migration unavailable")
	}
	if _, err = db.ExecContext(ctx, strings.ReplaceAll(string(source), "__SCHEMA__", schema)); err != nil {
		t.Fatal("synthetic Identity namespace bootstrap failed:", err)
	}
	permissionMigrationPath := os.Getenv("IDENTITY_OPERATOR_PERMISSION_MIGRATION_SQL_PATH")
	if permissionMigrationPath == "" {
		permissionMigrationPath = filepath.Join("..", "..", "..", "database", "migrations", "002_operator_permission_read.sql")
	}
	permissionMigration, err := os.ReadFile(permissionMigrationPath)
	if err != nil {
		t.Fatal("Identity effective permissions migration unavailable")
	}
	if _, err = db.ExecContext(ctx, strings.ReplaceAll(string(permissionMigration), "__SCHEMA__", schema)); err != nil {
		t.Fatal("synthetic effective Operator permission bootstrap failed:", err)
	}
	// Keep test scope explicit. Only SQL identifiers derived from local random
	// bytes are interpolated; all actor IDs, digests and values use binds.
	exec := func(query string, args ...any) {
		t.Helper()
		if _, e := db.ExecContext(ctx, query, args...); e != nil {
			t.Fatal("synthetic Identity operation failed:", e)
		}
	}
	qualify := func(table string) string { return schema + "." + table }
	actors := qualify("actors")
	roles := qualify("actor_roles")
	sessions := qualify("auth_sessions")
	exec("INSERT INTO "+actors+"(id,status) VALUES($1,'ACTIVE'),($2,'ACTIVE')", "identity-testa", "identity-testb")
	exec("INSERT INTO "+roles+"(actor_id,role,status) VALUES($1,'merchant','ACTIVE'),($2,'customer','ACTIVE')", "identity-testa", "identity-testb")

	issue := func(actor, role string) (string, [32]byte) {
		t.Helper()
		secret := make([]byte, 32)
		if _, e := rand.Read(secret); e != nil {
			t.Fatal(e)
		}
		digest := sha256.Sum256(secret)
		exec("INSERT INTO "+sessions+"(token_digest,actor_id,role,actor_version,role_version,expires_at) VALUES($1,$2,$3,1,1,$4)",
			digest[:], actor, role, time.Now().UTC().Add(time.Hour))
		return base64.RawURLEncoding.EncodeToString(secret), digest
	}
	tokenA, digestA := issue("identity-testa", "merchant")
	tokenB, _ := issue("identity-testb", "customer")
	reader, err := NewPostgresReader(db, schema)
	if err != nil {
		t.Fatal(err)
	}
	verify := func(token, actor, role string, allowed bool) {
		t.Helper()
		principal, e := NewVerifier(reader).Verify(ctx, "Bearer "+token)
		if allowed {
			if e != nil || principal.ActorID != actor || principal.Role != role || !principal.ExpiresAt.After(time.Now()) {
				t.Fatalf("expected current authoritative Identity actor=%s role=%s, got %#v %v", actor, role, principal, e)
			}
		} else if !errors.Is(e, ErrUnauthorized) {
			t.Fatalf("expected failure-closed Identity read, got %#v %v", principal, e)
		}
	}
	verify(tokenA, "identity-testa", "merchant", true)
	verify(tokenB, "identity-testb", "customer", true)
	verify(tokenA, "identity-testa", "merchant", true)
	// No caller-supplied actor/role headers change Identity's canonical facts.
	req := httptest.NewRequest("GET", "/v1/sessions/current", nil)
	req.Header.Set("Authorization", "Bearer "+tokenA)
	req.Header.Set("X-Actor-ID", "identity-testb")
	req.Header.Set("X-Role", "operator")
	rr := httptest.NewRecorder()
	NewHandler(NewVerifier(reader)).ServeHTTP(rr, req)
	if rr.Code != 200 || strings.Contains(rr.Body.String(), "identity-testb") ||
		!strings.Contains(rr.Body.String(), "\"actorId\":\"identity-testa\"") {
		t.Fatal("forged actor header affected canonical Identity read")
	}

	exec("UPDATE "+sessions+" SET revoked_at=now() WHERE token_digest=$1", digestA[:])
	verify(tokenA, "", "", false)
	verify(tokenB, "identity-testb", "customer", true)
	exec("UPDATE "+roles+" SET status='SUSPENDED' WHERE actor_id=$1", "identity-testb")
	verify(tokenB, "", "", false)
	exec("UPDATE "+roles+" SET status='ACTIVE' WHERE actor_id=$1", "identity-testb")
	verify(tokenB, "identity-testb", "customer", true)
	exec("UPDATE "+roles+" SET version=version+1 WHERE actor_id=$1", "identity-testb")
	verify(tokenB, "", "", false)
	exec("UPDATE "+roles+" SET version=1 WHERE actor_id=$1", "identity-testb")
	verify(tokenB, "identity-testb", "customer", true)
	exec("UPDATE "+actors+" SET auth_version=auth_version+1 WHERE id=$1", "identity-testb")
	verify(tokenB, "", "", false)
	exec("UPDATE "+actors+" SET auth_version=1,status='SUSPENDED' WHERE id=$1", "identity-testb")
	verify(tokenB, "", "", false)
	exec("UPDATE "+actors+" SET status='ACTIVE' WHERE id=$1", "identity-testb")
	verify(tokenB, "identity-testb", "customer", true)
	exec("UPDATE "+sessions+" SET issued_at=now()+interval '1 hour', expires_at=now()+interval '2 hours' WHERE actor_id=$1", "identity-testb")
	verify(tokenB, "", "", false)
	exec("UPDATE "+sessions+" SET issued_at=now()-interval '2 hours', expires_at=now()-interval '1 minute' WHERE actor_id=$1", "identity-testb")
	verify(tokenB, "", "", false)

	// Durable verification from a separate PostgreSQL connection, not an
	// in-memory mock or a transaction-local temporary table.
	independent, err := sql.Open("postgres", connectionURL)
	if err != nil {
		t.Fatal("independent owner read unavailable")
	}
	defer independent.Close()
	independentlyScoped, err := NewPostgresReader(independent, schema)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = independentlyScoped.Lookup(ctx, digestA); !errors.Is(err, ErrUnauthorized) {
		t.Fatal("revoked session was visible from independent owner read")
	}

	// Confirm effective Operator permissions from the same persistent Identity
	// owner. Role alone never grants operations, even for an active Operator.
	exec("INSERT INTO "+actors+"(id,status) VALUES($1,'ACTIVE'),($2,'ACTIVE')", "identity-operator-a", "identity-operator-b")
	exec("INSERT INTO "+roles+"(actor_id,role,status) VALUES($1,'operator','ACTIVE'),($2,'operator','ACTIVE')", "identity-operator-a", "identity-operator-b")
	opA, digestOpA := issue("identity-operator-a", "operator")
	opB, _ := issue("identity-operator-b", "operator")
	permissions := qualify("operator_permissions")
	exec("INSERT INTO "+permissions+"(actor_id,permission) VALUES($1,'operations'),($2,'marketing')",
		"identity-operator-a", "identity-operator-b")
	// Schema itself forbids silently treating a Customer as an Operator and
	// rejects a scope outside the approved seven, even for a test fixture.
	if _, e := db.ExecContext(ctx, "INSERT INTO "+permissions+"(actor_id,permission) VALUES($1,'operations')", "identity-testb"); e == nil {
		t.Fatal("Identity SQL accepted an Operator permission on a Customer role")
	}
	if _, e := db.ExecContext(ctx, "INSERT INTO "+permissions+"(actor_id,permission) VALUES($1,'superuser')", "identity-operator-b"); e == nil {
		t.Fatal("Identity SQL accepted an unapproved permission scope")
	}
	checkPermission := func(token, scope, actor string, wanted error) {
		t.Helper()
		principal, e := NewVerifier(reader).VerifyPermission(ctx, "Bearer "+token, scope)
		if wanted != nil {
			if !errors.Is(e, wanted) {
				t.Fatalf("expected permission %s denial %v, got %#v %v", scope, wanted, principal, e)
			}
			return
		}
		if e != nil || principal.ActorID != actor || principal.Role != "operator" || !principal.ExpiresAt.After(time.Now()) {
			t.Fatalf("expected canonical Operator %s permission %s, got %#v %v", actor, scope, principal, e)
		}
	}
	checkPermission(opA, "operations", "identity-operator-a", nil)
	checkPermission(opA, "finance", "", ErrForbidden)
	checkPermission(opB, "operations", "", ErrForbidden)
	checkPermission(opB, "marketing", "identity-operator-b", nil)
	checkPermission(tokenB, "operations", "", ErrUnauthorized) // expired Customer session
	// Real handler -> network socket -> canonical PostgreSQL on the isolated
	// network, never an HTTP mock of the Identity service/owner.
	server := httptest.NewServer(NewHandler(NewVerifier(reader)))
	requestOp, err := http.NewRequestWithContext(ctx, "GET", server.URL+"/v1/operators/me/permissions/operations", nil)
	if err != nil {
		t.Fatal(err)
	}
	requestOp.Header.Set("Authorization", "Bearer "+opA)
	requestOp.Header.Set("X-Actor-ID", "identity-operator-b")
	responseOp, err := server.Client().Do(requestOp)
	if err != nil {
		t.Fatal("isolated Identity HTTP read failed:", err)
	}
	if responseOp.StatusCode != 200 || responseOp.Header.Get("Cache-Control") != "no-store" {
		_ = responseOp.Body.Close()
		t.Fatal("Identity permission HTTP owner response not accepted")
	}
	var approved struct {
		ActorID    string `json:"actorId"`
		Permission string `json:"permission"`
	}
	if err = json.NewDecoder(responseOp.Body).Decode(&approved); err != nil {
		_ = responseOp.Body.Close()
		t.Fatal("Identity permission HTTP response decode failed:", err)
	}
	_ = responseOp.Body.Close()
	server.Close()
	if approved.ActorID != "identity-operator-a" || approved.Permission != "operations" {
		t.Fatal("forged HTTP actor header influenced Identity permission result")
	}
	// Revocation is immediately visible even without role-version changes.
	exec("UPDATE "+permissions+" SET state='REVOKED',updated_at=now() WHERE actor_id=$1 AND permission='operations'", "identity-operator-a")
	checkPermission(opA, "operations", "", ErrForbidden)
	checkPermission(opB, "marketing", "identity-operator-b", nil)
	// Concurrent requests after a committed revocation must never leak A's
	// earlier permission to B or return a stale cached approval to A.
	var concurrency sync.WaitGroup
	concurrentErrors := make(chan error, 20)
	for i := 0; i < 20; i++ {
		concurrency.Add(1)
		go func(index int) {
			defer concurrency.Done()
			requestToken, scope, wantActor := opA, "operations", ""
			var expectedErr error = ErrForbidden
			if index%2 == 1 {
				requestToken, scope, wantActor, expectedErr = opB, "marketing", "identity-operator-b", nil
			}
			got, e := NewVerifier(reader).VerifyPermission(ctx, "Bearer "+requestToken, scope)
			if expectedErr != nil {
				if !errors.Is(e, expectedErr) {
					concurrentErrors <- fmt.Errorf("revoked permission visible on concurrent request: %v", e)
				}
			} else if e != nil || got.ActorID != wantActor {
				concurrentErrors <- fmt.Errorf("cross-operator permission leak: %#v %v", got, e)
			}
		}(i)
	}
	concurrency.Wait()
	close(concurrentErrors)
	for e := range concurrentErrors {
		t.Fatal(e)
	}
	if _, err = independentlyScoped.LookupPermission(ctx, digestOpA, "operations"); !errors.Is(err, ErrForbidden) {
		t.Fatal("revoked permission not visible to independent Identity owner connection")
	}
	exec("UPDATE "+permissions+" SET state='ACTIVE',updated_at=now() WHERE actor_id=$1 AND permission='operations'", "identity-operator-a")
	checkPermission(opA, "operations", "identity-operator-a", nil)
	// A stale Operator role grant or actor security version fails closed.
	exec("UPDATE "+roles+" SET version=version+1 WHERE actor_id=$1", "identity-operator-a")
	checkPermission(opA, "operations", "", ErrUnauthorized)
	exec("UPDATE "+roles+" SET version=1 WHERE actor_id=$1", "identity-operator-a")
	exec("UPDATE "+actors+" SET auth_version=auth_version+1 WHERE id=$1", "identity-operator-a")
	checkPermission(opA, "operations", "", ErrUnauthorized)
	exec("UPDATE "+actors+" SET auth_version=1,status='SUSPENDED' WHERE id=$1", "identity-operator-a")
	checkPermission(opA, "operations", "", ErrUnauthorized)
	exec("UPDATE "+actors+" SET status='ACTIVE' WHERE id=$1", "identity-operator-a")
	checkPermission(opA, "operations", "identity-operator-a", nil)
	exec("UPDATE "+sessions+" SET revoked_at=now() WHERE token_digest=$1", digestOpA[:])
	checkPermission(opA, "operations", "", ErrUnauthorized)
	checkPermission(opB, "marketing", "identity-operator-b", nil)

	// The authenticated HTTP logout must persist a token-digest-only revoke.
	// The account used is synthetic; no password, root account or real token
	// is created. Check the result through a separate canonical DB connection.
	logoutToken, logoutDigest := issue("identity-testa", "merchant")
	logoutServer := httptest.NewServer(NewHandler(NewVerifier(reader)))
	defer logoutServer.Close()
	doLogout := func(token string) (int, error) {
		request, e := http.NewRequestWithContext(ctx, http.MethodDelete, logoutServer.URL+"/v1/sessions/current", nil)
		if e != nil {
			return 0, e
		}
		request.Header.Set("Authorization", "Bearer "+token)
		request.Header.Set("X-Actor-ID", "identity-operator-a")
		response, e := logoutServer.Client().Do(request)
		if e != nil {
			return 0, e
		}
		defer response.Body.Close()
		if response.Header.Get("Cache-Control") != "no-store" {
			return response.StatusCode, errors.New("logout is cacheable")
		}
		return response.StatusCode, nil
	}
	code, e := doLogout(logoutToken)
	if e != nil || code != http.StatusNoContent {
		t.Fatalf("canonical HTTP logout status %d: %v", code, e)
	}
	if _, e = independentlyScoped.Lookup(ctx, logoutDigest); !errors.Is(e, ErrUnauthorized) {
		t.Fatalf("revoked session still visible from independent Identity owner: %v", e)
	}
	var durablyRevoked bool
	if e = independent.QueryRowContext(ctx,
		"SELECT revoked_at IS NOT NULL FROM "+sessions+" WHERE token_digest=$1", logoutDigest[:]).
		Scan(&durablyRevoked); e != nil || !durablyRevoked {
		t.Fatalf("Identity logout mutation not durable: revoked=%t err=%v", durablyRevoked, e)
	}
	if code, e = doLogout(logoutToken); e != nil || code != http.StatusUnauthorized {
		t.Fatalf("revoked bearer replay was accepted: %d %v", code, e)
	}
	// A suspended or reactivated actor cannot use a stale credential to
	// perform a logout mutation. The rejected request must not change storage.
	staleToken, staleDigest := issue("identity-testa", "merchant")
	exec("UPDATE "+actors+" SET status='SUSPENDED',auth_version=auth_version+1 WHERE id=$1", "identity-testa")
	if code, e = doLogout(staleToken); e != nil || code != http.StatusUnauthorized {
		t.Fatalf("suspended actor modified Identity session: %d %v", code, e)
	}
	var wasUnrevoked bool
	if e = independent.QueryRowContext(ctx,
		"SELECT revoked_at IS NULL FROM "+sessions+" WHERE token_digest=$1", staleDigest[:]).
		Scan(&wasUnrevoked); e != nil || !wasUnrevoked {
		t.Fatalf("rejected logout wrote owner state: unchanged=%t err=%v", wasUnrevoked, e)
	}
	exec("UPDATE "+actors+" SET status='ACTIVE' WHERE id=$1", "identity-testa")
	if code, e = doLogout(staleToken); e != nil || code != http.StatusUnauthorized {
		t.Fatalf("reactivated actor reused stale security version: %d %v", code, e)
	}
	// New synthetic role/session versions are not fabricated to bypass this
	// denial; another active Operator must remain unaffected.
	checkPermission(opB, "marketing", "identity-operator-b", nil)
	// Use a separate synthetic actor for the race: never reset a suspended
	// actor's security version merely to make a test pass.
	exec("INSERT INTO "+actors+"(id,status) VALUES($1,'ACTIVE')", "identity-test-race")
	exec("INSERT INTO "+roles+"(actor_id,role,status) VALUES($1,'merchant','ACTIVE')", "identity-test-race")
	// Race 12 logout requests for one credential. Exactly one may commit;
	// every later retry must fail closed without touching another actor.
	raceToken, raceDigest := issue("identity-test-race", "merchant")
	raceStatuses := make(chan int, 12)
	raceErrors := make(chan error, 12)
	var raceGroup sync.WaitGroup
	for i := 0; i < 12; i++ {
		raceGroup.Add(1)
		go func() {
			defer raceGroup.Done()
			status, callErr := doLogout(raceToken)
			if callErr != nil {
				raceErrors <- callErr
			} else {
				raceStatuses <- status
			}
		}()
	}
	raceGroup.Wait()
	close(raceStatuses)
	close(raceErrors)
	for raceErr := range raceErrors {
		t.Fatal("concurrent owner logout HTTP error:", raceErr)
	}
	committed := 0
	for status := range raceStatuses {
		switch status {
		case http.StatusNoContent:
			committed++
		case http.StatusUnauthorized:
			// Expected: loser of one owner-atomic credential revocation.
		default:
			t.Fatalf("unexpected concurrent logout status: %d", status)
		}
	}
	if committed != 1 {
		t.Fatalf("concurrent logouts committed %d times; expected exactly 1", committed)
	}
	if _, e = independentlyScoped.Lookup(ctx, raceDigest); !errors.Is(e, ErrUnauthorized) {
		t.Fatalf("concurrently revoked token still usable: %v", e)
	}
	checkPermission(opB, "marketing", "identity-operator-b", nil)
	fmt.Println("IDENTITY_SESSION_HTTP_LOGOUT_DURABLE_AND_RACE_PASS")
	fmt.Println("IDENTITY_OPERATOR_PERMISSION_POSTGRES_DURABLE_READBACK_PASS")
	fmt.Println("IDENTITY_SESSION_POSTGRES_DURABLE_READBACK_PASS")
}
