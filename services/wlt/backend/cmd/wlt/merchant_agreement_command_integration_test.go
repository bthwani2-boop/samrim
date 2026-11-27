package main

import (
	"context"
	"database/sql"
	"errors"
	"net"
	"net/http"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/bthwani2-boop/samrim/services/wlt/backend/internal/wallet"
)

// The WLT CI stage supplies a second, fresh disposable owner database and the
// actual DSH executable already built by the native owner integration runner.
// No shared development databases, mock standing or alternate business writer.
func startAgreementDSH(t *testing.T, ctx context.Context, root, identityOrigin, merchant string) (*sql.DB, string) {
	t.Helper()
	const schema = "dsh_test_wlt_agreement"
	const role = "bthwani_wlt_dsh_fixture"
	const database = "bthwani_refoundation"
	db := openTestDB(t, "postgres://"+role+":synthetic-only@127.0.0.1:5432/"+database+"?sslmode=disable")
	var admitted bool
	if err := db.QueryRowContext(ctx, `SELECT current_database()=$1 AND current_user=$2 AND session_user=current_user
 AND EXISTS (SELECT 1 FROM pg_catalog.pg_database WHERE datname=current_database() AND pg_get_userbyid(datdba)=current_user)
 AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname=$3)`, database, role, schema).Scan(&admitted); err != nil || !admitted {
		t.Fatalf("fresh isolated DSH fixture admission denied: %v", err)
	}
	binary := filepath.Join(root, "bin", "dsh")
	dir := filepath.Join(root, "services", "dsh")
	env := []string{"BTHWANI_ISOLATED_TEST_MODE=true", "DSH_DB_HOST=127.0.0.1", "DSH_DB_SCHEMA=" + schema,
		"REF_POSTGRES_DB=" + database, "REF_POSTGRES_USER=" + role, "REF_POSTGRES_PASSWORD=synthetic-only"}
	bootstrap := exec.CommandContext(ctx, binary, "-mode=bootstrap")
	bootstrap.Dir = dir
	bootstrap.Env = env
	if out, err := bootstrap.CombinedOutput(); err != nil {
		t.Fatalf("DSH fresh owner bootstrap: %v %s", err, out)
	}
	executeFixture(t, ctx, db, "INSERT INTO "+schema+".service_cities(id,active,timezone_name) VALUES('command-city',true,'Asia/Aden')")
	executeFixture(t, ctx, db, "INSERT INTO "+schema+".verticals(id,active) VALUES('grocery',true) ON CONFLICT(id) DO NOTHING")
	for _, store := range []string{"command-store", "command-rollback", "command-grant", "command-relation", "command-concurrent", "command-decline"} {
		executeFixture(t, ctx, db, "INSERT INTO "+schema+".stores(id,owner_actor_id,city_id,vertical_id,relation,name,published) VALUES($1,'wallet-one','command-city','grocery','DIRECT','Synthetic',false)", store)
	}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	addr := listener.Addr().String()
	_ = listener.Close()
	cmd := exec.CommandContext(ctx, binary)
	cmd.Dir = dir
	cmd.Env = append(env, "DSH_LISTEN_ADDR="+addr, "DSH_ENABLE_ISOLATED_STORE_AVAILABILITY=true", "DSH_IDENTITY_VERIFIER_URL="+identityOrigin)
	if err = cmd.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = cmd.Process.Kill(); _ = cmd.Wait() })
	origin := "http://" + addr
	client := &http.Client{Timeout: 150 * time.Millisecond}
	for range 50 {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, origin+"/v1/stores/mine", nil)
		if err != nil {
			t.Fatal(err)
		}
		req.Header.Set("Authorization", "Bearer "+merchant)
		res, err := client.Do(req)
		if err == nil {
			_ = res.Body.Close()
			if res.StatusCode == 200 {
				return db, origin
			}
		}
		time.Sleep(40 * time.Millisecond)
	}
	t.Fatal("actual isolated DSH owner failed readiness")
	return nil, ""
}

func verifyMerchantCommandAuthority(t *testing.T, ctx context.Context, owner, reader, executor *sql.DB, root, origin, merchant, customer string) {
	t.Helper()
	dsh, dshOrigin := startAgreementDSH(t, ctx, root, origin, merchant)
	const appendProposal = "SELECT version FROM wlt.append_commercial_agreement_proposal($1,0,$2,'DIRECT','COMMISSION','PLATFORM_MANAGED',375,NULL,NULL,ARRAY['CUSTOMER_PICKUP'],'2027-01-01T00:00:00Z','fixture-proposer','synthetic proposal')"
	for _, store := range []string{"command-store", "command-rollback", "command-grant", "command-relation", "command-concurrent", "command-decline"} {
		var version int
		if err := owner.QueryRowContext(ctx, appendProposal, store, "proposal-"+store).Scan(&version); err != nil || version != 1 {
			t.Fatalf("proposal %s %d %v", store, version, err)
		}
	}
	decision := func(store string) wallet.MerchantDecision {
		return wallet.MerchantDecision{StoreID: store, Version: 1, ProposalOperationID: "proposal-" + store, OperationID: "decision-" + store, Decision: "ACCEPTED", Reason: "synthetic consent"}
	}
	run := func(db *sql.DB, token string, d wallet.MerchantDecision) (string, error) {
		return wallet.RecordMerchantAgreementDecision(ctx, db, origin, dshOrigin, token, d)
	}
	assert := func(db *sql.DB, token string, d wallet.MerchantDecision, want string, wantErr error) {
		t.Helper()
		got, err := run(db, token, d)
		if got != want || !errors.Is(err, wantErr) {
			t.Fatalf("%s got %q %v want %q %v", d.StoreID, got, err, want, wantErr)
		}
	}
	assert(executor, customer, decision("command-store"), "", wallet.ErrAgreementForbidden)
	assert(executor, "invalid", decision("command-store"), "", wallet.ErrAgreementUnauthorized)
	assert(reader, merchant, decision("command-store"), "", wallet.ErrAgreementUnconfirmed)
	assert(owner, merchant, decision("command-store"), "", wallet.ErrAgreementUnconfirmed)
	assert(executor, merchant, decision("command-store"), "RECORDED", nil)
	assert(executor, merchant, decision("command-store"), "REPLAYED", nil)
	conflicting := decision("command-store")
	conflicting.Decision = "DECLINED"
	assert(executor, merchant, conflicting, "", wallet.ErrAgreementConflict)
	// A real DSH ownership transfer occurs AFTER initial HTTP admission while
	// the WLT command waits on the actual owner serialization lock.
	lock, err := owner.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer lock.Rollback()
	if _, err = lock.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended('wlt:commercial-proposal:command-rollback',0))"); err != nil {
		t.Fatal(err)
	}
	type outcome struct {
		state string
		err   error
	}
	result := make(chan outcome, 1)
	go func() {
		state, err := run(executor, merchant, decision("command-rollback"))
		result <- outcome{state, err}
	}()
	waitForWalletQuery(t, ctx, executor, "pg_advisory_xact_lock")
	executeFixture(t, ctx, dsh, "UPDATE dsh_test_wlt_agreement.stores SET owner_actor_id='wallet-two' WHERE id='command-rollback'")
	if err = lock.Commit(); err != nil {
		t.Fatal(err)
	}
	select {
	case got := <-result:
		if got.state != "" || !errors.Is(got.err, wallet.ErrAgreementForbidden) {
			t.Fatalf("transferred Store decision: %+v", got)
		}
	case <-ctx.Done():
		t.Fatal("ownership transfer proof timed out")
	}
	assert(executor, merchant, decision("command-rollback"), "", wallet.ErrAgreementForbidden)
	executeFixture(t, ctx, dsh, "UPDATE dsh_test_wlt_agreement.stores SET relation='MARKETPLACE' WHERE id='command-relation'")
	assert(executor, merchant, decision("command-relation"), "", wallet.ErrAgreementForbidden)
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
	executeFixture(t, ctx, dsh, "UPDATE dsh_test_wlt_agreement.stores SET owner_actor_id='wallet-one' WHERE id='command-rollback'")
	assert(executor, merchant, decision("command-rollback"), "RECORDED", nil)
	assert(executor, merchant, decision("command-grant"), "RECORDED", nil)
	decline := decision("command-decline")
	decline.Decision = "DECLINED"
	assert(executor, merchant, decline, "RECORDED", nil)
	assert(executor, merchant, decline, "REPLAYED", nil)
	concurrent := make(chan outcome, 2)
	for range 2 {
		go func() {
			state, err := run(executor, merchant, decision("command-concurrent"))
			concurrent <- outcome{state, err}
		}()
	}
	states := map[string]int{}
	for range 2 {
		select {
		case got := <-concurrent:
			if got.err != nil {
				t.Fatal(got.err)
			}
			states[got.state]++
		case <-ctx.Done():
			t.Fatal("concurrent decision proof timed out")
		}
	}
	if states["RECORDED"] != 1 || states["REPLAYED"] != 1 {
		t.Fatalf("unexpected concurrent results %v", states)
	}
	if err := owner.QueryRowContext(ctx, "SELECT count(*) FROM wlt.store_commercial_agreement_decisions WHERE store_id LIKE 'command-%'").Scan(&count); err != nil || count != 5 {
		t.Fatalf("durable exact decision count %d %v", count, err)
	}
	t.Log("WLT_MERCHANT_COMMAND_AUTHORITY_PASS real_dsh=true current_identity=true ownership_recheck=true rollback=true replay=true acl_denial=true concurrent=true decline=true")
}
