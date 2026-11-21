package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

func testVerifiedSandboxProviderFunding(t *testing.T, ctx context.Context, owner *sql.DB,
	sandboxDSN, identityOrigin, walletOrigin, customerToken, revokedToken, merchantToken string,
) {
	t.Helper()
	type providerState struct {
		actor, amount, currency, status string
		httpStatus                      int
	}
	providerCases := map[string]providerState{
		"cash-in-accepted-01":    {"wallet-two", "17", "YER", "SUCCEEDED", 200},
		"cash-in-pending-01":     {"wallet-two", "11", "YER", "PENDING", 200},
		"cash-in-failed-01":      {"wallet-two", "11", "YER", "FAILED", 200},
		"cash-in-wrong-actor":    {"wallet-one", "11", "YER", "SUCCEEDED", 200},
		"cash-in-wrong-amount":   {"wallet-two", "12", "YER", "SUCCEEDED", 200},
		"cash-in-wrong-currency": {"wallet-two", "11", "USD", "SUCCEEDED", 200},
		"cash-in-server-error":   {"wallet-two", "11", "YER", "SUCCEEDED", 503},
	}
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || !strings.HasPrefix(r.URL.Path, "/sandbox/v1/funding/") {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		ref := strings.TrimPrefix(r.URL.Path, "/sandbox/v1/funding/")
		c, exists := providerCases[ref]
		if !exists {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(c.httpStatus)
		_ = json.NewEncoder(w).Encode(map[string]string{
			"reference": ref, "actorId": c.actor, "amountYer": c.amount,
			"currency": c.currency, "status": c.status,
		})
	}))
	defer provider.Close()
	env := map[string]string{
		"BTHWANI_ISOLATED_TEST_MODE":  "true",
		"WLT_SANDBOX_DATABASE_URL":    sandboxDSN,
		"WLT_TEST_IDENTITY_ORIGIN":    identityOrigin,
		"WLT_SANDBOX_PROVIDER_ORIGIN": provider.URL,
	}
	run := func(token, reference, amount string, output io.Writer) error {
		return runSandboxFunding(ctx, "verify-sandbox-provider-funding", []string{reference, amount},
			strings.NewReader(token+"\n"), output, func(key string) string { return env[key] })
	}
	for _, tc := range []struct{ token, ref, amount string }{
		{customerToken, "cash-in-pending-01", "11"},
		{customerToken, "cash-in-failed-01", "11"},
		{customerToken, "cash-in-wrong-actor", "11"},
		{customerToken, "cash-in-wrong-amount", "11"},
		{customerToken, "cash-in-wrong-currency", "11"},
		{customerToken, "cash-in-server-error", "11"},
		{customerToken, "cash-in-missing-01", "11"},
		{revokedToken, "cash-in-accepted-01", "17"},
		{merchantToken, "cash-in-accepted-01", "17"},
	} {
		if err := run(tc.token, tc.ref, tc.amount, io.Discard); err == nil {
			t.Errorf("unverified or unauthorized sandbox funding succeeded: %s", tc.ref)
		}
	}
	var before int
	if err := owner.QueryRowContext(ctx, "SELECT count(*) FROM wlt.customer_funding_journal WHERE provider_reference LIKE 'cash-in-%'").Scan(&before); err != nil || before != 0 {
		t.Fatalf("unconfirmed provider attempts posted funds: %d %v", before, err)
	}

	const attempts = 8
	results := make(chan string, attempts)
	var group sync.WaitGroup
	for range attempts {
		group.Go(func() {
			var output strings.Builder
			if err := run(customerToken, "cash-in-accepted-01", "17", &output); err != nil {
				t.Errorf("confirmed provider credit failed: %v", err)
			}
			results <- strings.TrimSpace(output.String())
		})
	}
	group.Wait()
	close(results)
	posted, replayed := 0, 0
	for state := range results {
		switch state {
		case "POSTED":
			posted++
		case "REPLAYED":
			replayed++
		default:
			t.Errorf("unexpected sandbox provider outcome %q", state)
		}
	}
	if posted != 1 || replayed != attempts-1 {
		t.Fatalf("expected one journal posting and %d replays, got %d and %d", attempts-1, posted, replayed)
	}
	if err := run(customerToken, "cash-in-accepted-01", "18", io.Discard); err == nil {
		t.Fatal("changed amount was accepted for existing provider reference")
	}

	var count, unbalanced int
	if err := owner.QueryRowContext(ctx, `SELECT count(*),
		count(*) FILTER (WHERE legs <> 2 OR net <> 0)
		FROM (
			SELECT j.funding_id, count(e.*) AS legs,
				sum(CASE e.side WHEN 'debit' THEN e.amount_yer ELSE -e.amount_yer END) AS net
			FROM wlt.customer_funding_journal j
			JOIN wlt.customer_funding_entries e ON e.funding_id=j.funding_id
			WHERE j.provider_reference LIKE 'cash-in-%'
			GROUP BY j.funding_id
		) checks`).Scan(&count, &unbalanced); err != nil || count != 1 || unbalanced != 0 {
		t.Fatalf("synthetic provider posting count=%d unbalanced=%d err=%v", count, unbalanced, err)
	}
	body := readWallet(t, ctx, walletOrigin, customerToken, "/v1/wallets/me", 200)
	var balance map[string]string
	if err := json.Unmarshal(body, &balance); err != nil || balance["balanceYer"] != "58" {
		t.Fatalf("provider-confirmed WLT balance did not increase exactly once: %s, %v", body, err)
	}
	history := string(readWallet(t, ctx, walletOrigin, customerToken, "/v1/wallets/me/transactions", 200))
	if strings.Count(history, `"fundingId":"sandbox-cash-in-accepted-01"`) != 1 {
		t.Fatalf("provider confirmation not present once in Customer history: %s", history)
	}
	// Unknown outcome after credit is not converted to another credit or a new rail identity.
	provider.Close()
	if err := run(customerToken, "cash-in-accepted-01", "17", io.Discard); err == nil {
		t.Fatal("unreachable simulator was treated as a new confirmed provider result")
	}
	if err := owner.QueryRowContext(ctx, "SELECT count(*) FROM wlt.customer_funding_journal WHERE provider_reference='cash-in-accepted-01'").Scan(&count); err != nil || count != 1 {
		t.Fatalf("provider outage corrupted committed funding: count=%d err=%v", count, err)
	}
	t.Log(fmt.Sprintf("verified synthetic cash-in: one balanced %d YER journal, %d replayed callbacks, owner HTTP readback", 17, replayed))
}
