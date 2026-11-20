package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/bthwani2-boop/samrim/services/wlt/backend/internal/wallet"
	"github.com/lib/pq"
)

func TestWalletOwnerPostgresAndIdentity(t *testing.T) {
	if os.Getenv("BTHWANI_ISOLATED_TEST_MODE") != "true" || os.Getenv("WLT_OWNER_CI_TEST") != "true" {
		t.Skip("NOT_RUN: requires the disposable WLT PostgreSQL owner stage")
	}
	const network = "@127.0.0.1:5432/bthwani_wlt_test?sslmode=disable"
	const readerDSN = "postgres://bthwani_wlt_reader:synthetic-only" + network
	const identityDSN = "postgres://bthwani_identity_fixture:synthetic-only" + network
	owner := openTestDB(t, "postgres://bthwani_wlt_owner:synthetic-only"+network)
	reader := openTestDB(t, readerDSN)
	identity := openTestDB(t, identityDSN)
	ctx, cancel := context.WithTimeout(t.Context(), 30*time.Second)
	defer cancel()
	migration, err := os.ReadFile("/agent02/services/wlt/database/migrations/001_customer_funding_journal.sql")
	if err != nil {
		t.Fatal(err)
	}
	executeFixture(t, ctx, owner, string(migration))
	if err := checkDatabase(ctx, reader); err != nil {
		t.Fatal(err)
	}
	if err := checkDatabase(ctx, owner); err == nil {
		t.Fatal("runtime accepted the migration identity")
	}

	const identitySchema = "identity_test_wlt"
	identityMigration, err := os.ReadFile("/agent02/services/identity/database/migrations/001_session_verification.sql")
	if err != nil {
		t.Fatal(err)
	}
	executeFixture(t, ctx, identity, strings.ReplaceAll(string(identityMigration), "__SCHEMA__", identitySchema))
	executeFixture(t, ctx, identity, `INSERT INTO identity_test_wlt.actors(id,status)
		VALUES ('wallet-one','ACTIVE'),('wallet-two','ACTIVE'),('wallet-empty','ACTIVE')`)
	executeFixture(t, ctx, identity, `INSERT INTO identity_test_wlt.actor_roles(actor_id,role,status)
		VALUES ('wallet-one','customer','ACTIVE'),('wallet-two','customer','ACTIVE'),
		('wallet-empty','customer','ACTIVE'),('wallet-one','merchant','ACTIVE')`)
	session := func(actor, role string, marker byte) string {
		opaque := bytes.Repeat([]byte{marker}, 32)
		digest := sha256.Sum256(opaque)
		executeFixture(t, ctx, identity, `INSERT INTO identity_test_wlt.auth_sessions
			(token_digest,actor_id,role,actor_version,role_version,expires_at) VALUES ($1,$2,$3,1,1,$4)`,
			digest[:], actor, role, time.Now().Add(time.Hour))
		return base64.RawURLEncoding.EncodeToString(opaque)
	}
	one, two := session("wallet-one", "customer", 1), session("wallet-two", "customer", 2)
	empty, merchant := session("wallet-empty", "customer", 3), session("wallet-one", "merchant", 4)

	// Synthetic postings are only fixtures for the real read operation. The
	// HTTP runtime and its database role cannot create these records.
	const post = `INSERT INTO wlt.customer_funding_journal
		(funding_id,actor_id,provider_id,provider_reference,amount_yer,currency)
		VALUES ($1,$2,'synthetic',$3,$4,$5)`
	executeFixture(t, ctx, owner, post, "funding-0001", "wallet-one", "synthetic-a", int64(9007199254740993), "YER")
	executeFixture(t, ctx, owner, post, "funding-0002", "wallet-two", "synthetic-b", int64(41), "YER")
	const attempts = 8
	results := make(chan error, attempts)
	var contenders sync.WaitGroup
	for range attempts {
		contenders.Go(func() {
			_, err := owner.ExecContext(ctx, post, "funding-0003", "wallet-one", "synthetic-c", int64(57), "YER")
			results <- err
		})
	}
	contenders.Wait()
	close(results)
	winners := 0
	for err := range results {
		if err == nil {
			winners++
		} else {
			assertSQLState(t, err, "23505")
		}
	}
	if winners != 1 {
		t.Fatalf("duplicate postings committed: %d", winners)
	}
	_, err = owner.ExecContext(ctx, post, "funding-0004", "wallet-two", "synthetic-c", int64(99), "YER")
	assertSQLState(t, err, "23505")
	_, err = owner.ExecContext(ctx, post, "funding-0004", "wallet-two", "synthetic-d", int64(99), "USD")
	assertSQLState(t, err, "23514")
	_, err = owner.ExecContext(ctx, "UPDATE wlt.customer_funding_journal SET amount_yer = 1")
	assertSQLState(t, err, "23514")
	_, err = owner.ExecContext(ctx, "TRUNCATE wlt.customer_funding_journal")
	assertSQLState(t, err, "23514")
	_, err = reader.ExecContext(ctx, post, "funding-0004", "wallet-two", "synthetic-d", int64(99), "YER")
	assertSQLState(t, err, "42501")
	_, err = reader.ExecContext(ctx, "SELECT provider_reference FROM wlt.customer_funding_journal")
	assertSQLState(t, err, "42501")
	var journalCount, unbalanced int
	if err = owner.QueryRowContext(ctx, `SELECT count(*), count(*) FILTER (WHERE legs <> 2 OR net <> 0)
		FROM (SELECT funding_id, count(*) AS legs,
		sum(CASE side WHEN 'debit' THEN amount_yer ELSE -amount_yer END) AS net
		FROM wlt.customer_funding_entries GROUP BY funding_id) grouping`).Scan(&journalCount, &unbalanced); err != nil ||
		journalCount != 3 || unbalanced != 0 {
		t.Fatalf("journal count=%d unbalanced=%d err=%v", journalCount, unbalanced, err)
	}
	origin := startIdentity(t, ctx, identityDSN, identitySchema)
	handler, err := wallet.NewHandler(reader, origin)
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(handler)
	defer server.Close()
	for _, check := range []struct {
		id, balance, token string
	}{
		{"wallet-one", "9007199254741050", one},
		{"wallet-two", "41", two},
		{"wallet-empty", "0", empty},
	} {
		response := readWallet(t, ctx, server.URL, check.token, "/v1/wallets/me", 200)
		var result map[string]string
		if err := json.Unmarshal(response, &result); err != nil || len(result) != 3 ||
			result["actorId"] != check.id || result["balanceYer"] != check.balance || result["currency"] != "YER" {
			t.Fatalf("unexpected durable read result: %s %v", response, err)
		}
	}
	readWallet(t, ctx, server.URL, merchant, "/v1/wallets/me", 403)
	readWallet(t, ctx, server.URL, one, "/v1/wallets/me?actorId=wallet-two", 400)
	digest := sha256.Sum256(bytes.Repeat([]byte{1}, 32))
	executeFixture(t, ctx, identity, "UPDATE identity_test_wlt.auth_sessions SET revoked_at=now() WHERE token_digest=$1", digest[:])
	readWallet(t, ctx, server.URL, one, "/v1/wallets/me", 401)
	t.Log("WLT durable wallet readback, actor isolation, balanced journal, duplicate rejection and least privilege verified")
}

func openTestDB(t *testing.T, dsn string) *sql.DB {
	t.Helper()
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return db
}

func executeFixture(t *testing.T, ctx context.Context, db *sql.DB, statement string, args ...any) {
	t.Helper()
	if _, err := db.ExecContext(ctx, statement, args...); err != nil {
		t.Fatal(err)
	}
}

func assertSQLState(t *testing.T, err error, state string) {
	t.Helper()
	var postgres *pq.Error
	if !errors.As(err, &postgres) || string(postgres.Code) != state {
		t.Fatalf("expected SQLSTATE %s, got %v", state, err)
	}
}

func startIdentity(t *testing.T, ctx context.Context, dsn, schema string) string {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	addr := listener.Addr().String()
	_ = listener.Close()
	command := exec.CommandContext(ctx, "/agent02/bin/identity")
	command.Env = []string{"BTHWANI_ISOLATED_TEST_MODE=true", "IDENTITY_DEV_LISTEN_ADDR=" + addr,
		"IDENTITY_DB_SCHEMA=" + schema, "IDENTITY_TEST_DATABASE_URL=" + dsn}
	if err = command.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = command.Process.Kill(); _ = command.Wait() })
	origin := "http://" + addr
	client := &http.Client{Timeout: 150 * time.Millisecond}
	for range 50 {
		response, err := client.Get(origin + "/health")
		if err == nil {
			_ = response.Body.Close()
			if response.StatusCode == 200 {
				return origin
			}
		}
		time.Sleep(40 * time.Millisecond)
	}
	t.Fatal("isolated Identity HTTP owner failed readiness")
	return ""
}

func readWallet(t *testing.T, ctx context.Context, origin, token, route string, status int) []byte {
	t.Helper()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, origin+route, nil)
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Authorization", "Bearer "+token)
	request.Header.Set("X-Actor-ID", "other-wallet")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	body, err := io.ReadAll(response.Body)
	if err != nil || response.StatusCode != status || response.Header.Get("Cache-Control") != "no-store" {
		t.Fatalf("wallet HTTP status=%d expected=%d err=%v body=%s", response.StatusCode, status, err, body)
	}
	return body
}
