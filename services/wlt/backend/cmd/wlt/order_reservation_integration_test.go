package main

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"sync"
	"testing"

	"github.com/lib/pq"
)

// Existing isolated owner fixture only; no Order, customer charge or consent
// is manufactured by this reservation test.
func verifyOrderFundingReservations(t *testing.T, ctx context.Context, owner, reader *sql.DB) {
	t.Helper()
	const reserve = "SELECT wlt.reserve_order_wallet($1,$2,$3,$4,$5,$6,$7)"
	const release = "SELECT wlt.release_order_wallet($1,$2,$3,$4)"
	digest := strings.Repeat("a", 64)
	run := func(db *sql.DB, key, actor, method string, total, amount int64) (string, error) {
		var state string
		err := db.QueryRowContext(ctx, reserve, key, actor, "store-a", digest, method, total, amount).Scan(&state)
		return state, err
	}
	unlock := func(key, actor, op, reason string) (string, error) {
		var state string
		err := owner.QueryRowContext(ctx, release, key, actor, op, reason).Scan(&state)
		return state, err
	}
	balance := func(actor string, expected string) {
		t.Helper()
		var available string
		if err := owner.QueryRowContext(ctx, "SELECT wlt.available_order_wallet_yer($1)::text", actor).Scan(&available); err != nil || available != expected {
			t.Fatalf("available %s: got %s want %s: %v", actor, available, expected, err)
		}
	}
	balance("wallet-two", "41")
	if _, err := run(reader, "checkout-denied", "wallet-two", "WALLET", 1, 1); err == nil {
		t.Fatal("reader can reserve")
	} else {
		assertSQLState(t, err, "42501")
	}
	for _, bad := range []struct {
		method        string
		total, amount int64
	}{{"COD", 10, 1}, {"WALLET", 10, 9}, {"MIXED", 10, 10}, {"MIXED", 10, 0}, {"WALLET", 0, 0}, {"MIXED", -1, 1}} {
		_, err := run(owner, "checkout-invalid", "wallet-two", bad.method, bad.total, bad.amount)
		assertSQLState(t, err, "23514")
	}
	if _, err := run(owner, "checkout-no-funds", "wallet-two", "WALLET", 42, 42); err == nil {
		t.Fatal("over-reservation")
	} else {
		assertSQLState(t, err, "23514")
	}
	// Two distinct checkout keys competing for 41 YER cannot both reserve 30.
	type outcome struct {
		key, state string
		err        error
	}
	results := make(chan outcome, 2)
	var wg sync.WaitGroup
	for _, key := range []string{"checkout-race-a", "checkout-race-b"} {
		wg.Add(1)
		go func(key string) {
			defer wg.Done()
			state, err := run(owner, key, "wallet-two", "MIXED", 45, 30)
			results <- outcome{key, state, err}
		}(key)
	}
	wg.Wait()
	close(results)
	winner := ""
	for result := range results {
		if result.err == nil && result.state == "RESERVED" {
			if winner != "" {
				t.Fatal("two winning holds")
			}
			winner = result.key
			continue
		}
		var pqErr *pq.Error
		if !errors.As(result.err, &pqErr) || string(pqErr.Code) != "23514" {
			t.Fatalf("unexpected competing result %+v", result)
		}
	}
	if winner == "" {
		t.Fatal("no winning hold")
	}
	balance("wallet-two", "11")
	if state, err := run(owner, winner, "wallet-two", "MIXED", 45, 30); err != nil || state != "REPLAYED" {
		t.Fatalf("replay %s %v", state, err)
	}
	_, err := run(owner, winner, "wallet-one", "MIXED", 45, 30)
	assertSQLState(t, err, "23505")
	_, err = run(owner, winner, "wallet-two", "MIXED", 45, 29)
	assertSQLState(t, err, "23505")
	_, err = unlock(winner, "wallet-one", "release-wrong-actor", "synthetic reason")
	assertSQLState(t, err, "23514")
	if state, err := unlock(winner, "wallet-two", "release-winner-001", "synthetic reason"); err != nil || state != "RELEASED" {
		t.Fatalf("release %s %v", state, err)
	}
	if state, err := unlock(winner, "wallet-two", "release-winner-001", "synthetic reason"); err != nil || state != "REPLAYED" {
		t.Fatalf("release replay %s %v", state, err)
	}
	_, err = unlock(winner, "wallet-two", "release-winner-002", "different reason")
	assertSQLState(t, err, "23505")
	if state, err := run(owner, winner, "wallet-two", "MIXED", 45, 30); err != nil || state != "RELEASED" {
		t.Fatalf("released checkout resurrected: %s %v", state, err)
	}
	balance("wallet-two", "41")
	if state, err := run(owner, "checkout-exact-big", "wallet-one", "WALLET", 9007199254740993, 9007199254740993); err != nil || state != "RESERVED" {
		t.Fatalf("exact integer %s %v", state, err)
	}
	balance("wallet-one", "0")
	if _, err := unlock("checkout-exact-big", "wallet-one", "release-big-001", "synthetic reason"); err != nil {
		t.Fatal(err)
	}
	balance("wallet-one", "9007199254740993")
	for _, q := range []string{"UPDATE wlt.order_wallet_reservations SET wallet_yer=1", "DELETE FROM wlt.order_wallet_releases", "TRUNCATE wlt.order_wallet_reservations CASCADE"} {
		_, err = owner.ExecContext(ctx, q)
		assertSQLState(t, err, "23514")
	}
	_, err = reader.ExecContext(ctx, "SELECT * FROM wlt.order_wallet_reservations")
	assertSQLState(t, err, "42501")
	var count, open int
	err = owner.QueryRowContext(ctx, `SELECT count(*),count(*) FILTER(WHERE r.checkout_id IS NULL) FROM wlt.order_wallet_reservations h LEFT JOIN wlt.order_wallet_releases r USING(checkout_id)`).Scan(&count, &open)
	if err != nil || count != 2 || open != 0 {
		t.Fatalf("durable holds %d open %d %v", count, open, err)
	}
	t.Log("WLT_ORDER_WALLET_RESERVATION_PASS single_winner=true exact_yer=true replay=true release=true no_charge=true")
}
