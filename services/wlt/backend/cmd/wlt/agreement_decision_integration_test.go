package main

import (
	"context"
	"database/sql"
	"fmt"
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
	// Exhaust the relation/fee/collector matrix against real WLT owner SQL.
	// These are proposed terms and recorded review only, never activation.
	const appendProposal = "SELECT version,replay FROM wlt.append_commercial_agreement_proposal($1,0,$2,$3,$4,$5,$6,$7,$8,ARRAY['CUSTOMER_PICKUP']::text[],'2027-01-01T00:00:00Z'::timestamptz,'synthetic-matrix-proposer','synthetic matrix terms')"
	cases := 0
	for _, relation := range []string{"DIRECT", "MARKETPLACE"} {
		for _, model := range []string{"COMMISSION", "SUBSCRIPTION"} {
			for _, collector := range []string{"PLATFORM_MANAGED", "STORE_MANAGED"} {
				cases++
				store := fmt.Sprintf("matrix-store-%d", cases)
				op := fmt.Sprintf("matrix-proposal-%d", cases)
				var rate, amount, period any
				if model == "COMMISSION" {
					rate = 375
				} else {
					amount, period = int64(9007199254740993), 30
				}
				var version int64
				var replay bool
				if e := owner.QueryRowContext(ctx, appendProposal, store, op, relation, model, collector, rate, amount, period).Scan(&version, &replay); e != nil || version != 1 || replay {
					t.Fatalf("proposal %s/%s/%s: %d %v %v", relation, model, collector, version, replay, e)
				}
				merchantOp := fmt.Sprintf("matrix-consent-%d", cases)
				financeOp := fmt.Sprintf("matrix-finance-%d", cases)
				if state, e := run(owner, store, 1, op, merchantOp, "ACCEPTED", "synthetic-matrix-merchant", reason); e != nil || state != "RECORDED" {
					t.Fatalf("matrix consent %s: %s %v", store, state, e)
				}
				if state, e := run(owner, store, 1, op, financeOp, "FINANCE_APPROVED", "synthetic-matrix-finance", reason); e != nil || state != "RECORDED" {
					t.Fatalf("matrix finance %s: %s %v", store, state, e)
				}
				if state, e := run(owner, store, 1, op, financeOp, "FINANCE_APPROVED", "synthetic-matrix-finance", reason); e != nil || state != "REPLAYED" {
					t.Fatalf("matrix finance replay %s: %s %v", store, state, e)
				}
				var gotRelation, gotModel, gotCollector, gotState string
				var gotRate, gotAmount, gotPeriod sql.NullInt64
				e := reader.QueryRowContext(ctx, "SELECT store_relation,fee_model,collector,review_state,commission_basis_points,subscription_amount_yer,subscription_period_days FROM wlt.latest_commercial_agreement_reviews WHERE store_id=$1 AND version=1", store).
					Scan(&gotRelation, &gotModel, &gotCollector, &gotState, &gotRate, &gotAmount, &gotPeriod)
				if e != nil || gotRelation != relation || gotModel != model || gotCollector != collector || gotState != "REVIEW_APPROVED_PENDING_ACTIVATION" {
					t.Fatalf("matrix readback %s: %s/%s/%s/%s %v", store, gotRelation, gotModel, gotCollector, gotState, e)
				}
				if model == "COMMISSION" {
					if !gotRate.Valid || gotRate.Int64 != 375 || gotAmount.Valid || gotPeriod.Valid {
						t.Fatalf("commission terms changed: %s", store)
					}
				} else if gotRate.Valid || !gotAmount.Valid || gotAmount.Int64 != 9007199254740993 || !gotPeriod.Valid || gotPeriod.Int64 != 30 {
					t.Fatalf("subscription terms changed: %s", store)
				}
			}
		}
	}
	var ignoredVersion int64
	var ignoredReplay bool
	err = owner.QueryRowContext(ctx, appendProposal, "matrix-no-collector", "matrix-missing-collector", "DIRECT", "COMMISSION", nil, 375, nil, nil).Scan(&ignoredVersion, &ignoredReplay)
	assertSQLState(t, err, "23502")
	var proposals, decisions, allocations, releases, journal, missing int
	err = owner.QueryRowContext(ctx, "SELECT (SELECT count(*) FROM wlt.store_commercial_agreement_proposals WHERE store_id LIKE 'matrix-store-%'),(SELECT count(*) FROM wlt.store_commercial_agreement_decisions WHERE store_id LIKE 'matrix-store-%'),(SELECT count(*) FROM wlt.order_payment_allocations),(SELECT count(*) FROM wlt.order_payment_releases),(SELECT count(*) FROM wlt.customer_funding_journal),(SELECT count(*) FROM wlt.store_commercial_agreement_proposals WHERE store_id='matrix-no-collector')").Scan(&proposals, &decisions, &allocations, &releases, &journal, &missing)
	if err != nil || cases != 8 || proposals != cases || decisions != 2*cases || allocations != 0 || releases != 0 || journal != 0 || missing != 0 {
		t.Fatalf("agreement matrix evidence: %d/%d/%d/%d/%d/%d %v", proposals, decisions, allocations, releases, journal, missing, err)
	}
	t.Log("WLT_AGREEMENT_MATRIX_PASS combinations=8 explicit_collector=true immutable_review=true no_payment_or_activation=true")

}
