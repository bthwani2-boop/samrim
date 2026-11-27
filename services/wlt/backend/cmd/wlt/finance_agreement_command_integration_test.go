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
	"slices"
	"testing"
	"time"

	"github.com/bthwani2-boop/samrim/services/wlt/backend/internal/wallet"
)

// Finance may decide only exact consented terms, never activate an agreement.
// Use the real Identity and the isolated durable WLT owner transaction.
func verifyFinanceCommandAuthority(t *testing.T, ctx context.Context, owner, reader, executor, identity, dsh *sql.DB, origin, dshOrigin, merchant, finance, other, proposer, revoked string) {
	t.Helper()
	commandHandler, err := wallet.NewIsolatedAgreementCommandHandler(executor, origin, dshOrigin)
	if err != nil {
		t.Fatal(err)
	}
	commandServer := httptest.NewServer(commandHandler)
	defer commandServer.Close()
	readerHandler, err := wallet.NewIsolatedAgreementCommandHandler(reader, origin, dshOrigin)
	if err != nil {
		t.Fatal(err)
	}
	readerServer := httptest.NewServer(readerHandler)
	defer readerServer.Close()
	reviewHandler, err := wallet.NewHandler(reader, origin, dshOrigin)
	if err != nil {
		t.Fatal(err)
	}
	reviews := httptest.NewServer(reviewHandler)
	defer reviews.Close()
	call := func(serverURL, role, token string, d wallet.AgreementDecision, expected int, state string) {
		t.Helper()
		payload, err := json.Marshal(map[string]any{
			"version": d.Version, "proposalOperationId": d.ProposalOperationID,
			"operationId": d.OperationID, "decision": d.Decision, "reason": d.Reason,
		})
		if err != nil {
			t.Fatal(err)
		}
		request, err := http.NewRequestWithContext(ctx, http.MethodPost,
			serverURL+"/v1/"+role+"/stores/"+d.StoreID+"/commercial-agreement/decisions", bytes.NewReader(payload))
		if err != nil {
			t.Fatal(err)
		}
		request.Header.Set("Authorization", "Bearer "+token)
		request.Header.Set("Content-Type", "application/json")
		response, err := http.DefaultClient.Do(request)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		body, err := io.ReadAll(io.LimitReader(response.Body, 4097))
		if err != nil || response.StatusCode != expected || response.Header.Get("Cache-Control") != "no-store" {
			t.Fatalf("decision HTTP %d want %d: %s %v", response.StatusCode, expected, body, err)
		}
		var result map[string]any
		if err := json.Unmarshal(body, &result); err != nil {
			t.Fatal(err)
		}
		if expected == 200 {
			if len(result) != 5 || result["storeId"] != d.StoreID || result["version"] != float64(d.Version) ||
				result["proposalOperationId"] != d.ProposalOperationID || result["operationId"] != d.OperationID || result["state"] != state {
				t.Fatalf("wrong decision receipt: %s", body)
			}
		} else if len(result) != 1 || result["error"] == nil {
			t.Fatalf("decision denial leaked information: %s", body)
		}
	}
	points := int32(375)
	effective := time.Date(2027, 1, 1, 0, 0, 0, 123000, time.UTC)
	proposal := func(store string) wallet.AgreementProposal {
		return wallet.AgreementProposal{StoreID: store, OperationID: "proposal-" + store,
			FeeModel: "COMMISSION", Collector: "PLATFORM_MANAGED", CommissionBasisPoints: &points,
			FulfillmentModes: []string{"CUSTOMER_PICKUP"}, ProposedEffectiveAt: effective, Reason: "synthetic proposal"}
	}
	assertReview := func(input wallet.AgreementProposal, state string) {
		t.Helper()
		for _, view := range []struct{ audience, bearer string }{{"merchants", merchant}, {"operators", finance}} {
			body := readWallet(t, ctx, reviews.URL, view.bearer,
				"/v1/"+view.audience+"/stores/"+input.StoreID+"/commercial-agreement", http.StatusOK)
			var reply struct {
				StoreID  string `json:"storeId"`
				Proposal *struct {
					Version            int64     `json:"version"`
					OperationID        string    `json:"operationId"`
					Relation           string    `json:"storeRelation"`
					FeeModel           string    `json:"feeModel"`
					Collector          string    `json:"collector"`
					Currency           string    `json:"currency"`
					Commission         *int32    `json:"commissionBasisPoints"`
					SubscriptionAmount *string   `json:"subscriptionAmountYer"`
					SubscriptionPeriod *int32    `json:"subscriptionPeriodDays"`
					FulfillmentModes   []string  `json:"fulfillmentModes"`
					EffectiveAt        time.Time `json:"proposedEffectiveAt"`
					State              string    `json:"reviewState"`
				} `json:"proposal"`
			}
			decoder := json.NewDecoder(bytes.NewReader(body))
			decoder.DisallowUnknownFields()
			err := decoder.Decode(&reply)
			got := reply.Proposal
			if err != nil || reply.StoreID != input.StoreID || got == nil ||
				got.Version != input.ExpectedVersion+1 || got.OperationID != input.OperationID ||
				got.Relation != "DIRECT" || got.FeeModel != input.FeeModel || got.Collector != input.Collector ||
				got.Currency != "YER" || got.Commission == nil || *got.Commission != *input.CommissionBasisPoints ||
				got.SubscriptionAmount != nil || got.SubscriptionPeriod != nil ||
				!slices.Equal(got.FulfillmentModes, input.FulfillmentModes) ||
				!got.EffectiveAt.Equal(input.ProposedEffectiveAt) || got.State != state {
				t.Fatalf("%s review mismatch: %s %v", view.audience, body, err)
			}
		}
	}
	for _, store := range []string{"finance-approve", "finance-reject", "finance-pending", "finance-revoked", "finance-relation", "finance-transfer"} {
		input := proposal(store)
		assertProposalHTTP(t, ctx, commandServer.URL, proposer, input, 200, "RECORDED")
		assertReview(input, "AWAITING_MERCHANT_CONSENT")
		if store != "finance-pending" {
			consent := wallet.AgreementDecision{StoreID: store, Version: 1, ProposalOperationID: "proposal-" + store, OperationID: "consent-" + store, Decision: "ACCEPTED", Reason: "synthetic consent"}
			call(commandServer.URL, "merchants", merchant, consent, 200, "RECORDED")
			call(commandServer.URL, "merchants", merchant, consent, 200, "REPLAYED")
			assertReview(input, "AWAITING_FINANCE_REVIEW")
		}
	}
	decision := func(store, mode string) wallet.AgreementDecision {
		return wallet.AgreementDecision{StoreID: store, Version: 1, ProposalOperationID: "proposal-" + store, OperationID: "review-" + store, Decision: mode, Reason: "synthetic finance review"}
	}
	check := func(db *sql.DB, token string, d wallet.AgreementDecision, want string, wantErr error) {
		t.Helper()
		expected := map[error]int{nil: 200, wallet.ErrAgreementInvalid: 400, wallet.ErrAgreementUnauthorized: 401,
			wallet.ErrAgreementForbidden: 403, wallet.ErrAgreementConflict: 409, wallet.ErrAgreementUnconfirmed: 503}[wantErr]
		serverURL := commandServer.URL
		if db == reader {
			serverURL = readerServer.URL
		}
		call(serverURL, "operators", token, d, expected, want)
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
	assertReview(proposal("finance-approve"), "REVIEW_APPROVED_PENDING_ACTIVATION")
	assertReview(proposal("finance-reject"), "FINANCE_REJECTED")
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
	var allocations int
	if err := owner.QueryRowContext(ctx, "SELECT count(*) FROM wlt.order_payment_allocations WHERE store_id LIKE 'finance-%'").Scan(&allocations); err != nil || allocations != 0 {
		t.Fatalf("unexpected payment allocations %d %v", allocations, err)
	}
	t.Log("WLT_FINANCE_COMMAND_AUTHORITY_PASS http_proposal=true http_consent=true http_finance=true both_owner_reads=true real_identity=true real_dsh=true owner_transfer=true relation_denial=true distinct_authority=true replay=true rollback=true revocation=true no_activation=true no_allocation=true")
}
