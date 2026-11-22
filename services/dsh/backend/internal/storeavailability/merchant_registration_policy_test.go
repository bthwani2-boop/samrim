package storeavailability

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func registrationPolicyFixture() StoreRegistrationPolicyChange {
	return StoreRegistrationPolicyChange{
		CityID: "sanaa", Relation: "MARKETPLACE", OperationID: "admission-policy-001",
		ExpectedVersion: 0, Enabled: true, TermsVersion: "merchant-terms-v1",
		TermsText: "Isolated Merchant Store registration; no financial or publication activation.",
		Reason:    "Operator approved isolated Store admission",
	}
}
func TestRegistrationPolicyValidationAndOperatorAuthorization(t *testing.T) {
	valid := registrationPolicyFixture()
	if !validStoreRegistrationPolicyChange(valid) {
		t.Fatal("valid policy rejected")
	}
	unicode := valid
	unicode.TermsText = strings.Repeat("😀", 4000)
	if !validStoreRegistrationPolicyChange(unicode) {
		t.Fatal("four thousand Unicode terms codepoints must be admitted")
	}
	for _, mutate := range []func(*StoreRegistrationPolicyChange){
		func(v *StoreRegistrationPolicyChange) { v.OperationID = "bad" },
		func(v *StoreRegistrationPolicyChange) { v.CityID = "sanaa/other" },
		func(v *StoreRegistrationPolicyChange) { v.Relation = "OTHER" },
		func(v *StoreRegistrationPolicyChange) { v.ExpectedVersion = -1 },
		func(v *StoreRegistrationPolicyChange) { v.TermsVersion = "../unsafe" },
		func(v *StoreRegistrationPolicyChange) { v.TermsText = "  " },
		func(v *StoreRegistrationPolicyChange) { v.TermsText = strings.Repeat("x", 4001) },
		func(v *StoreRegistrationPolicyChange) { v.Reason = "" },
		func(v *StoreRegistrationPolicyChange) { v.Reason = "\u0001bad" },
	} {
		input := valid
		mutate(&input)
		if validStoreRegistrationPolicyChange(input) {
			t.Fatalf("invalid policy accepted: %+v", input)
		}
	}
	for _, tc := range []struct {
		label    string
		identity IdentitySessions
		method   string
		path     string
		bearer   bool
		body     string
		origin   string
		status   int
	}{
		{"unauthenticated", fakeIdentity{actor: VerifiedActor{Subject: "operator-a", Role: OperatorRole}}, "PATCH", "/v1/operators/cities/sanaa/store-registration-policy/MARKETPLACE", false, "{}", "", 401},
		{"customer role", fakeIdentity{actor: VerifiedActor{Subject: "customer-a", Role: "customer"}}, "GET", "/v1/operators/cities/sanaa/store-registration-policy/MARKETPLACE", true, "", "", 403},
		{"merchant role", fakeIdentity{actor: VerifiedActor{Subject: "merchant-a", Role: MerchantRole}}, "GET", "/v1/operators/cities/sanaa/store-registration-policy/MARKETPLACE", true, "", "", 403},
		{"operator without policy right", fakeIdentity{actor: VerifiedActor{Subject: "operator-a", Role: OperatorRole}, permissionDenied: true}, "GET", "/v1/operators/cities/sanaa/store-registration-policy/MARKETPLACE", true, "", "", 403},
		{"invalid city", fakeIdentity{actor: VerifiedActor{Subject: "operator-a", Role: OperatorRole}}, "GET", "/v1/operators/cities/CITY_INVALID/store-registration-policy/MARKETPLACE", true, "", "", 400},
		{"invalid relation", fakeIdentity{actor: VerifiedActor{Subject: "operator-a", Role: OperatorRole}}, "GET", "/v1/operators/cities/sanaa/store-registration-policy/SHADOW", true, "", "", 400},
		{"query injected", fakeIdentity{actor: VerifiedActor{Subject: "operator-a", Role: OperatorRole}}, "GET", "/v1/operators/cities/sanaa/store-registration-policy/MARKETPLACE?actorId=other", true, "", "", 400},
		{"HEAD disallowed", fakeIdentity{actor: VerifiedActor{Subject: "operator-a", Role: OperatorRole}}, "HEAD", "/v1/operators/cities/sanaa/store-registration-policy/MARKETPLACE", true, "", "", 405},
		{"invalid JSON", fakeIdentity{actor: VerifiedActor{Subject: "operator-a", Role: OperatorRole}}, "PATCH", "/v1/operators/cities/sanaa/store-registration-policy/MARKETPLACE", true, `{"unexpected":"field"}`, "", 400},
		{"cross-origin", fakeIdentity{actor: VerifiedActor{Subject: "operator-a", Role: OperatorRole}}, "PATCH", "/v1/operators/cities/sanaa/store-registration-policy/MARKETPLACE", true, "{}", "https://untrusted.invalid", 403},
		{"identity unavailable", unavailableIdentitySessionAdapter{}, "GET", "/v1/operators/cities/sanaa/store-registration-policy/MARKETPLACE", true, "", "", 503},
	} {
		t.Run(tc.label, func(t *testing.T) {
			service := &MerchantStoreRegistrar{identity: tc.identity, grants: &PostgresStoreGrants{}}
			handler, err := NewStoreRegistrationPolicyHandler(service)
			if err != nil {
				t.Fatal(err)
			}
			req := httptest.NewRequest(tc.method, tc.path, strings.NewReader(tc.body))
			if tc.bearer {
				req.Header.Set("Authorization", "Bearer synthetic")
			}
			if tc.method == "PATCH" {
				req.Header.Set("Content-Type", "application/json")
			}
			if tc.origin != "" {
				req.Header.Set("Origin", tc.origin)
			}
			out := httptest.NewRecorder()
			handler.ServeHTTP(out, req)
			if out.Code != tc.status {
				t.Fatalf("got %d want %d: %s", out.Code, tc.status, out.Body.String())
			}
		})
	}
	if _, err := NewStoreRegistrationPolicyHandler(nil); !errors.Is(err, ErrStoreOwnerUnavailable) {
		t.Fatalf("nil policy owner accepted: %v", err)
	}
}

func TestStoreRegistrationPolicyRealPostgresAuthorizationAndReconciliation(t *testing.T) {
	dsn := os.Getenv("BTHWANI_MERCHANT_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("NOT_RUN: disposable session-01 Merchant PostgreSQL not configured")
	}
	if !isolatedMerchantTestDSN(dsn, os.Getenv("BTHWANI_MERCHANT_TEST_CONTAINER"),
		os.Getenv("PGHOSTADDR"), os.Getenv("BTHWANI_ISOLATED_TEST_MODE")) {
		t.Fatal("refusing non-disposable session-01 Merchant PostgreSQL")
	}
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	db.SetMaxOpenConns(12)
	ctx, cancel := context.WithTimeout(context.Background(), 55*time.Second)
	defer cancel()
	var dbName string
	if err = db.QueryRowContext(ctx, "SELECT current_database()").Scan(&dbName); err != nil || dbName != "merchant_agent01" {
		t.Fatalf("isolated DB mismatch: %q %v", dbName, err)
	}
	schema := fmt.Sprintf("merchant_policy_%d", time.Now().UnixNano())
	for _, migration := range []string{"001_public_discovery.sql", "009_merchant_store_registration.sql", "010_store_registration_policy_commands.sql"} {
		contents, e := os.ReadFile(filepath.Join("..", "..", "..", "database", "migrations", migration))
		if e != nil {
			t.Fatal(e)
		}
		if _, e = db.ExecContext(ctx, strings.ReplaceAll(string(contents), "__SCHEMA__", schema)); e != nil {
			t.Fatalf("migration %s failed: %v", migration, e)
		}
	}
	defer db.ExecContext(context.Background(), "DROP SCHEMA IF EXISTS "+schema+" CASCADE")
	if _, err = db.ExecContext(ctx, "INSERT INTO "+schema+".service_cities(id,active) VALUES('sanaa',true)"); err != nil {
		t.Fatal(err)
	}
	if _, err = db.ExecContext(ctx, "INSERT INTO "+schema+".verticals(id,active) VALUES('grocery',true)"); err != nil {
		t.Fatal(err)
	}
	grants, err := NewPostgresStoreGrants(db, schema)
	if err != nil {
		t.Fatal(err)
	}
	operator, err := NewMerchantStoreRegistrar(fakeIdentity{actor: VerifiedActor{Subject: "operator-a", Role: OperatorRole}}, grants)
	if err != nil {
		t.Fatal(err)
	}
	merchant, err := NewMerchantStoreRegistrar(fakeIdentity{actor: VerifiedActor{Subject: "merchant-a", Role: MerchantRole}}, grants)
	if err != nil {
		t.Fatal(err)
	}
	endpoint := "/v1/operators/cities/sanaa/store-registration-policy/MARKETPLACE"
	handler, err := NewStoreRegistrationPolicyHandler(operator)
	if err != nil {
		t.Fatal(err)
	}
	call := func(method string, body any) (int, []byte) {
		t.Helper()
		var encoded []byte
		if body != nil {
			encoded, _ = json.Marshal(body)
		}
		req := httptest.NewRequest(method, endpoint, bytes.NewReader(encoded))
		req.Header.Set("Authorization", "Bearer synthetic")
		if body != nil {
			req.Header.Set("Content-Type", "application/json")
		}
		out := httptest.NewRecorder()
		handler.ServeHTTP(out, req)
		if out.Header().Get("Cache-Control") != "no-store" {
			t.Fatal("policy response cacheable")
		}
		return out.Code, out.Body.Bytes()
	}
	if status, body := call("GET", nil); status != 200 || !bytes.Contains(body, []byte(`"version":0`)) {
		t.Fatalf("initial policy should be closed: %d %s", status, body)
	}
	pre, err := merchant.Options(ctx, "synthetic")
	if err != nil || len(pre.Choices) != 0 {
		t.Fatalf("unconfigured admission should be closed: %+v %v", pre, err)
	}
	first := registrationPolicyFixture()
	status, body := call("PATCH", first)
	var firstResponse StoreRegistrationPolicyResult
	if status != 200 || json.Unmarshal(body, &firstResponse) != nil || firstResponse.Replay ||
		firstResponse.Policy.Version != 1 || !firstResponse.Policy.Enabled {
		t.Fatalf("operator initial admission failed: %d %s", status, body)
	}
	// A command key is scoped to the whole business intent, not just the JSON
	// body. Changing the URL-bound city or relation must never replay another policy.
	otherRelation := first
	otherRelation.Relation = "DIRECT"
	if _, err = operator.ApplyRegistrationPolicy(ctx, "operator-a", otherRelation); !errors.Is(err, ErrOperationConflict) {
		t.Fatalf("one operation key replayed a different relation: %v", err)
	}
	otherCity := first
	otherCity.CityID = "aden"
	if _, err = operator.ApplyRegistrationPolicy(ctx, "operator-a", otherCity); !errors.Is(err, ErrOperationConflict) {
		t.Fatalf("one operation key replayed a different city: %v", err)
	}
	status, body = call("PATCH", first)
	var replay StoreRegistrationPolicyResult
	if status != 200 || json.Unmarshal(body, &replay) != nil || !replay.Replay || replay.Policy.Version != 1 {
		t.Fatalf("policy idempotent replay failed: %d %s", status, body)
	}
	changed := first
	changed.TermsText = "Different hidden terms"
	if status, body = call("PATCH", changed); status != 409 {
		t.Fatalf("same operation, different payload admitted: %d %s", status, body)
	}
	current, err := operator.ReadRegistrationPolicy(ctx, "sanaa", "MARKETPLACE")
	if err != nil || current.Version != 1 || current.TermsText != first.TermsText {
		t.Fatalf("policy readback failed: %+v %v", current, err)
	}
	choices, err := merchant.Options(ctx, "synthetic")
	if err != nil || len(choices.Choices) != 1 || choices.Choices[0].TermsText != first.TermsText {
		t.Fatalf("Merchant not shown versioned terms: %+v %v", choices, err)
	}
	storeInput := merchantRegisterFixture()
	registered, err := merchant.Register(ctx, "synthetic", storeInput)
	if err != nil || registered.Store.ID == "" || registered.Store.Published {
		t.Fatalf("verified Merchant Store was not persisted unpublished: %+v %v", registered, err)
	}
	disable := first
	disable.OperationID = "admission-policy-002"
	disable.ExpectedVersion = 1
	disable.Enabled = false
	disable.Reason = "Operator closed new registrations without unpublishing existing Stores"
	status, body = call("PATCH", disable)
	if status != 200 {
		t.Fatalf("disabling new admissions failed: %d %s", status, body)
	}
	newInput := storeInput
	newInput.OperationID = "registration-merchant-a-002"
	if _, err = merchant.Register(ctx, "synthetic", newInput); !errors.Is(err, ErrRegistrationClosed) {
		t.Fatalf("new Store admitted after policy closure: %v", err)
	}
	again, err := merchant.Register(ctx, "synthetic", storeInput)
	if err != nil || !again.Replay || again.Store.ID != registered.Store.ID {
		t.Fatalf("existing Store command not reconciled: %+v %v", again, err)
	}
	stale := disable
	stale.OperationID = "admission-policy-003"
	if status, body = call("PATCH", stale); status != 409 {
		t.Fatalf("stale policy write accepted: %d %s", status, body)
	}
	overwrite := disable
	overwrite.OperationID = "admission-policy-004"
	overwrite.ExpectedVersion = 2
	overwrite.TermsText = "New terms hidden behind existing version"
	if status, body = call("PATCH", overwrite); status != 409 {
		t.Fatalf("immutable consent text silently replaced: %d %s", status, body)
	}
	independent, err := sql.Open("postgres", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer independent.Close()
	var policies, commands int
	err = independent.QueryRowContext(ctx, "SELECT count(*) FROM "+schema+".store_registration_policies").Scan(&policies)
	if err != nil || policies != 1 {
		t.Fatalf("unexpected policy rows: %d %v", policies, err)
	}
	err = independent.QueryRowContext(ctx, "SELECT count(*) FROM "+schema+".store_registration_policy_commands").Scan(&commands)
	if err != nil || commands != 2 {
		t.Fatalf("replay wrote duplicate audit rows: %d %v", commands, err)
	}
	var enabled bool
	var version int64
	err = independent.QueryRowContext(ctx, "SELECT version,enabled FROM "+schema+".store_registration_policies WHERE city_id='sanaa' AND relation='MARKETPLACE'").Scan(&version, &enabled)
	if err != nil || version != 2 || enabled {
		t.Fatalf("policy closure not durable: %d %v %v", version, enabled, err)
	}
	if _, err = independent.ExecContext(ctx, "DELETE FROM "+schema+".store_registration_policy_commands WHERE actor_id='operator-a'"); err == nil {
		t.Fatal("immutable Operator policy audit allowed deletion")
	}
	var published bool
	if err = independent.QueryRowContext(ctx, "SELECT published FROM "+schema+".stores WHERE id=$1", registered.Store.ID).Scan(&published); err != nil || published {
		t.Fatalf("closed policy changed existing Store publication: %v %v", published, err)
	}
}
