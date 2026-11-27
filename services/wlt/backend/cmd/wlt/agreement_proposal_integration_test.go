package main

import (
	"context"
	"database/sql"
	"errors"
	"testing"
	"time"

	"github.com/bthwani2-boop/samrim/services/wlt/backend/internal/wallet"
)

func verifyProposalCommandAuthority(t *testing.T, ctx context.Context, owner, reader, executor, dsh *sql.DB, identityOrigin, dshOrigin, merchant, proposer, other, revoked string) {
	t.Helper()
	bps := int32(375)
	proposal := wallet.AgreementProposal{
		StoreID: "proposal-owner", OperationID: "proposal-owner-01", FeeModel: "COMMISSION",
		Collector: "PLATFORM_MANAGED", CommissionBasisPoints: &bps,
		FulfillmentModes:    []string{"CUSTOMER_PICKUP"},
		ProposedEffectiveAt: time.Date(2027, 2, 1, 0, 0, 0, 123000, time.UTC), Reason: "synthetic proposal",
	}
	check := func(db *sql.DB, bearer string, input wallet.AgreementProposal, version int64, replay bool, want error) {
		t.Helper()
		got, err := wallet.RecordFinanceAgreementProposal(ctx, db, identityOrigin, dshOrigin, bearer, input)
		if !errors.Is(err, want) || got.Version != version || got.Replay != replay {
			t.Fatalf("proposal result=%+v error=%v, want version=%d replay=%t error=%v", got, err, version, replay, want)
		}
	}
	check(executor, merchant, proposal, 0, false, wallet.ErrAgreementForbidden)
	check(executor, other, proposal, 0, false, wallet.ErrAgreementForbidden)
	check(executor, revoked, proposal, 0, false, wallet.ErrAgreementForbidden)
	check(reader, proposer, proposal, 0, false, wallet.ErrAgreementUnconfirmed)
	check(executor, proposer, proposal, 1, false, nil)
	check(executor, proposer, proposal, 1, true, nil)
	changed := proposal
	changed.Reason = "changed terms"
	check(executor, proposer, changed, 0, false, wallet.ErrAgreementConflict)
	changed = proposal
	changed.OperationID = "proposal-owner-02"
	check(executor, proposer, changed, 0, false, wallet.ErrAgreementConflict)
	changed.ExpectedVersion = 1
	check(executor, proposer, changed, 2, false, nil)
	check(executor, proposer, proposal, 1, true, nil)

	var relation, state, actor string
	var effective time.Time
	if err := owner.QueryRowContext(ctx, `SELECT p.store_relation,s.review_state,p.proposed_by_actor,p.proposed_effective_at
		FROM wlt.store_commercial_agreement_proposals p JOIN wlt.commercial_agreement_review_states s USING (store_id,version)
		WHERE p.store_id=$1 AND p.version=2`, proposal.StoreID).Scan(&relation, &state, &actor, &effective); err != nil ||
		relation != "DIRECT" || state != "AWAITING_MERCHANT_CONSENT" || actor != "finance-proposer" || !effective.Equal(proposal.ProposedEffectiveAt) {
		t.Fatalf("wrong durable proposal relation=%s state=%s actor=%s effective=%v err=%v", relation, state, actor, effective, err)
	}
	lock, err := owner.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer lock.Rollback()
	if _, err = lock.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended('wlt:commercial-proposal:proposal-lock',0))"); err != nil {
		t.Fatal(err)
	}
	blocked := proposal
	blocked.StoreID, blocked.OperationID = "proposal-lock", "proposal-lock-01"
	done := make(chan error, 1)
	go func() {
		_, err := wallet.RecordFinanceAgreementProposal(ctx, executor, identityOrigin, dshOrigin, proposer, blocked)
		done <- err
	}()
	waitForWalletQuery(t, ctx, executor, "pg_advisory_xact_lock")
	executeFixture(t, ctx, dsh, "UPDATE dsh_test_wlt_agreement.stores SET relation='MARKETPLACE' WHERE id='proposal-lock'")
	if err = lock.Commit(); err != nil {
		t.Fatal(err)
	}
	select {
	case err = <-done:
		if !errors.Is(err, wallet.ErrAgreementForbidden) {
			t.Fatalf("expected rollback after DSH relation changed: %v", err)
		}
	case <-ctx.Done():
		t.Fatal("proposal rollback proof timed out")
	}
	var proposals, decisions int
	if err = owner.QueryRowContext(ctx, `SELECT
		(SELECT count(*) FROM wlt.store_commercial_agreement_proposals WHERE store_id IN ('proposal-owner','proposal-lock')),
		(SELECT count(*) FROM wlt.store_commercial_agreement_decisions WHERE store_id IN ('proposal-owner','proposal-lock'))`).Scan(&proposals, &decisions); err != nil ||
		proposals != 2 || decisions != 0 {
		t.Fatalf("proposal/decision counts %d/%d, error %v", proposals, decisions, err)
	}
	t.Log("WLT_PROPOSAL_COMMAND_AUTHORITY_PASS current_identity=true real_dsh=true mutable_relation_rollback=true exact_replay=true no_decision=true")
}
