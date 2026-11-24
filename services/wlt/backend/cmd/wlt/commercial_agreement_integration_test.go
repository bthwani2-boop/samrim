package main

import (
	"context"
	"database/sql"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/lib/pq"
)

// These are synthetic owner fixtures, not actual Merchant consent or Finance approval.
func verifyCommercialAgreementProposals(t *testing.T, ctx context.Context, owner, reader *sql.DB) {
	t.Helper()
	const appendProposal = `SELECT version,replay FROM wlt.append_commercial_agreement_proposal($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`
	effective := time.Date(2027, 1, 1, 0, 0, 0, 0, time.UTC)
	args := []any{"store-a", int64(0), "proposal-op-0001", "MARKETPLACE", "COMMISSION", "PLATFORM_MANAGED", int64(375), nil, nil, pq.Array([]string{"BTHWANI_CAPTAIN", "CUSTOMER_PICKUP"}), effective, "synthetic-operator", "synthetic proposal"}
	run := func(db *sql.DB, a []any) (int64, bool, error) {
		var version int64
		var replay bool
		err := db.QueryRowContext(ctx, appendProposal, a...).Scan(&version, &replay)
		return version, replay, err
	}
	with := func(base []any, index int, value any) []any {
		a := append([]any(nil), base...)
		a[index] = value
		return a
	}
	v, replay, err := run(owner, args)
	if err != nil || v != 1 || replay {
		t.Fatalf("create proposal: %d %v %v", v, replay, err)
	}
	v, replay, err = run(owner, args)
	if err != nil || v != 1 || !replay {
		t.Fatalf("replay: %d %v %v", v, replay, err)
	}
	_, _, err = run(owner, with(args, 6, int64(400)))
	assertSQLState(t, err, "23505")
	_, _, err = run(owner, with(args, 0, "store-b"))
	assertSQLState(t, err, "23505")
	_, _, err = run(owner, with(args, 2, "proposal-op-stale"))
	assertSQLState(t, err, "40001")
	for _, bad := range [][]any{
		with(with(args, 2, "proposal-op-invalid-01"), 3, "UNKNOWN"),
		with(with(args, 2, "proposal-op-invalid-02"), 4, "HYBRID"),
		with(with(args, 2, "proposal-op-invalid-03"), 5, "OTHER"),
		with(with(args, 2, "proposal-op-invalid-04"), 6, int64(10001)),
		with(with(args, 2, "proposal-op-invalid-05"), 7, int64(1)),
		with(with(args, 2, "proposal-op-invalid-06"), 9, pq.Array([]string{"CUSTOMER_PICKUP", "CUSTOMER_PICKUP"})),
		with(with(args, 2, "proposal-op-invalid-07"), 9, pq.Array([]string{"UNKNOWN"})),
	} {
		bad[1] = int64(1)
		_, _, err = run(owner, bad)
		assertSQLState(t, err, "23514")
	}
	subscription := []any{"store-b", int64(0), "proposal-op-0002", "DIRECT", "SUBSCRIPTION", "STORE_MANAGED", nil, int64(9007199254740993), int64(30), pq.Array([]string{"CUSTOMER_PICKUP"}), effective, "synthetic-operator", "synthetic terms"}
	v, replay, err = run(owner, subscription)
	if err != nil || v != 1 || replay {
		t.Fatalf("subscription proposal: %d %v %v", v, replay, err)
	}
	var amount string
	if err = owner.QueryRowContext(ctx, "SELECT subscription_amount_yer::text FROM wlt.store_commercial_agreement_proposals WHERE store_id='store-b' AND version=1").Scan(&amount); err != nil || amount != "9007199254740993" {
		t.Fatalf("exact amount: %s %v", amount, err)
	}
	next := with(with(args, 1, int64(1)), 6, int64(425))
	results := make(chan error, 2)
	var wg sync.WaitGroup
	for _, id := range []string{"proposal-op-race-a", "proposal-op-race-b"} {
		a := with(next, 2, id)
		wg.Add(1)
		go func() { defer wg.Done(); _, _, err := run(owner, a); results <- err }()
	}
	wg.Wait()
	close(results)
	winners, conflicts := 0, 0
	for e := range results {
		if e == nil {
			winners++
			continue
		}
		var pqErr *pq.Error
		if errors.As(e, &pqErr) && string(pqErr.Code) == "40001" {
			conflicts++
		} else {
			t.Fatal(e)
		}
	}
	if winners != 1 || conflicts != 1 {
		t.Fatalf("version race winners=%d conflicts=%d", winners, conflicts)
	}
	v, replay, err = run(owner, args)
	if err != nil || v != 1 || !replay {
		t.Fatalf("old retry after successor: %d %v %v", v, replay, err)
	}
	var count, firstRate, lastRate int
	err = owner.QueryRowContext(ctx, `SELECT count(*),min(commission_basis_points),max(commission_basis_points) FROM wlt.store_commercial_agreement_proposals WHERE store_id='store-a'`).Scan(&count, &firstRate, &lastRate)
	if err != nil || count != 2 || firstRate != 375 || lastRate != 425 {
		t.Fatalf("history: %d %d %d %v", count, firstRate, lastRate, err)
	}
	for _, statement := range []string{
		"UPDATE wlt.store_commercial_agreement_proposals SET commission_basis_points=1 WHERE store_id='store-a'",
		"DELETE FROM wlt.store_commercial_agreement_proposals WHERE store_id='store-a'",
		"TRUNCATE wlt.store_commercial_agreement_proposals",
	} {
		_, err = owner.ExecContext(ctx, statement)
		assertSQLState(t, err, "23514")
	}
	_, err = reader.ExecContext(ctx, "SELECT * FROM wlt.store_commercial_agreement_proposals")
	assertSQLState(t, err, "42501")
	_, _, err = run(reader, args)
	assertSQLState(t, err, "42501")
	if err = owner.QueryRowContext(ctx, "SELECT count(*) FROM wlt.customer_funding_journal").Scan(&count); err != nil || count != 0 {
		t.Fatalf("proposal changed money: %d %v", count, err)
	}
}
