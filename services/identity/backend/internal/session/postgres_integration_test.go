package session

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
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
	fmt.Println("IDENTITY_SESSION_POSTGRES_DURABLE_READBACK_PASS")
}
