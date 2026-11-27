package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/bthwani2-boop/samrim/services/wlt/backend/internal/wallet"
	"github.com/lib/pq"
)

func TestWalletOwnerPostgresAndIdentity(t *testing.T) {
	if os.Getenv("BTHWANI_ISOLATED_TEST_MODE") != "true" || os.Getenv("WLT_OWNER_CI_TEST") != "true" {
		t.Skip("NOT_RUN: requires the disposable WLT PostgreSQL owner stage")
	}
	port := os.Getenv("WLT_OWNER_TEST_POSTGRES_PORT")
	if port == "" {
		port = "5432"
	}
	if !validPort(port) {
		t.Fatal("invalid disposable PostgreSQL port")
	}
	fixtureRoot := os.Getenv("WLT_OWNER_TEST_FIXTURE_DIR")
	if fixtureRoot == "" {
		fixtureRoot = "/agent02"
	}
	network := "@127.0.0.1:" + port + "/bthwani_wlt_test?sslmode=disable"
	readerDSN := "postgres://bthwani_wlt_reader:synthetic-only" + network
	identityDSN := "postgres://bthwani_identity_fixture:synthetic-only" + network
	sandboxDSN := "postgres://bthwani_wlt_sandbox:synthetic-only" + network
	wltRoot := filepath.Join(fixtureRoot, "services", "wlt", "database")
	owner := openTestDB(t, "postgres://bthwani_wlt_owner:synthetic-only"+network)
	reader := openTestDB(t, readerDSN)
	executor := openTestDB(t, "postgres://bthwani_wlt_command:synthetic-only"+network)
	identity := openTestDB(t, identityDSN)
	ctx, cancel := context.WithTimeout(t.Context(), 30*time.Second)
	defer cancel()
	apply := func(dir, name string) {
		t.Helper()
		source, err := os.ReadFile(filepath.Join(wltRoot, dir, name))
		if err != nil {
			t.Fatal(err)
		}
		executeFixture(t, ctx, owner, string(source))
	}
	apply("schema", "00_ledger.sql")
	if err := checkDatabase(ctx, reader); err == nil {
		t.Fatal("current runtime accepted a ledger without reader projections")
	}
	apply("schema", "10_projections.sql")
	apply("schema", "20_permissions.sql")
	apply("schema", "30_commercial_agreements.sql")
	apply("schema", "40_order_wallet_reservations.sql")
	t.Run("commercial agreement proposals", func(t *testing.T) {
		verifyCommercialAgreementProposals(t, ctx, owner, reader, executor)
		verifyAgreementDecisions(t, ctx, owner, reader, executor)
	})
	// Post only from the isolated fixture owner; the HTTP runtime stays read-only.
	// Preserve this exact posting while installing the separate sandbox.
	const post = `INSERT INTO wlt.customer_funding_journal
		(funding_id,actor_id,provider_id,provider_reference,amount_yer,currency)
		VALUES ($1,$2,'synthetic',$3,$4,$5)`
	executeFixture(t, ctx, owner, post, "funding-0001", "wallet-one", "synthetic-a", int64(9007199254740993), "YER")
	var baselineBalance string
	err := reader.QueryRowContext(ctx,
		"SELECT balance_yer::text FROM wlt.customer_wallet_balances WHERE actor_id = $1", "wallet-one").Scan(&baselineBalance)
	if err != nil || baselineBalance != "9007199254740993" {
		t.Fatalf("fresh Customer balance=%q err=%v", baselineBalance, err)
	}
	apply("sandbox", "10_test_funding.sql")
	if err := checkDatabase(ctx, reader); err == nil {
		t.Fatal("current runtime accepted a database without sandbox reversal support")
	}
	apply("sandbox", "20_test_reversal.sql")
	if err := checkDatabase(ctx, reader); err != nil {
		t.Fatal(err)
	}
	if err := checkDatabase(ctx, owner); err == nil {
		t.Fatal("runtime accepted the migration identity")
	}
	for _, privilege := range []struct {
		name, grant, revoke string
	}{
		{"agreement review projection write",
			"GRANT UPDATE (review_state) ON wlt.latest_commercial_agreement_reviews TO bthwani_wlt_reader",
			"REVOKE UPDATE (review_state) ON wlt.latest_commercial_agreement_reviews FROM bthwani_wlt_reader"},
		{"private agreement decision read",
			"GRANT SELECT (decision) ON wlt.store_commercial_agreement_decisions TO bthwani_wlt_reader",
			"REVOKE SELECT (decision) ON wlt.store_commercial_agreement_decisions FROM bthwani_wlt_reader"},
		{"private agreement review state read",
			"GRANT SELECT ON wlt.commercial_agreement_review_states TO bthwani_wlt_reader",
			"REVOKE SELECT ON wlt.commercial_agreement_review_states FROM bthwani_wlt_reader"},
		{"agreement decision execution",
			"GRANT EXECUTE ON FUNCTION wlt.record_commercial_agreement_decision(text,bigint,text,text,text,text,text) TO bthwani_wlt_reader",
			"REVOKE EXECUTE ON FUNCTION wlt.record_commercial_agreement_decision(text,bigint,text,text,text,text,text) FROM bthwani_wlt_reader"},
		{"wallet availability write",
			"GRANT UPDATE (available_yer) ON wlt.customer_wallet_availability TO bthwani_wlt_reader",
			"REVOKE UPDATE (available_yer) ON wlt.customer_wallet_availability FROM bthwani_wlt_reader"},
		{"allocation projection write",
			"GRANT UPDATE (wallet_yer) ON wlt.customer_order_payment_readback TO bthwani_wlt_reader",
			"REVOKE UPDATE (wallet_yer) ON wlt.customer_order_payment_readback FROM bthwani_wlt_reader"},
		{"private reservation read",
			"GRANT SELECT (wallet_yer) ON wlt.order_payment_allocations TO bthwani_wlt_reader",
			"REVOKE SELECT (wallet_yer) ON wlt.order_payment_allocations FROM bthwani_wlt_reader"},
		{"reservation execution",
			"GRANT EXECUTE ON FUNCTION wlt.allocate_order_payment(text,text,text,text,text,bigint,bigint) TO bthwani_wlt_reader",
			"REVOKE EXECUTE ON FUNCTION wlt.allocate_order_payment(text,text,text,text,text,bigint,bigint) FROM bthwani_wlt_reader"},
		{"release execution",
			"GRANT EXECUTE ON FUNCTION wlt.release_order_payment(text,text,text,text) TO bthwani_wlt_reader",
			"REVOKE EXECUTE ON FUNCTION wlt.release_order_payment(text,text,text,text) FROM bthwani_wlt_reader"},
		{"private commercial proposal column read",
			"GRANT SELECT (commission_basis_points) ON wlt.store_commercial_agreement_proposals TO bthwani_wlt_reader",
			"REVOKE SELECT (commission_basis_points) ON wlt.store_commercial_agreement_proposals FROM bthwani_wlt_reader"},
		{"commercial proposal execution",
			"GRANT EXECUTE ON FUNCTION wlt.append_commercial_agreement_proposal(text,bigint,text,text,text,text,integer,bigint,integer,text[],timestamptz,text,text) TO bthwani_wlt_reader",
			"REVOKE EXECUTE ON FUNCTION wlt.append_commercial_agreement_proposal(text,bigint,text,text,text,text,integer,bigint,integer,text[],timestamptz,text,text) FROM bthwani_wlt_reader"},
		{"private journal column read",
			"GRANT SELECT (provider_reference) ON wlt.customer_funding_journal TO bthwani_wlt_reader",
			"REVOKE SELECT (provider_reference) ON wlt.customer_funding_journal FROM bthwani_wlt_reader"},
		{"funding history write",
			"GRANT INSERT (amount_yer) ON wlt.customer_funding_history TO bthwani_wlt_reader",
			"REVOKE INSERT (amount_yer) ON wlt.customer_funding_history FROM bthwani_wlt_reader"},
		{"WLT schema creation",
			"GRANT CREATE ON SCHEMA wlt TO bthwani_wlt_reader",
			"REVOKE CREATE ON SCHEMA wlt FROM bthwani_wlt_reader"},
		{"sandbox reversal execution",
			"GRANT EXECUTE ON FUNCTION wlt.reverse_sandbox_customer_funding(text, text) TO bthwani_wlt_reader",
			"REVOKE EXECUTE ON FUNCTION wlt.reverse_sandbox_customer_funding(text, text) FROM bthwani_wlt_reader"},
	} {
		t.Run(privilege.name, func(t *testing.T) {
			executeFixture(t, ctx, owner, privilege.grant)
			defer executeFixture(t, ctx, owner, privilege.revoke)
			if err := checkDatabase(ctx, reader); err == nil {
				t.Fatal("runtime accepted a reader with excess privileges")
			}
		})
	}
	if err := checkDatabase(ctx, reader); err != nil {
		t.Fatal(err)
	}

	// A named-object allowlist must not silently admit a new view, command or
	// sequence. Use real PostgreSQL grants in this disposable test only.
	t.Run("complete reader catalog admission", func(t *testing.T) {
		for _, object := range []struct {
			name, create, grant, revoke, drop string
		}{
			{"unexpected projection", "CREATE VIEW wlt.admission_test_projection AS SELECT 1 AS value",
				"GRANT SELECT ON wlt.admission_test_projection TO bthwani_wlt_reader",
				"REVOKE SELECT ON wlt.admission_test_projection FROM bthwani_wlt_reader",
				"DROP VIEW wlt.admission_test_projection"},
			{"unexpected column projection", "CREATE TABLE wlt.admission_test_private(value integer)",
				"GRANT SELECT (value) ON wlt.admission_test_private TO bthwani_wlt_reader",
				"REVOKE SELECT (value) ON wlt.admission_test_private FROM bthwani_wlt_reader",
				"DROP TABLE wlt.admission_test_private"},
			{"unexpected command", "CREATE FUNCTION wlt.admission_test_command() RETURNS integer LANGUAGE SQL AS 'SELECT 1'; REVOKE ALL ON FUNCTION wlt.admission_test_command() FROM PUBLIC",
				"GRANT EXECUTE ON FUNCTION wlt.admission_test_command() TO bthwani_wlt_reader",
				"REVOKE EXECUTE ON FUNCTION wlt.admission_test_command() FROM bthwani_wlt_reader",
				"DROP FUNCTION wlt.admission_test_command()"},
			{"unexpected sequence", "CREATE SEQUENCE wlt.admission_test_sequence",
				"GRANT USAGE ON SEQUENCE wlt.admission_test_sequence TO bthwani_wlt_reader",
				"REVOKE USAGE ON SEQUENCE wlt.admission_test_sequence FROM bthwani_wlt_reader",
				"DROP SEQUENCE wlt.admission_test_sequence"},
		} {
			t.Run(object.name, func(t *testing.T) {
				executeFixture(t, ctx, owner, object.create)
				defer executeFixture(t, ctx, owner, object.drop)
				if err := checkDatabase(ctx, reader); err != nil {
					t.Fatal("ungranted owner object incorrectly refused", err)
				}
				executeFixture(t, ctx, owner, object.grant)
				if err := checkDatabase(ctx, reader); err == nil {
					t.Error("unexpected catalog object admitted")
				}
				executeFixture(t, ctx, owner, object.revoke)
				if err := checkDatabase(ctx, reader); err != nil {
					t.Fatal("revoked grant did not restore admission", err)
				}
			})
		}
		executeFixture(t, ctx, owner, "GRANT TEMP ON DATABASE bthwani_wlt_test TO bthwani_wlt_reader")
		if err := checkDatabase(ctx, reader); err == nil {
			t.Error("temporary-object creation admitted")
		}
		executeFixture(t, ctx, owner, "REVOKE TEMP ON DATABASE bthwani_wlt_test FROM bthwani_wlt_reader")
		executeFixture(t, ctx, owner, "ALTER VIEW wlt.commercial_agreement_review_states RENAME TO admission_test_missing_state")
		if err := checkDatabase(ctx, reader); err == nil {
			t.Error("missing required owner projection admitted")
		}
		executeFixture(t, ctx, owner, "ALTER VIEW wlt.admission_test_missing_state RENAME TO commercial_agreement_review_states")
		if err := checkDatabase(ctx, reader); err != nil {
			t.Fatal("restored owner baseline refused", err)
		}
		t.Log("WLT_READER_CATALOG_ADMISSION_PASS")
	})

	const identitySchema = "identity_test_wlt"
	for _, name := range []string{"00_identity.sql", "10_verification.sql", "20_sessions.sql", "30_operator_permissions.sql", "40_operator_passkeys.sql"} {
		source, err := os.ReadFile(filepath.Join(fixtureRoot, "services", "identity", "database", "schema", name))
		if err != nil {
			t.Fatal(err)
		}
		executeFixture(t, ctx, identity, strings.ReplaceAll(string(source), "__SCHEMA__", identitySchema))
	}
	executeFixture(t, ctx, identity, `INSERT INTO identity_test_wlt.actors(id,status)
		VALUES ('wallet-one','ACTIVE'),('wallet-two','ACTIVE'),('wallet-empty','ACTIVE')`)
	executeFixture(t, ctx, identity, `INSERT INTO identity_test_wlt.actor_roles(actor_id,role,status)
		VALUES ('wallet-one','customer','ACTIVE'),('wallet-two','customer','ACTIVE'),
		('wallet-empty','customer','ACTIVE'),('wallet-one','merchant','ACTIVE')`)
	session := func(actor, role string, marker byte) string {
		opaque := bytes.Repeat([]byte{marker}, 32)
		digest := sha256.Sum256(opaque)
		executeFixture(t, ctx, identity, `INSERT INTO identity_test_wlt.auth_sessions
			(token_digest,actor_id,role,actor_version,role_version,expires_at) VALUES ($1,$2,$3,1,1,$4)`,
			digest[:], actor, role, time.Now().Add(time.Hour))
		return base64.RawURLEncoding.EncodeToString(opaque)
	}
	one, two := session("wallet-one", "customer", 1), session("wallet-two", "customer", 2)
	empty, merchant := session("wallet-empty", "customer", 3), session("wallet-one", "merchant", 4)

	// Add postings after sandbox setup and verify they coexist with the original one.
	executeFixture(t, ctx, owner, post, "funding-0002", "wallet-two", "synthetic-b", int64(41), "YER")
	t.Run("order wallet reservations", func(t *testing.T) { verifyOrderFundingReservations(t, ctx, owner, reader) })
	const attempts = 8
	results := make(chan error, attempts)
	var contenders sync.WaitGroup
	for range attempts {
		contenders.Go(func() {
			_, err := owner.ExecContext(ctx, post, "funding-0003", "wallet-one", "synthetic-c", int64(57), "YER")
			results <- err
		})
	}
	contenders.Wait()
	close(results)
	winners := 0
	for err := range results {
		if err == nil {
			winners++
		} else {
			assertSQLState(t, err, "23505")
		}
	}
	if winners != 1 {
		t.Fatalf("duplicate postings committed: %d", winners)
	}
	_, err = owner.ExecContext(ctx, post, "funding-0004", "wallet-two", "synthetic-c", int64(99), "YER")
	assertSQLState(t, err, "23505")
	_, err = owner.ExecContext(ctx, post, "funding-0004", "wallet-two", "synthetic-d", int64(99), "USD")
	assertSQLState(t, err, "23514")
	// A different actor cannot reuse a posted provider reference or funding ID.
	_, err = owner.ExecContext(ctx, post, "funding-0001", "wallet-two", "synthetic-d", int64(99), "YER")
	assertSQLState(t, err, "23505")
	for _, amount := range []int64{0, -1} {
		_, err = owner.ExecContext(ctx, post, "funding-0004", "wallet-two", "synthetic-d", amount, "YER")
		assertSQLState(t, err, "23514")
	}
	_, err = owner.ExecContext(ctx, "DELETE FROM wlt.customer_funding_journal WHERE funding_id = 'funding-0001'")
	assertSQLState(t, err, "23514")
	_, err = owner.ExecContext(ctx, "UPDATE wlt.customer_funding_journal SET amount_yer = 1")
	assertSQLState(t, err, "23514")
	_, err = owner.ExecContext(ctx, "TRUNCATE wlt.customer_funding_journal")
	assertSQLState(t, err, "23514")
	_, err = reader.ExecContext(ctx, post, "funding-0004", "wallet-two", "synthetic-d", int64(99), "YER")
	assertSQLState(t, err, "42501")
	_, err = reader.ExecContext(ctx, "SELECT provider_reference FROM wlt.customer_funding_journal")
	assertSQLState(t, err, "42501")
	var journalCount, unbalanced int
	if err = owner.QueryRowContext(ctx, `SELECT count(*), count(*) FILTER (WHERE legs <> 2 OR net <> 0)
		FROM (SELECT funding_id, count(*) AS legs,
		sum(CASE side WHEN 'debit' THEN amount_yer ELSE -amount_yer END) AS net
		FROM wlt.customer_funding_entries GROUP BY funding_id) grouping`).Scan(&journalCount, &unbalanced); err != nil ||
		journalCount != 3 || unbalanced != 0 {
		t.Fatalf("journal count=%d unbalanced=%d err=%v", journalCount, unbalanced, err)
	}
	origin := startIdentity(t, ctx, filepath.Join(fixtureRoot, "bin", "identity"), identityDSN, identitySchema)
	dshDB, dshOrigin := startAgreementDSH(t, ctx, fixtureRoot, origin, merchant)
	t.Run("Merchant agreement command authority", func(t *testing.T) {
		verifyMerchantCommandAuthority(t, ctx, owner, reader, executor, dshDB, dshOrigin, origin, merchant, one)
	})
	t.Run("Finance agreement command authority", func(t *testing.T) {
		executeFixture(t, ctx, identity, "INSERT INTO identity_test_wlt.actors(id,status) VALUES ('finance-command','ACTIVE'),('finance-command-other','ACTIVE'),('finance-proposer','ACTIVE'),('finance-command-revoked','ACTIVE')")
		executeFixture(t, ctx, identity, "INSERT INTO identity_test_wlt.actor_roles(actor_id,role,status) VALUES ('finance-command','operator','ACTIVE'),('finance-command-other','operator','ACTIVE'),('finance-proposer','operator','ACTIVE'),('finance-command-revoked','operator','ACTIVE')")
		executeFixture(t, ctx, identity, "INSERT INTO identity_test_wlt.operator_permissions(actor_id,permission) VALUES ('finance-command','finance'),('finance-proposer','finance'),('finance-command-revoked','finance')")
		verifyFinanceCommandAuthority(t, ctx, owner, reader, executor, identity, dshDB, origin, dshOrigin, merchant, session("finance-command", "operator", 21), session("finance-command-other", "operator", 22), session("finance-proposer", "operator", 23), session("finance-command-revoked", "operator", 24))
	})
	handler, err := wallet.NewHandler(reader, origin)
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(handler)
	defer server.Close()
	t.Run("allocation readback is actor scoped", func(t *testing.T) {
		const base = "/v1/wallets/me/order-payment-allocations/"
		body := readWallet(t, ctx, server.URL, one, base+"checkout-exact-big", 200)
		var actual struct {
			ActorID    string `json:"actorId"`
			CheckoutID string `json:"checkoutId"`
			Allocation *struct {
				State    string `json:"state"`
				Method   string `json:"method"`
				Total    string `json:"totalYer"`
				Wallet   string `json:"walletYer"`
				Cash     string `json:"cashYer"`
				StoreID  string `json:"storeId"`
				Currency string `json:"currency"`
			} `json:"allocation"`
		}
		if err := json.Unmarshal(body, &actual); err != nil || actual.ActorID != "wallet-one" || actual.CheckoutID != "checkout-exact-big" ||
			actual.Allocation == nil || actual.Allocation.State != "RELEASED" || actual.Allocation.Method != "WALLET" ||
			actual.Allocation.Total != "9007199254740993" || actual.Allocation.Wallet != "9007199254740993" ||
			actual.Allocation.Cash != "0" || actual.Allocation.StoreID != "store-a" || actual.Allocation.Currency != "YER" {
			t.Fatalf("wrong durable allocation: %s %v", body, err)
		}
		for _, key := range []string{"checkout-exact-big", "checkout-not-found"} {
			body = readWallet(t, ctx, server.URL, two, base+key, 200)
			if err := json.Unmarshal(body, &actual); err != nil || actual.ActorID != "wallet-two" || actual.CheckoutID != key || actual.Allocation != nil {
				t.Fatalf("cross-actor or missing read leaked: %s %v", body, err)
			}
		}
		readWallet(t, ctx, server.URL, merchant, base+"checkout-exact-big", 403)
		readWallet(t, ctx, server.URL, one, base+"checkout-exact-big?actorId=wallet-two", 400)
		readWallet(t, ctx, server.URL, one, base+"short", 400)
		readWallet(t, ctx, server.URL, empty, base+"checkout-cash-only", 200)
		t.Run("owner read failure returns no allocation", func(t *testing.T) {
			executeFixture(t, ctx, owner, "REVOKE SELECT ON wlt.customer_order_payment_readback FROM bthwani_wlt_reader")
			defer executeFixture(t, ctx, owner, "GRANT SELECT ON wlt.customer_order_payment_readback TO bthwani_wlt_reader")
			body := readWallet(t, ctx, server.URL, one, base+"checkout-exact-big", 503)
			if strings.Contains(string(body), "allocation") {
				t.Fatalf("unavailable owner leaked allocation: %s", body)
			}
		})
		// A separate session is revoked while the allocation projection is locked.
		pendingToken := session("wallet-one", "customer", 13)
		lock, err := owner.BeginTx(ctx, nil)
		if err != nil {
			t.Fatal(err)
		}
		defer lock.Rollback()
		if _, err = lock.ExecContext(ctx, "LOCK TABLE wlt.order_payment_allocations IN ACCESS EXCLUSIVE MODE"); err != nil {
			t.Fatal(err)
		}
		request := httptest.NewRequestWithContext(ctx, http.MethodGet, base+"checkout-exact-big", nil)
		request.Header.Set("Authorization", "Bearer "+pendingToken)
		pending := make(chan *httptest.ResponseRecorder, 1)
		go func() { rec := httptest.NewRecorder(); handler.ServeHTTP(rec, request); pending <- rec }()
		waitForWalletQuery(t, ctx, reader, "wlt.customer_order_payment_readback")
		digest := sha256.Sum256(bytes.Repeat([]byte{13}, 32))
		executeFixture(t, ctx, identity, "UPDATE identity_test_wlt.auth_sessions SET revoked_at=now() WHERE token_digest=$1", digest[:])
		if err = lock.Rollback(); err != nil {
			t.Fatal(err)
		}
		select {
		case rec := <-pending:
			if rec.Code != 401 || strings.Contains(rec.Body.String(), "allocation") {
				t.Fatalf("revoked allocation leaked: %d %s", rec.Code, rec.Body.String())
			}
		case <-ctx.Done():
			t.Fatal(ctx.Err())
		}
		t.Log("WLT_ALLOCATION_READBACK_PASS exact_yer=true cross_actor_denied=true revoked_during_read=true")
	})
	t.Run("finance agreement read", func(t *testing.T) {
		executeFixture(t, ctx, identity, "INSERT INTO identity_test_wlt.actors(id,status) VALUES ('finance-reader','ACTIVE'),('other-operator','ACTIVE')")
		executeFixture(t, ctx, identity, "INSERT INTO identity_test_wlt.actor_roles(actor_id,role,status) VALUES ('finance-reader','operator','ACTIVE'),('other-operator','operator','ACTIVE')")
		executeFixture(t, ctx, identity, "INSERT INTO identity_test_wlt.operator_permissions(actor_id,permission) VALUES ('finance-reader','finance')")
		finance := session("finance-reader", "operator", 11)
		other := session("other-operator", "operator", 12)
		const path = "/v1/operators/stores/store-a/commercial-agreement"
		body := readWallet(t, ctx, server.URL, finance, path, 200)
		var result struct {
			StoreID  string `json:"storeId"`
			Proposal struct {
				Version               int64   `json:"version"`
				ReviewState           string  `json:"reviewState"`
				CommissionBasisPoints int     `json:"commissionBasisPoints"`
				SubscriptionAmountYER *string `json:"subscriptionAmountYer"`
			} `json:"proposal"`
		}
		if err := json.Unmarshal(body, &result); err != nil || result.StoreID != "store-a" || result.Proposal.Version != 2 || result.Proposal.CommissionBasisPoints != 425 || result.Proposal.ReviewState != "REVIEW_APPROVED_PENDING_ACTIVATION" {
			t.Fatalf("wrong reviewed agreement: %s %v", body, err)
		}
		body = readWallet(t, ctx, server.URL, finance, "/v1/operators/stores/store-b/commercial-agreement", 200)
		if err := json.Unmarshal(body, &result); err != nil || result.StoreID != "store-b" || result.Proposal.SubscriptionAmountYER == nil || *result.Proposal.SubscriptionAmountYER != "9007199254740993" || result.Proposal.ReviewState != "DECLINED" {
			t.Fatalf("exact subscription: %s %v", body, err)
		}
		body = readWallet(t, ctx, server.URL, finance, "/v1/operators/stores/absent/commercial-agreement", 200)
		if !strings.Contains(string(body), `"proposal":null`) {
			t.Fatalf("missing proposal: %s", body)
		}
		readWallet(t, ctx, server.URL, other, path, 403)
		readWallet(t, ctx, server.URL, merchant, path, 403)
		readWallet(t, ctx, server.URL, one, path, 403)
		readWallet(t, ctx, server.URL, finance, path+"?actorId=other-operator", 400)
		// The second current-grant verification must discard a completed SQL read
		// when Finance access was revoked while that read was blocked.
		lock, err := owner.BeginTx(ctx, nil)
		if err != nil {
			t.Fatal(err)
		}
		defer lock.Rollback()
		if _, err = lock.ExecContext(ctx, "LOCK TABLE wlt.store_commercial_agreement_proposals IN ACCESS EXCLUSIVE MODE"); err != nil {
			t.Fatal(err)
		}
		pending := make(chan *httptest.ResponseRecorder, 1)
		request := httptest.NewRequestWithContext(ctx, http.MethodGet, path, nil)
		request.Header.Set("Authorization", "Bearer "+finance)
		go func() {
			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, request)
			pending <- rec
		}()
		waitForWalletQuery(t, ctx, reader, "wlt.latest_commercial_agreement_reviews")
		executeFixture(t, ctx, identity, "UPDATE identity_test_wlt.operator_permissions SET state='REVOKED' WHERE actor_id='finance-reader' AND permission='finance'")
		if err = lock.Rollback(); err != nil {
			t.Fatal(err)
		}
		select {
		case rec := <-pending:
			if rec.Code != 403 || strings.Contains(rec.Body.String(), "\"proposal\"") {
				t.Fatalf("revoked finance leaked review: %d %s", rec.Code, rec.Body.String())
			}
		case <-ctx.Done():
			t.Fatal(ctx.Err())
		}
		readWallet(t, ctx, server.URL, finance, path, 403)
		t.Log("WLT_FINANCE_AGREEMENT_READ_PASS exact_terms=true explicit_grant=true revoked_during_read=true no_activation=true")
	})
	for _, check := range []struct {
		id, balance, token string
	}{
		{"wallet-one", "9007199254741050", one},
		{"wallet-two", "41", two},
		{"wallet-empty", "0", empty},
	} {
		response := readWallet(t, ctx, server.URL, check.token, "/v1/wallets/me", 200)
		var result map[string]string
		if err := json.Unmarshal(response, &result); err != nil || len(result) != 4 ||
			result["actorId"] != check.id || result["balanceYer"] != check.balance || result["availableYer"] != check.balance || result["currency"] != "YER" {
			t.Fatalf("unexpected durable read result: %s %v", response, err)
		}
	}
	for _, check := range []struct {
		token, actor string
		count        int
	}{
		{one, "wallet-one", 2}, {two, "wallet-two", 1}, {empty, "wallet-empty", 0},
	} {
		body := readWallet(t, ctx, server.URL, check.token, "/v1/wallets/me/transactions", 200)
		var actual struct {
			ActorID  string `json:"actorId"`
			Currency string `json:"currency"`
			HasMore  bool   `json:"hasMore"`
			Items    []struct {
				FundingID string    `json:"fundingId"`
				AmountYER string    `json:"amountYer"`
				PostedAt  time.Time `json:"postedAt"`
			} `json:"items"`
		}
		if err := json.Unmarshal(body, &actual); err != nil || actual.ActorID != check.actor ||
			actual.Currency != "YER" || actual.HasMore || len(actual.Items) != check.count ||
			strings.Contains(string(body), "provider_reference") || strings.Contains(string(body), "synthetic-a") {
			t.Fatalf("unexpected actor-bound history %q: %s (%v)", check.actor, body, err)
		}
		for _, entry := range actual.Items {
			if entry.PostedAt.IsZero() || entry.FundingID == "" || entry.AmountYER == "" {
				t.Fatalf("invalid transaction metadata: %+v", entry)
			}
		}
	}

	// Twelve immutable postings at one exact instant exercise the SQL secondary
	// key (funding_id DESC) across the ten-row page boundary. Without it,
	// equal-time rows can be silently skipped on continuation.
	const tiedPost = `INSERT INTO wlt.customer_funding_journal
		(funding_id,actor_id,provider_id,provider_reference,amount_yer,currency,posted_at)
		VALUES ($1,$2,'synthetic',$3,$4,$5,$6)`
	tiedAt := time.Now().UTC().Add(time.Minute)
	for i := range 12 {
		id := fmt.Sprintf("funding-page-%02d", i)
		if i == 3 {
			id = "funding-PAGE-03" // Mixed case must use the same bytewise collation as the SDK.
		}
		executeFixture(t, ctx, owner, tiedPost, id,
			"wallet-one", fmt.Sprintf("page-%02d", i), int64(1), "YER", tiedAt)
	}
	type historyPage struct {
		ActorID    string  `json:"actorId"`
		HasMore    bool    `json:"hasMore"`
		NextCursor *string `json:"nextCursor"`
		Items      []struct {
			FundingID string `json:"fundingId"`
		} `json:"items"`
	}
	firstPath := "/v1/wallets/me/transactions"
	var firstPage historyPage
	body := readWallet(t, ctx, server.URL, one, firstPath, http.StatusOK)
	if err := json.Unmarshal(body, &firstPage); err != nil ||
		firstPage.ActorID != "wallet-one" || !firstPage.HasMore ||
		firstPage.NextCursor == nil || len(firstPage.Items) != 10 {
		t.Fatalf("first durable funding page invalid: %s %v", body, err)
	}
	secondPath := firstPath + "?cursor=" + *firstPage.NextCursor
	var secondPage historyPage
	body = readWallet(t, ctx, server.URL, one, secondPath, http.StatusOK)
	if err := json.Unmarshal(body, &secondPage); err != nil ||
		secondPage.ActorID != "wallet-one" || secondPage.HasMore ||
		secondPage.NextCursor != nil || len(secondPage.Items) != 4 {
		t.Fatalf("second durable funding page invalid: %s %v", body, err)
	}
	if firstPage.Items[0].FundingID != "funding-page-11" ||
		firstPage.Items[9].FundingID != "funding-page-01" ||
		secondPage.Items[0].FundingID != "funding-page-00" ||
		secondPage.Items[1].FundingID != "funding-PAGE-03" {
		t.Fatalf("equal-time keyset order changed across pages: first=%+v second=%+v",
			firstPage.Items, secondPage.Items)
	}
	seen := make(map[string]bool)
	for _, item := range append(firstPage.Items, secondPage.Items...) {
		if seen[item.FundingID] {
			t.Fatalf("duplicate funding across pages: %s", item.FundingID)
		}
		seen[item.FundingID] = true
	}
	if len(seen) != 14 {
		t.Fatalf("missing posted funding after paging: %d", len(seen))
	}
	var otherPage historyPage
	body = readWallet(t, ctx, server.URL, two, secondPath, http.StatusOK)
	if err := json.Unmarshal(body, &otherPage); err != nil ||
		otherPage.ActorID != "wallet-two" || len(otherPage.Items) > 1 {
		t.Fatalf("a cursor may not select another actor: %s %v", body, err)
	}
	for _, bad := range []string{
		"?cursor=invalid", "?cursor=" + *firstPage.NextCursor + "&actorId=wallet-two",
		"?cursor=" + *firstPage.NextCursor + "&cursor=" + *firstPage.NextCursor,
		"?limit=100000", "?",
	} {
		readWallet(t, ctx, server.URL, one, firstPath+bad, http.StatusBadRequest)
	}

	readWallet(t, ctx, server.URL, merchant, "/v1/wallets/me/transactions", 403)
	readWallet(t, ctx, server.URL, one, "/v1/wallets/me/transactions?actorId=wallet-two", 400)
	readWallet(t, ctx, server.URL, merchant, "/v1/wallets/me", 403)
	readWallet(t, ctx, server.URL, one, "/v1/wallets/me?actorId=wallet-two", 400)
	digest := sha256.Sum256(bytes.Repeat([]byte{1}, 32))
	t.Run("revoked while PostgreSQL read is blocked", func(t *testing.T) {
		lock, err := owner.BeginTx(ctx, nil)
		if err != nil {
			t.Fatal(err)
		}
		defer lock.Rollback()
		if _, err = lock.ExecContext(ctx, "LOCK TABLE wlt.customer_funding_journal IN ACCESS EXCLUSIVE MODE"); err != nil {
			t.Fatal(err)
		}

		req := httptest.NewRequestWithContext(ctx, http.MethodGet, "/v1/wallets/me", nil)
		req.Header.Set("Authorization", "Bearer "+one)
		pending := make(chan *httptest.ResponseRecorder, 1)
		go func() {
			recorder := httptest.NewRecorder()
			handler.ServeHTTP(recorder, req)
			pending <- recorder
		}()

		waitForWalletQuery(t, ctx, reader, "wlt.customer_wallet_availability")
		executeFixture(t, ctx, identity, "UPDATE identity_test_wlt.auth_sessions SET revoked_at=now() WHERE token_digest=$1", digest[:])
		if err = lock.Rollback(); err != nil {
			t.Fatal(err)
		}
		select {
		case response := <-pending:
			if response.Code != http.StatusUnauthorized || strings.Contains(response.Body.String(), "balanceYer") {
				t.Fatalf("a revoked session received the pending read: %d %s", response.Code, response.Body.String())
			}
		case <-ctx.Done():
			t.Fatal(ctx.Err())
		}
	})
	readWallet(t, ctx, server.URL, one, "/v1/wallets/me", 401)
	readWallet(t, ctx, server.URL, one, "/v1/wallets/me/transactions", 401)
	t.Run("sandbox command posts once and recovers the same funding", func(t *testing.T) {
		testSandboxFunding(t, ctx, reader, owner, identity, sandboxDSN, origin, server.URL, one, two, empty, merchant)
	})
	t.Log("WLT durable wallet readback, in-flight revocation, balanced journal, duplicate rejection and least privilege verified")
}

func waitForWalletQuery(t *testing.T, ctx context.Context, reader *sql.DB, statement string) {
	t.Helper()
	wait, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	tick := time.NewTicker(10 * time.Millisecond)
	defer tick.Stop()
	for {
		var blocked bool
		err := reader.QueryRowContext(wait, `SELECT EXISTS (
			SELECT 1 FROM pg_stat_activity WHERE usename = current_user AND wait_event_type = 'Lock'
			AND strpos(query, $1) > 0)`, statement).Scan(&blocked)
		if err != nil {
			t.Fatal(err)
		}
		if blocked {
			return
		}
		select {
		case <-wait.Done():
			t.Fatal("wallet query did not reach the PostgreSQL lock after initial Identity verification")
		case <-tick.C:
		}
	}
}

func openTestDB(t *testing.T, dsn string) *sql.DB {
	t.Helper()
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return db
}

func executeFixture(t *testing.T, ctx context.Context, db *sql.DB, statement string, args ...any) {
	t.Helper()
	if _, err := db.ExecContext(ctx, statement, args...); err != nil {
		t.Fatal(err)
	}
}

func assertSQLState(t *testing.T, err error, state string) {
	t.Helper()
	var postgres *pq.Error
	if !errors.As(err, &postgres) || string(postgres.Code) != state {
		t.Fatalf("expected SQLSTATE %s, got %v", state, err)
	}
}

func startIdentity(t *testing.T, ctx context.Context, binary, dsn, schema string) string {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	addr := listener.Addr().String()
	_ = listener.Close()
	command := exec.CommandContext(ctx, binary)
	command.Env = []string{"BTHWANI_ISOLATED_TEST_MODE=true", "IDENTITY_DEV_LISTEN_ADDR=" + addr,
		"IDENTITY_DB_SCHEMA=" + schema, "IDENTITY_TEST_DATABASE_URL=" + dsn}
	if err = command.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = command.Process.Kill(); _ = command.Wait() })
	origin := "http://" + addr
	client := &http.Client{Timeout: 150 * time.Millisecond}
	for range 50 {
		response, err := client.Get(origin + "/health")
		if err == nil {
			_ = response.Body.Close()
			if response.StatusCode == 200 {
				return origin
			}
		}
		time.Sleep(40 * time.Millisecond)
	}
	t.Fatal("isolated Identity HTTP owner failed readiness")
	return ""
}

func readWallet(t *testing.T, ctx context.Context, origin, token, route string, status int) []byte {
	t.Helper()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, origin+route, nil)
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Authorization", "Bearer "+token)
	request.Header.Set("X-Actor-ID", "other-wallet")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	body, err := io.ReadAll(response.Body)
	if err != nil || response.StatusCode != status || response.Header.Get("Cache-Control") != "no-store" {
		t.Fatalf("wallet HTTP status=%d expected=%d err=%v body=%s", response.StatusCode, status, err, body)
	}
	return body
}
