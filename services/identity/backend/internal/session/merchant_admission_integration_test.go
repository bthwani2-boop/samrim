package session

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"
)

func verifyMerchantAdmissionIntegration(
	t *testing.T, ctx context.Context, db, independent *sql.DB, reader *PostgresReader,
	schema string, exec func(string, ...any), issue func(string, string) (string, [32]byte),
) {
	t.Helper()
	actors, roles, sessions := schema+".actors", schema+".actor_roles", schema+".auth_sessions"
	for _, id := range []string{"customer-self", "customer-unverified", "customer-prior-role", "customer-race", "customer-stale", "customer-future"} {
		exec("INSERT INTO "+actors+"(id,status) VALUES($1,'ACTIVE')", id)
		exec("INSERT INTO "+roles+"(actor_id,role,status) VALUES($1,'customer','ACTIVE')", id)
	}
	exec("UPDATE "+actors+" SET verified_at=now() WHERE id=ANY($1)", `{customer-self,customer-prior-role,customer-race,customer-stale}`)
	exec("UPDATE "+actors+" SET verified_at=now()+interval '1 hour' WHERE id=$1", "customer-future")
	exec("INSERT INTO "+roles+"(actor_id,role,status) VALUES($1,'merchant','SUSPENDED')", "customer-prior-role")
	selfToken, _ := issue("customer-self", "customer")
	unverifiedToken, _ := issue("customer-unverified", "customer")
	priorToken, _ := issue("customer-prior-role", "customer")
	raceToken, _ := issue("customer-race", "customer")
	staleToken, _ := issue("customer-stale", "customer")
	futureToken, _ := issue("customer-future", "customer")

	server := httptest.NewServer(NewHandler(NewVerifier(reader)))
	defer server.Close()
	type result struct {
		status int
		body   MerchantAdmission
		err    error
	}
	post := func(token string) result {
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, server.URL+"/v1/actors/me/merchant-role", nil)
		if err != nil {
			return result{err: err}
		}
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("X-Actor-ID", "customer-prior-role")
		req.Header.Set("X-Role", "operator")
		response, err := server.Client().Do(req)
		if err != nil {
			return result{err: err}
		}
		defer response.Body.Close()
		if response.Header.Get("Cache-Control") != "no-store" ||
			response.Header.Get("Access-Control-Allow-Origin") != "" {
			return result{err: errors.New("admission exposed cache or cross-origin credentials")}
		}
		var admission MerchantAdmission
		if response.StatusCode == http.StatusCreated {
			if err = json.NewDecoder(response.Body).Decode(&admission); err != nil {
				return result{err: err}
			}
		}
		return result{status: response.StatusCode, body: admission}
	}
	readSession := func(token string) (Principal, int, error) {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, server.URL+"/v1/sessions/current", nil)
		if err != nil {
			return Principal{}, 0, err
		}
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("X-Actor-ID", "other-actor")
		response, err := server.Client().Do(req)
		if err != nil {
			return Principal{}, 0, err
		}
		defer response.Body.Close()
		var p Principal
		if response.StatusCode == http.StatusOK {
			err = json.NewDecoder(response.Body).Decode(&p)
		}
		return p, response.StatusCode, err
	}

	if got := post(unverifiedToken); got.err != nil || got.status != http.StatusForbidden {
		t.Fatalf("unverified Customer was admitted: status=%d err=%v", got.status, got.err)
	}
	if got := post(futureToken); got.err != nil || got.status != http.StatusForbidden {
		t.Fatalf("future-dated verification proof was accepted: status=%d err=%v", got.status, got.err)
	}
	if got := post(priorToken); got.err != nil || got.status != http.StatusConflict {
		t.Fatalf("suspended Merchant role was reactivated: status=%d err=%v", got.status, got.err)
	}
	var priorStanding string
	if err := independent.QueryRowContext(ctx,
		"SELECT status FROM "+roles+" WHERE actor_id=$1 AND role='merchant'", "customer-prior-role").
		Scan(&priorStanding); err != nil || priorStanding != "SUSPENDED" {
		t.Fatalf("unlawful Merchant role reactivation: %s %v", priorStanding, err)
	}

	admitted := post(selfToken)
	if admitted.err != nil || admitted.status != http.StatusCreated ||
		len(admitted.body.AccessToken) != 43 ||
		!admitted.body.SessionExpiresAt.After(time.Now().UTC()) {
		t.Fatalf("verified Customer Merchant role admission failed: status=%d err=%v", admitted.status, admitted.err)
	}
	if got := post(admitted.body.AccessToken); got.err != nil || got.status != http.StatusUnauthorized {
		t.Fatalf("Merchant role token registered a second Merchant role: status=%d err=%v", got.status, got.err)
	}
	merchant, status, err := readSession(admitted.body.AccessToken)
	if err != nil || status != http.StatusOK || merchant.ActorID != "customer-self" || merchant.Role != "merchant" {
		t.Fatalf("new Merchant token does not identify same canonical actor: %#v %d %v", merchant, status, err)
	}
	customer, status, err := readSession(selfToken)
	if err != nil || status != http.StatusOK || customer.ActorID != "customer-self" || customer.Role != "customer" {
		t.Fatalf("Merchant role admission destroyed Customer session: %#v %d %v", customer, status, err)
	}
	raw, err := base64.RawURLEncoding.DecodeString(admitted.body.AccessToken)
	if err != nil || len(raw) != 32 {
		t.Fatal("issued Merchant bearer is not 256-bit")
	}
	digest := sha256.Sum256(raw)
	scopedIndependent, err := NewPostgresReader(independent, schema)
	if err != nil {
		t.Fatal(err)
	}
	real, err := scopedIndependent.Lookup(ctx, digest)
	if err != nil || real.ActorID != "customer-self" || real.Role != "merchant" {
		t.Fatalf("new role-bound session not durable from independent DB: %#v %v", real, err)
	}
	if retry := post(selfToken); retry.err != nil || retry.status != http.StatusConflict {
		t.Fatalf("direct registration replay created duplicate role: %d %v", retry.status, retry.err)
	}
	// A current authenticated logout invalidates only the newly issued
	// Merchant token, not the original Customer credential.
	logoutRequest, _ := http.NewRequestWithContext(ctx, http.MethodDelete, server.URL+"/v1/sessions/current", nil)
	logoutRequest.Header.Set("Authorization", "Bearer "+admitted.body.AccessToken)
	logoutResponse, err := server.Client().Do(logoutRequest)
	if err != nil {
		t.Fatal(err)
	}
	_ = logoutResponse.Body.Close()
	if logoutResponse.StatusCode != http.StatusNoContent {
		t.Fatalf("new Merchant token could not be logged out: %d", logoutResponse.StatusCode)
	}
	if _, status, err = readSession(admitted.body.AccessToken); err != nil || status != http.StatusUnauthorized {
		t.Fatalf("Merchant token still valid after logout: %d %v", status, err)
	}
	if _, status, err = readSession(selfToken); err != nil || status != http.StatusOK {
		t.Fatalf("Customer session was invalidated by Merchant logout: %d %v", status, err)
	}

	exec("UPDATE "+actors+" SET auth_version=auth_version+1 WHERE id=$1", "customer-stale")
	if got := post(staleToken); got.err != nil || got.status != http.StatusUnauthorized {
		t.Fatalf("stale verified Customer version admitted: status=%d err=%v", got.status, got.err)
	}
	// With two distinct verified Customers, one actor's registration cannot
	// mint an unrelated account, Store grant or second Merchant session.
	var group sync.WaitGroup
	outcomes := make(chan result, 12)
	for i := 0; i < 12; i++ {
		group.Add(1)
		go func() {
			defer group.Done()
			outcomes <- post(raceToken)
		}()
	}
	group.Wait()
	close(outcomes)
	created := 0
	createdToken := ""
	for got := range outcomes {
		if got.err != nil {
			t.Fatal("concurrent Merchant registration HTTP failure:", got.err)
		}
		switch got.status {
		case http.StatusCreated:
			created++
			createdToken = got.body.AccessToken
		case http.StatusConflict:
			// The role key cannot be allocated twice.
		default:
			t.Fatalf("unexpected concurrent admission status: %d", got.status)
		}
	}
	if created != 1 {
		t.Fatalf("concurrent registration created %d Merchant roles/sessions; want exactly one", created)
	}
	if p, status, err := readSession(createdToken); err != nil || status != http.StatusOK || p.ActorID != "customer-race" || p.Role != "merchant" {
		t.Fatalf("raced Merchant bearer lost canonical Identity scope: %#v %d %v", p, status, err)
	}
	var roleCount, sessionCount, unverifiedCount int
	if err := independent.QueryRowContext(ctx,
		"SELECT count(*) FROM "+roles+" WHERE actor_id=$1 AND role='merchant' AND status='ACTIVE'", "customer-race").
		Scan(&roleCount); err != nil || roleCount != 1 {
		t.Fatalf("concurrent Merchant role not durable exactly once: %d %v", roleCount, err)
	}
	if err := independent.QueryRowContext(ctx,
		"SELECT count(*) FROM "+sessions+" WHERE actor_id=$1 AND role='merchant'", "customer-race").
		Scan(&sessionCount); err != nil || sessionCount != 1 {
		t.Fatalf("concurrent role admission issued duplicate session: %d %v", sessionCount, err)
	}
	if err := independent.QueryRowContext(ctx,
		"SELECT count(*) FROM "+roles+" WHERE actor_id=$1 AND role='merchant'", "customer-unverified").
		Scan(&unverifiedCount); err != nil || unverifiedCount != 0 {
		t.Fatalf("unverified Customer role was persisted: count=%d err=%v", unverifiedCount, err)
	}
	fmt.Println("IDENTITY_VERIFIED_CUSTOMER_MERCHANT_ADMISSION_DURABLE_RACE_PASS")
}
