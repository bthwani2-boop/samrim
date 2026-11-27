package main

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"

	"github.com/bthwani2-boop/samrim/services/wlt/backend/internal/wallet"
)

func verifyProposalCommandAuthority(t *testing.T, ctx context.Context, owner, reader, executor, identity, dsh *sql.DB, identityOrigin, dshOrigin, merchant, proposer, other, revoked string) {
	t.Helper()
	commandHandler, err := wallet.NewIsolatedAgreementCommandHandler(executor, identityOrigin, dshOrigin)
	if err != nil {
		t.Fatal(err)
	}
	commandServer := httptest.NewServer(commandHandler)
	defer commandServer.Close()
	readerHandler, err := wallet.NewIsolatedAgreementCommandHandler(reader, identityOrigin, dshOrigin)
	if err != nil {
		t.Fatal(err)
	}
	readerServer := httptest.NewServer(readerHandler)
	defer readerServer.Close()
	bps := int32(375)
	proposal := wallet.AgreementProposal{
		StoreID: "proposal-owner", OperationID: "proposal-owner-01", FeeModel: "COMMISSION",
		Collector: "PLATFORM_MANAGED", CommissionBasisPoints: &bps,
		FulfillmentModes:    []string{"CUSTOMER_PICKUP"},
		ProposedEffectiveAt: time.Date(2027, 2, 1, 0, 0, 0, 123000, time.UTC), Reason: "synthetic proposal",
	}
	check := func(db *sql.DB, bearer string, input wallet.AgreementProposal, version int64, replay bool, want error) {
		t.Helper()
		document := map[string]any{
			"expectedVersion": input.ExpectedVersion, "operationId": input.OperationID, "feeModel": input.FeeModel,
			"collector": input.Collector, "commissionBasisPoints": input.CommissionBasisPoints, "subscriptionPeriodDays": input.SubscriptionPeriodDays,
			"fulfillmentModes": input.FulfillmentModes, "proposedEffectiveAt": input.ProposedEffectiveAt, "reason": input.Reason,
		}
		if input.SubscriptionAmountYER != nil {
			document["subscriptionAmountYer"] = strconv.FormatInt(*input.SubscriptionAmountYER, 10)
		}
		payload, err := json.Marshal(document)
		if err != nil {
			t.Fatal(err)
		}
		origin := commandServer.URL
		if db == reader {
			origin = readerServer.URL
		}
		request, err := http.NewRequestWithContext(ctx, http.MethodPost,
			origin+"/v1/operators/stores/"+input.StoreID+"/commercial-agreement/proposals", bytes.NewReader(payload))
		if err != nil {
			t.Fatal(err)
		}
		request.Header.Set("Authorization", "Bearer "+bearer)
		request.Header.Set("Content-Type", "application/json")
		response, err := http.DefaultClient.Do(request)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		body, err := io.ReadAll(io.LimitReader(response.Body, 4097))
		code := map[error]int{nil: 200, wallet.ErrAgreementForbidden: 403, wallet.ErrAgreementConflict: 409, wallet.ErrAgreementUnconfirmed: 503}[want]
		if err != nil || response.StatusCode != code || response.Header.Get("Cache-Control") != "no-store" {
			t.Fatalf("proposal HTTP %d want %d: %s %v", response.StatusCode, code, body, err)
		}
		var got map[string]any
		if err := json.Unmarshal(body, &got); err != nil {
			t.Fatal(err)
		}
		if want != nil {
			public := map[error]string{wallet.ErrAgreementForbidden: "FORBIDDEN", wallet.ErrAgreementConflict: "PROPOSAL_CONFLICT",
				wallet.ErrAgreementUnconfirmed: "PROPOSAL_UNCONFIRMED"}[want]
			if len(got) != 1 || got["error"] != public {
				t.Fatalf("incorrect rejection: %s", body)
			}
			return
		}
		state := "RECORDED"
		if replay {
			state = "REPLAYED"
		}
		if len(got) != 4 || got["storeId"] != input.StoreID || got["version"] != float64(version) ||
			got["operationId"] != input.OperationID || got["state"] != state {
			t.Fatalf("incorrect proposal receipt: %s", body)
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
	amount, period := int64(9007199254740993), int32(30)
	changed.FeeModel, changed.CommissionBasisPoints = "SUBSCRIPTION", nil
	changed.SubscriptionAmountYER, changed.SubscriptionPeriodDays = &amount, &period
	check(executor, proposer, changed, 2, false, nil)
	check(executor, proposer, proposal, 1, true, nil)

	var relation, state, actor, amountText string
	var effective time.Time
	if err := owner.QueryRowContext(ctx, `SELECT p.store_relation,s.review_state,p.proposed_by_actor,p.proposed_effective_at,p.subscription_amount_yer::text
		FROM wlt.store_commercial_agreement_proposals p JOIN wlt.commercial_agreement_review_states s USING (store_id,version)
		WHERE p.store_id=$1 AND p.version=2`, proposal.StoreID).Scan(&relation, &state, &actor, &effective, &amountText); err != nil ||
		relation != "DIRECT" || state != "AWAITING_MERCHANT_CONSENT" || actor != "finance-proposer" ||
		!effective.Equal(proposal.ProposedEffectiveAt) || amountText != strconv.FormatInt(amount, 10) {
		t.Fatalf("wrong durable proposal relation=%s state=%s actor=%s effective=%v amount=%s err=%v", relation, state, actor, effective, amountText, err)
	}
	duringStoreWait := func(store string, command func() error, change func()) error {
		t.Helper()
		lock, err := owner.BeginTx(ctx, nil)
		if err != nil {
			t.Fatal(err)
		}
		defer lock.Rollback()
		if _, err = lock.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended('wlt:commercial-proposal:'||$1,0))", store); err != nil {
			t.Fatal(err)
		}
		done := make(chan error, 1)
		go func() { done <- command() }()
		waitForWalletQuery(t, ctx, executor, "pg_advisory_xact_lock")
		change()
		if err = lock.Commit(); err != nil {
			t.Fatal(err)
		}
		select {
		case err = <-done:
			return err
		case <-ctx.Done():
			t.Fatal("command rollback proof timed out")
			return ctx.Err()
		}
	}
	blocked := proposal
	blocked.StoreID, blocked.OperationID = "proposal-lock", "proposal-lock-01"
	err = duringStoreWait(blocked.StoreID, func() error {
		_, err := wallet.RecordFinanceAgreementProposal(ctx, executor, identityOrigin, dshOrigin, proposer, blocked)
		return err
	}, func() {
		executeFixture(t, ctx, dsh, "UPDATE dsh_test_wlt_agreement.stores SET relation='MARKETPLACE' WHERE id='proposal-lock'")
	})
	if !errors.Is(err, wallet.ErrAgreementForbidden) {
		t.Fatalf("expected rollback after DSH relation changed: %v", err)
	}
	missing := wallet.AgreementDecision{StoreID: blocked.StoreID, Version: 1, ProposalOperationID: blocked.OperationID,
		OperationID: "review-missing-01", Decision: "FINANCE_APPROVED", Reason: "synthetic review"}
	err = duringStoreWait(missing.StoreID, func() error {
		_, err := wallet.RecordFinanceAgreementDecision(ctx, executor, identityOrigin, dshOrigin, proposer, missing)
		return err
	}, func() {
		executeFixture(t, ctx, identity, "UPDATE identity_test_wlt.operator_permissions SET state='REVOKED' WHERE actor_id='finance-proposer' AND permission='finance'")
	})
	if !errors.Is(err, wallet.ErrAgreementForbidden) {
		t.Fatalf("expected permission denial instead of disclosing the agreement conflict: %v", err)
	}
	var proposals, decisions int
	if err = owner.QueryRowContext(ctx, `SELECT
		(SELECT count(*) FROM wlt.store_commercial_agreement_proposals WHERE store_id IN ('proposal-owner','proposal-lock')),
		(SELECT count(*) FROM wlt.store_commercial_agreement_decisions WHERE store_id IN ('proposal-owner','proposal-lock'))`).Scan(&proposals, &decisions); err != nil ||
		proposals != 2 || decisions != 0 {
		t.Fatalf("proposal/decision counts %d/%d, error %v", proposals, decisions, err)
	}
	t.Log("WLT_PROPOSAL_COMMAND_AUTHORITY_PASS real_http=true current_identity=true real_dsh=true mutable_relation_rollback=true conflict_disclosure_denied=true exact_replay=true exact_yer=true no_decision=true")
}
