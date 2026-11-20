package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"strings"
	"sync"
	"testing"
)

func testSandboxFunding(t *testing.T, ctx context.Context, reader, owner, identityDB *sql.DB,
	sandboxDSN, identity, wallet, revoked, customer, other, merchant string,
) {
	t.Helper()
	env := map[string]string{
		"BTHWANI_ISOLATED_TEST_MODE": "true",
		"WLT_SANDBOX_DATABASE_URL":   sandboxDSN,
		"WLT_TEST_IDENTITY_ORIGIN":   identity,
	}
	run := func(token, reference, amount string, output io.Writer) error {
		return runSandboxFunding(ctx, []string{reference, amount}, strings.NewReader(token+"\r\n"), output,
			func(key string) string { return env[key] })
	}
	command := "SELECT wlt.post_sandbox_customer_funding('denied-command', 'wallet-two', 9)"
	_, err := reader.ExecContext(ctx, command)
	assertSQLState(t, err, "42501")
	sandbox := openTestDB(t, sandboxDSN)
	_, err = sandbox.ExecContext(ctx, "SELECT provider_reference FROM wlt.customer_funding_journal")
	assertSQLState(t, err, "42501")
	_, err = sandbox.ExecContext(ctx, "UPDATE wlt.customer_funding_journal SET amount_yer = 9")
	assertSQLState(t, err, "42501")

	for _, input := range []struct{ token, reference, amount string }{
		{revoked, "revoked-session", "9"}, {merchant, "wrong-role", "9"},
		{"invalid", "invalid-session", "9"}, {customer, "invalid-reference!", "9"},
		{customer, "zero-amount", "0"}, {customer, "decimal-amount", "9.5"},
	} {
		if err := run(input.token, input.reference, input.amount, io.Discard); err == nil {
			t.Fatalf("invalid sandbox command succeeded for %s", input.reference)
		}
	}

	const attempts = 8
	results := make(chan string, attempts)
	var group sync.WaitGroup
	for range attempts {
		group.Go(func() {
			var out strings.Builder
			if err := run(customer, "concurrent-credit", "7", &out); err != nil {
				t.Errorf("concurrent sandbox command failed: %v", err)
			}
			results <- strings.TrimSpace(out.String())
		})
	}
	group.Wait()
	close(results)
	postings := 0
	for result := range results {
		switch result {
		case "POSTED":
			postings++
		case "REPLAYED":
		default:
			t.Errorf("unconfirmed concurrent result: %q", result)
		}
	}
	if postings != 1 {
		t.Fatalf("expected one posting, got %d", postings)
	}
	for _, input := range []struct{ token, amount string }{{other, "7"}, {customer, "8"}} {
		if err := run(input.token, "concurrent-credit", input.amount, io.Discard); err == nil ||
			!strings.Contains(err.Error(), "conflicts") {
			t.Fatal("different actor or amount reused a posted reference")
		}
	}

	if err := run(customer, "interrupted-credit", "9", lostConfirmation{}); !errors.Is(err, io.ErrClosedPipe) {
		t.Fatalf("expected lost result delivery, got %v", err)
	}
	var replay strings.Builder
	if err := run(customer, "interrupted-credit", "9", &replay); err != nil || replay.String() != "REPLAYED\n" {
		t.Fatalf("recovery did not read the earlier posting: %q %v", replay.String(), err)
	}

	body := readWallet(t, ctx, wallet, customer, "/v1/wallets/me", 200)
	var balance map[string]string
	if err := json.Unmarshal(body, &balance); err != nil || balance["balanceYer"] != "57" {
		t.Fatalf("unexpected owner balance after sandbox funding: %s", body)
	}
	history := string(readWallet(t, ctx, wallet, customer, "/v1/wallets/me/transactions", 200))
	for _, id := range []string{"sandbox-concurrent-credit", "sandbox-interrupted-credit"} {
		if strings.Count(history, id) != 1 {
			t.Fatalf("expected exactly one posted entry for %s", id)
		}
	}
	body = readWallet(t, ctx, wallet, other, "/v1/wallets/me/transactions", 200)
	if strings.Contains(string(body), "sandbox-") {
		t.Fatal("another Customer received sandbox postings")
	}
	lock, err := owner.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer lock.Rollback()
	if _, err := lock.ExecContext(ctx, "LOCK TABLE wlt.customer_funding_journal IN ACCESS EXCLUSIVE MODE"); err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() { done <- run(other, "revoked-in-flight", "9", io.Discard) }()
	waitForWalletQuery(t, ctx, sandbox, "wlt.post_sandbox_customer_funding")
	executeFixture(t, ctx, identityDB, "UPDATE identity_test_wlt.auth_sessions SET revoked_at=now() WHERE actor_id='wallet-empty'")
	if err := lock.Rollback(); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-done:
		if err == nil {
			t.Fatal("a revocation during the write allowed a sandbox credit")
		}
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	var posted bool
	if err := owner.QueryRowContext(ctx, `SELECT EXISTS (
		SELECT 1 FROM wlt.customer_funding_journal WHERE funding_id='sandbox-revoked-in-flight')`).Scan(&posted); err != nil || posted {
		t.Fatalf("in-flight revocation did not prevent durable credit: %t %v", posted, err)
	}
	t.Log("WLT sandbox funding: Identity binding, privilege isolation, conflict, replay, lost confirmation and durable HTTP readback passed")
}

type lostConfirmation struct{}

func (lostConfirmation) Write([]byte) (int, error) { return 0, io.ErrClosedPipe }
