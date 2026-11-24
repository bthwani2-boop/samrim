package main

import (
	"context"
	"database/sql"
	"sync"
	"testing"
)

// Only synthetic owner commands; no genuine consent or authority is asserted.
func verifyAgreementDecisions(t *testing.T, ctx context.Context, owner, reader *sql.DB) {
	t.Helper()
	const command = "SELECT wlt.record_commercial_agreement_decision($1,$2,$3,$4,$5,$6,$7)"
	run := func(db *sql.DB, store string, version int64, proposal, operation, decision, actor, reason string) (string, error) {
		var state string
		err := db.QueryRowContext(ctx, command, store, version, proposal, operation, decision, actor, reason).Scan(&state)
		return state, err
	}
	const reason = "synthetic reviewed exact terms"
	// The latest version's operation is chosen by the existing proposal race.
	var proposal string
	if err := owner.QueryRowContext(ctx, "SELECT operation_id FROM wlt.store_commercial_agreement_proposals WHERE store_id='store-a' AND version=2").Scan(&proposal); err != nil {
		t.Fatal(err)
	}
	call := func(operation, decision, actor string) (string, error) {
		return run(owner, "store-a", 2, proposal, operation, decision, actor, reason)
	}
	_, err := run(reader, "store-a", 2, proposal, "decision-denied-001", "ACCEPTED", "merchant-a", reason)
	assertSQLState(t, err, "42501")
	_, err = run(owner, "store-a", 1, "proposal-op-0001", "decision-stale-001", "ACCEPTED", "merchant-a", reason)
	assertSQLState(t, err, "40001")
	_, err = run(owner, "store-a", 2, "wrong-proposal", "decision-invalid-001", "ACCEPTED", "merchant-a", reason)
	assertSQLState(t, err, "23514")
	_, err = call("decision-review-early", "FINANCE_APPROVED", "finance-a")
	assertSQLState(t, err, "23514")
	_, err = call("decision-self-consent", "ACCEPTED", "synthetic-operator")
	assertSQLState(t, err, "23514")
	// Concurrent identical commands produce one immutable consent.
	type result struct {
		state string
		err   error
	}
	ch := make(chan result, 2)
	var wg sync.WaitGroup
	for range 2 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			state, e := call("decision-consent-001", "ACCEPTED", "merchant-a")
			ch <- result{state, e}
		}()
	}
	wg.Wait()
	close(ch)
	created, replayed := 0, 0
	for r := range ch {
		if r.err != nil {
			t.Fatal(r.err)
		}
		switch r.state {
		case "RECORDED":
			created++
		case "REPLAYED":
			replayed++
		default:
			t.Fatal(r.state)
		}
	}
	if created != 1 || replayed != 1 {
		t.Fatalf("consent race %d %d", created, replayed)
	}
	_, err = call("decision-consent-001", "DECLINED", "merchant-a")
	assertSQLState(t, err, "23505")
	_, err = call("decision-consent-other", "DECLINED", "merchant-a")
	assertSQLState(t, err, "23505")
	_, err = call("decision-self-review", "FINANCE_APPROVED", "merchant-a")
	assertSQLState(t, err, "23514")
	_, err = call("decision-proposer-review", "FINANCE_APPROVED", "synthetic-operator")
	assertSQLState(t, err, "23514")
	if state, e := call("decision-finance-001", "FINANCE_APPROVED", "finance-a"); e != nil || state != "RECORDED" {
		t.Fatalf("finance review %s %v", state, e)
	}
	if state, e := call("decision-finance-001", "FINANCE_APPROVED", "finance-a"); e != nil || state != "REPLAYED" {
		t.Fatalf("finance replay %s %v", state, e)
	}
	// A different decision after a terminal review cannot silently replace it.
	_, err = call("decision-finance-other", "FINANCE_REJECTED", "finance-b")
	assertSQLState(t, err, "23505")
	// Declined subscription has no approval and no invoicing.
	if state, e := run(owner, "store-b", 1, "proposal-op-0002", "decision-sub-declined", "DECLINED", "merchant-b", reason); e != nil || state != "RECORDED" {
		t.Fatalf("decline %s %v", state, e)
	}
	_, err = run(owner, "store-b", 1, "proposal-op-0002", "decision-sub-review", "FINANCE_APPROVED", "finance-b", reason)
	assertSQLState(t, err, "23514")
	var a, b string
	if err = owner.QueryRowContext(ctx, "SELECT review_state FROM wlt.commercial_agreement_review_states WHERE store_id='store-a' AND version=2").Scan(&a); err != nil || a != "REVIEW_APPROVED_PENDING_ACTIVATION" {
		t.Fatalf("commission state %s %v", a, err)
	}
	if err = owner.QueryRowContext(ctx, "SELECT review_state FROM wlt.commercial_agreement_review_states WHERE store_id='store-b' AND version=1").Scan(&b); err != nil || b != "DECLINED" {
		t.Fatalf("subscription state %s %v", b, err)
	}
	for _, q := range []string{"UPDATE wlt.store_commercial_agreement_decisions SET reason='rewrite'", "DELETE FROM wlt.store_commercial_agreement_decisions", "TRUNCATE wlt.store_commercial_agreement_decisions"} {
		_, err = owner.ExecContext(ctx, q)
		assertSQLState(t, err, "23514")
	}
	_, err = reader.ExecContext(ctx, "SELECT * FROM wlt.commercial_agreement_review_states")
	assertSQLState(t, err, "42501")
	var count, posted int
	if err = owner.QueryRowContext(ctx, "SELECT (SELECT count(*) FROM wlt.store_commercial_agreement_decisions),(SELECT count(*) FROM wlt.customer_funding_journal)").Scan(&count, &posted); err != nil || count != 3 || posted != 0 {
		t.Fatalf("decision evidence %d money %d %v", count, posted, err)
	}
	t.Log("WLT_AGREEMENT_DECISIONS_PASS consent_replay=true distinct_finance=true stale_rejected=true no_activation=true")
}
