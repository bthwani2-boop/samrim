package main

import (
	"context"
	"database/sql"
	"errors"
	"testing"

	"github.com/bthwani2-boop/samrim/services/wlt/backend/internal/wallet"
)

// Finance may decide only exact consented terms, never activate an agreement.
// Use the real Identity and the isolated durable WLT owner transaction.
func verifyFinanceCommandAuthority(t *testing.T, ctx context.Context, owner, reader, executor, identity, dsh *sql.DB, origin, dshOrigin, merchant, finance, other, proposer, revoked string) {
	t.Helper()
	const appendProposal = "SELECT version FROM wlt.append_commercial_agreement_proposal($1,0,$2,'DIRECT','COMMISSION','PLATFORM_MANAGED',375,NULL,NULL,ARRAY['CUSTOMER_PICKUP'],'2027-01-01T00:00:00Z','finance-proposer','synthetic proposal')"
	for _, store := range []string{"finance-approve", "finance-reject", "finance-pending", "finance-revoked", "finance-relation", "finance-transfer"} {
		var version int
		if err := owner.QueryRowContext(ctx, appendProposal, store, "proposal-"+store).Scan(&version); err != nil || version != 1 {
			t.Fatalf("proposal %s %d %v", store, version, err)
		}
		if store != "finance-pending" {
			consent := wallet.AgreementDecision{StoreID: store, Version: 1, ProposalOperationID: "proposal-" + store, OperationID: "consent-" + store, Decision: "ACCEPTED", Reason: "synthetic consent"}
			if state, err := wallet.RecordMerchantAgreementDecision(ctx, executor, origin, dshOrigin, merchant, consent); err != nil || state != "RECORDED" {
				t.Fatalf("consent %s %q %v", store, state, err)
			}
		}
	}
	decision := func(store, mode string) wallet.AgreementDecision {
		return wallet.AgreementDecision{StoreID: store, Version: 1, ProposalOperationID: "proposal-" + store, OperationID: "review-" + store, Decision: mode, Reason: "synthetic finance review"}
	}
	check := func(db *sql.DB, token string, d wallet.AgreementDecision, want string, wantErr error) {
		t.Helper()
		got, err := wallet.RecordFinanceAgreementDecision(ctx, db, origin, dshOrigin, token, d)
		if got != want || !errors.Is(err, wantErr) {
			t.Fatalf("%s: got %q %v want %q %v", d.StoreID, got, err, want, wantErr)
		}
	}
	approve := decision("finance-approve", "FINANCE_APPROVED")
	check(executor, merchant, approve, "", wallet.ErrAgreementForbidden)
	check(executor, other, approve, "", wallet.ErrAgreementForbidden)
	check(executor, "invalid", approve, "", wallet.ErrAgreementUnauthorized)
	check(reader, finance, approve, "", wallet.ErrAgreementUnconfirmed)
	check(executor, finance, decision("finance-approve", "ACCEPTED"), "", wallet.ErrAgreementInvalid)
	check(executor, finance, decision("finance-pending", "FINANCE_APPROVED"), "", wallet.ErrAgreementConflict)
	check(executor, proposer, approve, "", wallet.ErrAgreementConflict)
	check(executor, finance, approve, "RECORDED", nil)
	check(executor, finance, approve, "REPLAYED", nil)
	changed := approve
	changed.Decision = "FINANCE_REJECTED"
	check(executor, finance, changed, "", wallet.ErrAgreementConflict)
	check(executor, finance, decision("finance-reject", "FINANCE_REJECTED"), "RECORDED", nil)
	// Revoke the current Finance grant while the transaction waits at the
	// owner's actual advisory lock, then prove no durable approval escapes.
	lock, err := owner.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer lock.Rollback()
	if _, err = lock.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended('wlt:commercial-proposal:finance-revoked',0))"); err != nil {
		t.Fatal(err)
	}
	type outcome struct {
		state string
		err   error
	}
	results := make(chan outcome, 1)
	go func() {
		state, err := wallet.RecordFinanceAgreementDecision(ctx, executor, origin, dshOrigin, revoked, decision("finance-revoked", "FINANCE_APPROVED"))
		results <- outcome{state, err}
	}()
	waitForWalletQuery(t, ctx, executor, "pg_advisory_xact_lock")
	executeFixture(t, ctx, identity, "UPDATE identity_test_wlt.operator_permissions SET state='REVOKED' WHERE actor_id='finance-command-revoked' AND permission='finance'")
	if err = lock.Commit(); err != nil {
		t.Fatal(err)
	}
	select {
	case got := <-results:
		if got.state != "" || !errors.Is(got.err, wallet.ErrAgreementForbidden) {
			t.Fatalf("revocation outcome: %+v", got)
		}
	case <-ctx.Done():
		t.Fatal("finance revocation proof timed out")
	}
	check(executor, revoked, decision("finance-revoked", "FINANCE_APPROVED"), "", wallet.ErrAgreementForbidden)
	executeFixture(t, ctx, dsh, "UPDATE dsh_test_wlt_agreement.stores SET relation='MARKETPLACE' WHERE id='finance-relation'")
	check(executor, finance, decision("finance-relation", "FINANCE_APPROVED"), "", wallet.ErrAgreementForbidden)
	transferLock, err := owner.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer transferLock.Rollback()
	if _, err = transferLock.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended('wlt:commercial-proposal:finance-transfer',0))"); err != nil {
		t.Fatal(err)
	}
	transfer := make(chan outcome, 1)
	go func() {
		state, err := wallet.RecordFinanceAgreementDecision(ctx, executor, origin, dshOrigin, finance, decision("finance-transfer", "FINANCE_APPROVED"))
		transfer <- outcome{state, err}
	}()
	waitForWalletQuery(t, ctx, executor, "pg_advisory_xact_lock")
	executeFixture(t, ctx, dsh, "UPDATE dsh_test_wlt_agreement.stores SET owner_actor_id='wallet-two' WHERE id='finance-transfer'")
	if err = transferLock.Commit(); err != nil {
		t.Fatal(err)
	}
	select {
	case got := <-transfer:
		if got.state != "" || !errors.Is(got.err, wallet.ErrAgreementForbidden) {
			t.Fatalf("ownership transfer outcome: %+v", got)
		}
	case <-ctx.Done():
		t.Fatal("finance ownership transfer proof timed out")
	}
	var count int
	if err = owner.QueryRowContext(ctx, "SELECT count(*) FROM wlt.store_commercial_agreement_decisions WHERE store_id LIKE 'finance-%' AND stage='FINANCE'").Scan(&count); err != nil || count != 2 {
		t.Fatalf("durable finance decision count %d %v", count, err)
	}
	for store, want := range map[string]string{"finance-approve": "REVIEW_APPROVED_PENDING_ACTIVATION", "finance-reject": "FINANCE_REJECTED", "finance-pending": "AWAITING_MERCHANT_CONSENT", "finance-revoked": "AWAITING_FINANCE_REVIEW"} {
		var state string
		if err = reader.QueryRowContext(ctx, "SELECT review_state FROM wlt.latest_commercial_agreement_reviews WHERE store_id=$1", store).Scan(&state); err != nil || state != want {
			t.Fatalf("%s state=%q want=%q err=%v", store, state, want, err)
		}
	}
	t.Log("WLT_FINANCE_COMMAND_AUTHORITY_PASS real_identity=true real_dsh=true owner_transfer=true relation_denial=true distinct_authority=true consent=true replay=true rollback=true revocation=true no_activation=true")
}
