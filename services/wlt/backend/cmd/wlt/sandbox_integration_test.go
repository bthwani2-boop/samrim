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
		return runSandboxFunding(ctx, "post-sandbox-funding", []string{reference, amount}, strings.NewReader(token+"\r\n"), output,
			func(key string) string { return env[key] })
	}
	reverse := func(token, reference string, output io.Writer) error {
		return runSandboxFunding(ctx, "reverse-sandbox-funding", []string{reference}, strings.NewReader(token+"\r\n"), output,
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

	_, err = reader.ExecContext(ctx, "SELECT wlt.reverse_sandbox_customer_funding('interrupted-credit', 'wallet-two')")
	assertSQLState(t, err, "42501")
	for _, invalid := range []struct{ token, reference string }{
		{other, "interrupted-credit"}, {merchant, "interrupted-credit"}, {revoked, "interrupted-credit"},
		{customer, "missing-credit"}, {customer, "invalid-reference!"},
	} {
		if err := reverse(invalid.token, invalid.reference, io.Discard); err == nil {
			t.Fatal("invalid or out-of-scope reversal succeeded")
		}
	}

	_, err = owner.ExecContext(ctx, `INSERT INTO wlt.customer_funding_journal
		(funding_id, actor_id, provider_id, provider_reference, amount_yer, reverses_funding_id)
		VALUES ('reversal-invalid', 'wallet-two', 'sandbox-reversal', 'interrupted-credit', 8, 'sandbox-interrupted-credit')`)
	assertSQLState(t, err, "23514")

	// A real existing sandbox credit must not be reversed while its balance is held.
	var reservation string
	if err = owner.QueryRowContext(ctx, "SELECT wlt.allocate_order_payment($1,$2,$3,$4,$5,$6,$7)", "checkout-reversal-guard", "wallet-two", "store-a", strings.Repeat("b", 64), "WALLET", int64(57), int64(57)).Scan(&reservation); err != nil || reservation != "ALLOCATED" {
		t.Fatalf("reserve before reversal %s %v", reservation, err)
	}
	// A held amount remains in posted funding but must disappear from available funding.
	body = readWallet(t, ctx, wallet, customer, "/v1/wallets/me", 200)
	if err := json.Unmarshal(body, &balance); err != nil || balance["balanceYer"] != "57" || balance["availableYer"] != "0" {
		t.Fatalf("held funds must not be available: %s", body)
	}
	var otherBalance map[string]string
	body = readWallet(t, ctx, wallet, other, "/v1/wallets/me", 200)
	if err := json.Unmarshal(body, &otherBalance); err != nil || otherBalance["availableYer"] != "0" || otherBalance["actorId"] != "wallet-empty" {
		t.Fatalf("other customer's funding changed or leaked: %s", body)
	}
	if err = reverse(customer, "interrupted-credit", io.Discard); err == nil {
		t.Fatal("reversed reserved funding")
	}
	var heldBalance string
	if err = owner.QueryRowContext(ctx, "SELECT balance_yer::text FROM wlt.customer_wallet_balances WHERE actor_id='wallet-two'").Scan(&heldBalance); err != nil || heldBalance != "57" {
		t.Fatalf("guard changed posted balance %s %v", heldBalance, err)
	}
	if err = owner.QueryRowContext(ctx, "SELECT wlt.release_order_payment($1,$2,$3,$4)", "checkout-reversal-guard", "wallet-two", "release-reversal-guard", "synthetic cancellation").Scan(&reservation); err != nil || reservation != "RELEASED" {
		t.Fatalf("release before reversal %s %v", reservation, err)
	}
	body = readWallet(t, ctx, wallet, customer, "/v1/wallets/me", 200)
	if err := json.Unmarshal(body, &balance); err != nil || balance["balanceYer"] != "57" || balance["availableYer"] != "57" {
		t.Fatalf("released funds must be available again: %s", body)
	}
	if err := reverse(customer, "interrupted-credit", lostConfirmation{}); !errors.Is(err, io.ErrClosedPipe) {
		t.Fatalf("expected lost reversal confirmation, got %v", err)
	}
	replay.Reset()
	if err := reverse(customer, "interrupted-credit", &replay); err != nil || replay.String() != "REPLAYED\n" {
		t.Fatalf("reversal recovery failed: %q %v", replay.String(), err)
	}

	reversals := make(chan string, attempts)
	for range attempts {
		group.Go(func() {
			var out strings.Builder
			if err := reverse(customer, "concurrent-credit", &out); err != nil {
				t.Errorf("concurrent reversal failed: %v", err)
			}
			reversals <- strings.TrimSpace(out.String())
		})
	}
	group.Wait()
	close(reversals)
	reversed := 0
	for result := range reversals {
		switch result {
		case "REVERSED":
			reversed++
		case "REPLAYED":
		default:
			t.Errorf("unexpected reversal outcome %q", result)
		}
	}
	if reversed != 1 {
		t.Fatalf("expected one concurrent reversal, got %d", reversed)
	}

	body = readWallet(t, ctx, wallet, customer, "/v1/wallets/me", 200)
	if err := json.Unmarshal(body, &balance); err != nil || balance["balanceYer"] != "41" {
		t.Fatalf("sandbox reversals did not offset the credits exactly once: %s", body)
	}
	history = string(readWallet(t, ctx, wallet, customer, "/v1/wallets/me/transactions", 200))
	for _, reference := range []string{"concurrent-credit", "interrupted-credit"} {
		if strings.Count(history, `"reversesFundingId":"sandbox-`+reference+`"`) != 1 ||
			strings.Count(history, `"fundingId":"sandbox-`+reference+`"`) != 1 {
			t.Fatalf("history must contain the reversal and original %s exactly once", reference)
		}
	}
	body = readWallet(t, ctx, wallet, other, "/v1/wallets/me/transactions", 200)
	if strings.Contains(string(body), "reversesFundingId") {
		t.Fatal("another Customer received the sandbox reversal")
	}
	var reversedEntries int
	if err := owner.QueryRowContext(ctx, `SELECT count(*) FROM wlt.customer_funding_entries
		WHERE funding_id = 'sandbox_reversal-interrupted-credit' AND amount_yer = 9 AND currency = 'YER'
		  AND ((account = 'customer_wallet_liability' AND side = 'debit')
		    OR (account = 'funding_clearing' AND side = 'credit'))`).Scan(&reversedEntries); err != nil || reversedEntries != 2 {
		t.Fatalf("reversal did not post the two opposite legs: %d %v", reversedEntries, err)
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
	t.Run("confirmed synthetic provider funding only", func(t *testing.T) {
		testVerifiedSandboxProviderFunding(t, ctx, owner, sandboxDSN, identity, wallet, customer, revoked, merchant)
	})
	t.Log("WLT sandbox funding, reversal and provider-confirmed credit: Identity binding, least privilege, concurrency, lost confirmations and durable HTTP readback passed")
}

type lostConfirmation struct{}

func (lostConfirmation) Write([]byte) (int, error) { return 0, io.ErrClosedPipe }
