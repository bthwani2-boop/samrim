package main

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	"github.com/bthwani2-boop/samrim/services/wlt/backend/internal/wallet"
)

func verifyMerchantCommandAuthority(t *testing.T, ctx context.Context, owner, reader, executor *sql.DB, origin, merchant, customer string) {
	t.Helper()
	const appendProposal = "SELECT version FROM wlt.append_commercial_agreement_proposal($1,0,$2,'DIRECT','COMMISSION','PLATFORM_MANAGED',375,NULL,NULL,ARRAY['CUSTOMER_PICKUP'],'2027-01-01T00:00:00Z','fixture-proposer','synthetic proposal')"
	for _, store := range []string{"command-store", "command-rollback", "command-grant", "command-relation"} {
		var version int
		if err := owner.QueryRowContext(ctx, appendProposal, store, "proposal-"+store).Scan(&version); err != nil || version != 1 {
			t.Fatalf("proposal %s %d %v", store, version, err)
		}
	}
	var calls atomic.Int32
	var revokeOnSecond atomic.Bool
	var wrongRelation atomic.Bool
	dsh := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/stores/mine" || r.Header.Get("Authorization") != "Bearer "+merchant {
			w.WriteHeader(403)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		n := calls.Add(1)
		if revokeOnSecond.Load() && n == 2 {
			fmt.Fprint(w, `{"actorId":"wallet-one","stores":[]}`)
			return
		}
		relation := "DIRECT"
		if wrongRelation.Load() {
			relation = "MARKETPLACE"
		}
		fmt.Fprintf(w, `{"actorId":"wallet-one","stores":[{"id":"command-store","name":"Synthetic","relation":%q,"published":true},{"id":"command-rollback","name":"Synthetic","relation":%q,"published":true},{"id":"command-grant","name":"Synthetic","relation":%q,"published":true},{"id":"command-relation","name":"Synthetic","relation":%q,"published":true}]}`, relation, relation, relation, relation)
	}))
	defer dsh.Close()
	decision := func(store string) wallet.MerchantDecision {
		return wallet.MerchantDecision{StoreID: store, Version: 1, ProposalOperationID: "proposal-" + store, OperationID: "decision-" + store, Decision: "ACCEPTED", Reason: "synthetic consent"}
	}
	assert := func(db *sql.DB, token string, d wallet.MerchantDecision, want string, wantErr error) {
		t.Helper()
		got, err := wallet.RecordMerchantAgreementDecision(ctx, db, origin, dsh.URL, token, d)
		if got != want || !errors.Is(err, wantErr) {
			t.Fatalf("%s got %q %v want %q %v", d.StoreID, got, err, want, wantErr)
		}
	}
	assert(executor, customer, decision("command-store"), "", wallet.ErrAgreementForbidden)
	assert(reader, merchant, decision("command-store"), "", wallet.ErrAgreementUnconfirmed)
	assert(owner, merchant, decision("command-store"), "", wallet.ErrAgreementUnconfirmed)
	assert(executor, merchant, decision("command-store"), "RECORDED", nil)
	assert(executor, merchant, decision("command-store"), "REPLAYED", nil)
	conflicting := decision("command-store")
	conflicting.Decision = "DECLINED"
	assert(executor, merchant, conflicting, "", wallet.ErrAgreementConflict)
	calls.Store(0)
	revokeOnSecond.Store(true)
	assert(executor, merchant, decision("command-rollback"), "", wallet.ErrAgreementForbidden)
	revokeOnSecond.Store(false)
	wrongRelation.Store(true)
	assert(executor, merchant, decision("command-relation"), "", wallet.ErrAgreementForbidden)
	wrongRelation.Store(false)
	executeFixture(t, ctx, owner, "GRANT SELECT (decision) ON wlt.store_commercial_agreement_decisions TO bthwani_wlt_command")
	assert(executor, merchant, decision("command-grant"), "", wallet.ErrAgreementUnconfirmed)
	executeFixture(t, ctx, owner, "REVOKE SELECT (decision) ON wlt.store_commercial_agreement_decisions FROM bthwani_wlt_command")
	var count int
	if err := owner.QueryRowContext(ctx, "SELECT count(*) FROM wlt.store_commercial_agreement_decisions WHERE store_id LIKE 'command-%'").Scan(&count); err != nil || count != 1 {
		t.Fatalf("unauthorized durable writes %d %v", count, err)
	}
	var actor string
	if err := owner.QueryRowContext(ctx, "SELECT actor_id FROM wlt.store_commercial_agreement_decisions WHERE store_id='command-store'").Scan(&actor); err != nil || actor != "wallet-one" {
		t.Fatalf("wrong actor %q %v", actor, err)
	}
	assert(executor, merchant, decision("command-rollback"), "RECORDED", nil)
	assert(executor, merchant, decision("command-grant"), "RECORDED", nil)
	t.Log("WLT_MERCHANT_COMMAND_AUTHORITY_PASS current_identity=true ownership_recheck=true rollback=true replay=true acl_denial=true")
}
