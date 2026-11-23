package session

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"errors"
	_ "github.com/lib/pq"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestPersistentIdentityPostgres(t *testing.T) {
	if os.Getenv("BTHWANI_ISOLATED_TEST_MODE") != "true" {
		t.Skip("NOT_RUN: only an explicitly authorized isolated synthetic database may run this test")
	}
	url := os.Getenv("IDENTITY_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("NOT_RUN: no isolated database connection supplied")
	}
	db, err := sql.Open("postgres", url)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Second)
	defer cancel()
	var name string
	if err = db.QueryRowContext(ctx, "SELECT current_database()").Scan(&name); err != nil || !strings.Contains(strings.ToLower(name), "refoundation") {
		t.Fatal("refusing non-isolated PostgreSQL database")
	}
	b := make([]byte, 8)
	if _, err = rand.Read(b); err != nil {
		t.Fatal(err)
	}
	schema := "identity_test_refresh_" + hex.EncodeToString(b)
	var exists int
	if err = db.QueryRowContext(ctx, "SELECT count(*) FROM pg_namespace WHERE nspname=$1", schema).Scan(&exists); err != nil || exists != 0 {
		t.Fatal("namespace not absent")
	}
	for _, file := range []string{"001_session_verification.sql", "010_persistent_sessions.sql"} {
		source, e := os.ReadFile(filepath.Join("..", "..", "..", "database", "migrations", file))
		if e != nil {
			t.Fatal(e)
		}
		if _, e = db.ExecContext(ctx, strings.ReplaceAll(string(source), "__SCHEMA__", schema)); e != nil {
			t.Fatal(file, e)
		}
	}
	t.Cleanup(func() {
		cleanupCtx, done := context.WithTimeout(context.Background(), 5*time.Second)
		defer done()
		// This schema was randomly generated, proved absent, and created by this test.
		_, _ = db.ExecContext(cleanupCtx, "DROP SCHEMA "+schema+" CASCADE")
	})
	owner, e := NewPostgresReader(db, schema)
	if e != nil {
		t.Fatal(e)
	}
	exec := func(query string, args ...any) {
		t.Helper()
		if _, e := db.ExecContext(ctx, query, args...); e != nil {
			t.Fatal(e)
		}
	}
	issue := func(actor, role string) (string, [32]byte) {
		t.Helper()
		exec("INSERT INTO "+schema+".actors(id,status) VALUES($1,'ACTIVE')", actor)
		exec("INSERT INTO "+schema+".actor_roles(actor_id,role,status) VALUES($1,$2,'ACTIVE')", actor, role)
		raw := make([]byte, 32)
		if _, e := rand.Read(raw); e != nil {
			t.Fatal(e)
		}
		digest := sha256.Sum256(raw)
		exec("INSERT INTO "+schema+".auth_sessions(token_digest,actor_id,role,actor_version,role_version,expires_at) VALUES($1,$2,$3,1,1,clock_timestamp()+interval '30 minutes')", digest[:], actor, role)
		return base64.RawURLEncoding.EncodeToString(raw), digest
	}
	_, initial := issue("persistent-customer", "customer")
	first, e := owner.StartPersistent(ctx, initial)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = owner.StartPersistent(ctx, initial); !errors.Is(e, ErrPersistenceExists) {
		t.Fatalf("duplicate first session: %v", e)
	}
	grantDigest, e := bearerDigest("Bearer " + first.RefreshToken)
	if e != nil {
		t.Fatal(e)
	}
	rotated, e := owner.RotatePersistent(ctx, grantDigest)
	if e != nil {
		t.Fatal(e)
	}
	if rotated.AccessToken == first.RefreshToken || rotated.RefreshToken == first.RefreshToken || rotated.AccessToken == rotated.RefreshToken {
		t.Fatal("secret was reused")
	}
	if rotated.SessionExpiresAt.Sub(time.Now()) > 16*time.Minute {
		t.Fatal("access token was not short lived")
	}
	oldLookupErr := func(d [32]byte) error { _, e := owner.Lookup(ctx, d); return e }
	if !errors.Is(oldLookupErr(initial), ErrUnauthorized) {
		t.Fatal("old access still works")
	}
	rotatedAccess, e := bearerDigest("Bearer " + rotated.AccessToken)
	if e != nil {
		t.Fatal(e)
	}
	if e = oldLookupErr(rotatedAccess); e != nil {
		t.Fatalf("new access denied: %v", e)
	}
	var consumedCount int
	if e = db.QueryRowContext(ctx, "SELECT count(*) FROM "+schema+".auth_refresh_tokens WHERE token_digest=$1 AND consumed_at IS NOT NULL", grantDigest[:]).Scan(&consumedCount); e != nil || consumedCount != 1 {
		t.Fatal("rotation consumption not durable", e, consumedCount)
	}
	// Confirmed replay revokes the entire active family, including its NEW access.
	if _, e = owner.RotatePersistent(ctx, grantDigest); !errors.Is(e, ErrUnauthorized) {
		t.Fatalf("replay accepted: %v", e)
	}
	if !errors.Is(oldLookupErr(rotatedAccess), ErrUnauthorized) {
		t.Fatal("replay failed to revoke new access")
	}
	// Revoke a family through its refresh secret and independently read back access.
	_, operatorDigest := issue("persistent-operator", "operator")
	opGrant, e := owner.StartPersistent(ctx, operatorDigest)
	if e != nil {
		t.Fatal(e)
	}
	if opGrant.RefreshExpiresAt.Sub(time.Now()) > 13*time.Hour {
		t.Fatal("operator persistence exceeded hard limit")
	}
	opRefresh, e := bearerDigest("Bearer " + opGrant.RefreshToken)
	if e != nil {
		t.Fatal(e)
	}
	if e = owner.EndPersistent(ctx, opRefresh); e != nil {
		t.Fatal(e)
	}
	if !errors.Is(oldLookupErr(operatorDigest), ErrUnauthorized) {
		t.Fatal("explicit logout did not revoke access")
	}
	// A role suspension or auth version change must block refresh, even if
	// the refresh secret itself has not expired.
	_, merchantDigest := issue("persistent-merchant", "merchant")
	merchantGrant, e := owner.StartPersistent(ctx, merchantDigest)
	if e != nil {
		t.Fatal(e)
	}
	exec("UPDATE " + schema + ".actor_roles SET status='SUSPENDED',version=version+1 WHERE actor_id='persistent-merchant'")
	merchantRefresh, e := bearerDigest("Bearer " + merchantGrant.RefreshToken)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = owner.RotatePersistent(ctx, merchantRefresh); !errors.Is(e, ErrUnauthorized) {
		t.Fatalf("suspended actor renewed: %v", e)
	}
	// Concurrent refresh calls cannot both mint usable tokens. Reuse triggers
	// family compromise and invalidates whichever one succeeded.
	_, captainDigest := issue("persistent-captain", "captain")
	captainGrant, e := owner.StartPersistent(ctx, captainDigest)
	if e != nil {
		t.Fatal(e)
	}
	captainRefresh, e := bearerDigest("Bearer " + captainGrant.RefreshToken)
	if e != nil {
		t.Fatal(e)
	}
	var wg sync.WaitGroup
	successes := make(chan PersistentRotation, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			result, e := owner.RotatePersistent(ctx, captainRefresh)
			if e == nil {
				successes <- result
			} else if !errors.Is(e, ErrUnauthorized) {
				t.Errorf("unexpected race error: %v", e)
			}
		}()
	}
	wg.Wait()
	close(successes)
	for result := range successes {
		dig, _ := bearerDigest("Bearer " + result.AccessToken)
		if !errors.Is(oldLookupErr(dig), ErrUnauthorized) {
			t.Fatal("replayed family retained usable access")
		}
	}
}
