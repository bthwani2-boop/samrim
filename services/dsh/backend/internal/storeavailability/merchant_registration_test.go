package storeavailability

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/testfixture"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func merchantRegisterFixture() MerchantRegistrationRequest {
	lat, lon := 15.3694, 44.1910
	return MerchantRegistrationRequest{
		OperationID: "registration-merchant-a-001", Name: "My Sana'a Shop",
		CityID: "sanaa", VerticalID: "grocery", Relation: "MARKETPLACE",
		Latitude: &lat, Longitude: &lon, PolicyVersion: 1,
		TermsVersion: "merchant-terms-v1", AcceptedTerms: true,
	}
}

func TestMerchantStoreRegistrationInputAndAuthorization(t *testing.T) {
	good := merchantRegisterFixture()
	if err := validateMerchantRegistration(good); err != nil {
		t.Fatal(err)
	}
	for _, mutate := range []func(*MerchantRegistrationRequest){
		func(v *MerchantRegistrationRequest) { v.Name = "  " },
		func(v *MerchantRegistrationRequest) { v.OperationID = "x" },
		func(v *MerchantRegistrationRequest) { v.CityID = "../sanaa" },
		func(v *MerchantRegistrationRequest) { v.VerticalID = "" },
		func(v *MerchantRegistrationRequest) { v.Relation = "PARTNER" },
		func(v *MerchantRegistrationRequest) { v.Latitude = nil },
		func(v *MerchantRegistrationRequest) { v.Longitude = nil },
		func(v *MerchantRegistrationRequest) { x := 91.0; v.Latitude = &x },
		func(v *MerchantRegistrationRequest) { v.PolicyVersion = 0 },
		func(v *MerchantRegistrationRequest) { v.TermsVersion = "" },
		func(v *MerchantRegistrationRequest) { v.AcceptedTerms = false },
		func(v *MerchantRegistrationRequest) { v.Name = "\nmalformed" },
	} {
		sample := good
		mutate(&sample)
		if !errors.Is(validateMerchantRegistration(sample), ErrRegistrationInvalid) {
			t.Fatalf("invalid Store request passed: %+v", sample)
		}
	}
	customer := &MerchantStoreRegistrar{identity: fakeIdentity{actor: VerifiedActor{Subject: "customer", Role: "CUSTOMER"}}}
	if _, err := customer.actor(context.Background(), "token"); !errors.Is(err, ErrForbidden) {
		t.Fatalf("Customer role could register Store: %v", err)
	}
	merchant := &MerchantStoreRegistrar{identity: fakeIdentity{actor: VerifiedActor{Subject: "merchant-a", Role: MerchantRole}}}
	if _, err := merchant.actor(context.Background(), "token"); err != nil {
		t.Fatal(err)
	}
	if _, err := merchant.actor(context.Background(), ""); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("missing bearer: %v", err)
	}
}

func TestMerchantRegistrationHTTPRejectsMalformedAndForgedRequests(t *testing.T) {
	service := &MerchantStoreRegistrar{identity: fakeIdentity{actor: VerifiedActor{Subject: "merchant-a", Role: MerchantRole}}}
	handler := NewMerchantRegistrationHandler(service)
	invoke := func(method, path, body string, headers map[string]string) int {
		t.Helper()
		r := httptest.NewRequest(method, path, strings.NewReader(body))
		for k, v := range headers {
			r.Header.Set(k, v)
		}
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, r)
		if recorder.Header().Get("Cache-Control") != "no-store" {
			t.Fatal("owner response must disable caching")
		}
		return recorder.Code
	}
	if got := invoke("GET", "/v1/stores/registration-options", "", nil); got != 401 {
		t.Fatalf("anonymous GET = %d", got)
	}
	if got := invoke("POST", "/v1/stores", "", nil); got != 401 {
		t.Fatalf("anonymous POST = %d", got)
	}
	auth := map[string]string{"Authorization": "Bearer synthetic-merchant", "Content-Type": "application/json"}
	if got := invoke("POST", "/v1/stores", `{"unknown":"field"}`, auth); got != 400 {
		t.Fatalf("unknown body = %d", got)
	}
	if got := invoke("POST", "/v1/stores", `{"operationId":"registration-merchant-a-001","cityId":"sanaa","acceptedTerms":true}`, auth); got != 400 {
		t.Fatalf("incomplete body = %d", got)
	}
	if got := invoke("POST", "/v1/stores?actorId=other", "{}", auth); got != 403 {
		t.Fatalf("query injection = %d", got)
	}
	cross := map[string]string{"Authorization": "Bearer synthetic-merchant", "Content-Type": "application/json", "Origin": "https://evil.invalid"}
	if got := invoke("POST", "/v1/stores", "{}", cross); got != 403 {
		t.Fatalf("cross-origin = %d", got)
	}
	if got := invoke("GET", "/v1/stores/registration-options?actorId=other", "", auth); got != 400 {
		t.Fatalf("private query = %d", got)
	}
}

func TestMerchantStoreRegistrationIsolatedPostgresDurability(t *testing.T) {
	dsn := os.Getenv("BTHWANI_MERCHANT_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("NOT_RUN: session-01 disposable Merchant PostgreSQL not configured")
	}
	if !isolatedMerchantTestDSN(dsn, os.Getenv("BTHWANI_MERCHANT_TEST_CONTAINER"),
		os.Getenv("PGHOSTADDR"), os.Getenv("BTHWANI_ISOLATED_TEST_MODE")) {
		t.Fatal("refusing any database other than session-01 disposable Merchant PostgreSQL")
	}
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	db.SetMaxOpenConns(15)
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	var database string
	if err = db.QueryRowContext(ctx, "SELECT current_database()").Scan(&database); err != nil || database != "merchant_agent01" {
		t.Fatalf("disposable database mismatch: %q %v", database, err)
	}
	schema := fmt.Sprintf("dsh_test_merchant_registration_%d", time.Now().UnixNano())
	testfixture.Fresh(t, ctx, db, "dsh", schema, filepath.Join("..", "..", "..", "database", "schema"))
	defer db.ExecContext(context.Background(), "DROP SCHEMA IF EXISTS "+schema+" CASCADE")
	if _, err = db.ExecContext(ctx, "INSERT INTO "+schema+".service_cities(id,active) VALUES('sanaa',true)"); err != nil {
		t.Fatal(err)
	}
	if _, err = db.ExecContext(ctx, "INSERT INTO "+schema+".verticals(id,active) VALUES('grocery',true)"); err != nil {
		t.Fatal(err)
	}
	if _, err = db.ExecContext(ctx, "INSERT INTO "+schema+".store_registration_terms(version,body) VALUES('merchant-terms-v1','Isolated Store registration terms; no financial or publication activation')"); err != nil {
		t.Fatal(err)
	}
	if _, err = db.ExecContext(ctx, `INSERT INTO `+schema+`.store_registration_policies
      (city_id,relation,version,enabled,terms_version,changed_by_actor) VALUES
      ('sanaa','MARKETPLACE',1,true,'merchant-terms-v1','isolated-operator'),
      ('sanaa','DIRECT',1,false,'merchant-terms-v1','isolated-operator')`); err != nil {
		t.Fatal(err)
	}
	grants, err := NewPostgresStoreGrants(db, schema)
	if err != nil {
		t.Fatal(err)
	}
	first, err := NewMerchantStoreRegistrar(fakeIdentity{actor: VerifiedActor{Subject: "merchant-a", Role: MerchantRole}}, grants)
	if err != nil {
		t.Fatal(err)
	}
	options, err := first.Options(ctx, "synthetic")
	if err != nil || len(options.Choices) != 1 || len(options.Verticals) != 1 ||
		options.Choices[0].CityID != "sanaa" || options.Choices[0].Relation != "MARKETPLACE" {
		t.Fatalf("options must match live DSH policy: %+v %v", options, err)
	}
	// A policy alone is not a usable registration option when the catalog
	// has no eligible commercial activity. Re-enabling an activity restores it.
	if _, err = db.ExecContext(ctx, "UPDATE "+schema+".verticals SET active=false WHERE id='grocery'"); err != nil {
		t.Fatal(err)
	}
	empty, err := first.Options(ctx, "synthetic")
	if err != nil || len(empty.Choices) != 0 || len(empty.Verticals) != 0 {
		t.Fatalf("registration without active activities must be closed: %+v %v", empty, err)
	}
	if _, err = first.Register(ctx, "synthetic", merchantRegisterFixture()); !errors.Is(err, ErrRegistrationClosed) {
		t.Fatalf("inactive activity admitted: %v", err)
	}
	if _, err = db.ExecContext(ctx, "UPDATE "+schema+".verticals SET active=true WHERE id='grocery'"); err != nil {
		t.Fatal(err)
	}
	options, err = first.Options(ctx, "synthetic")
	if err != nil || len(options.Choices) != 1 || len(options.Verticals) != 1 {
		t.Fatalf("registration must recover with an active activity: %+v %v", options, err)
	}
	denied := merchantRegisterFixture()
	denied.Relation = "DIRECT"
	if _, err = first.Register(ctx, "synthetic", denied); !errors.Is(err, ErrRegistrationClosed) {
		t.Fatalf("disabled relation admitted: %v", err)
	}
	input := merchantRegisterFixture()
	var group sync.WaitGroup
	results := make(chan MerchantRegistrationResult, 12)
	failures := make(chan error, 12)
	for i := 0; i < 12; i++ {
		group.Add(1)
		go func() {
			defer group.Done()
			result, e := first.Register(ctx, "synthetic", input)
			if e != nil {
				failures <- e
				return
			}
			results <- result
		}()
	}
	group.Wait()
	close(results)
	close(failures)
	for e := range failures {
		t.Errorf("same-op retry under contention: %v", e)
	}
	var storeID string
	created, replays := 0, 0
	for item := range results {
		if item.Store.ID == "" || item.Store.Published {
			t.Fatalf("unsafe Store result: %+v", item)
		}
		if storeID != "" && item.Store.ID != storeID {
			t.Fatalf("duplicate Store: %+v", item)
		}
		storeID = item.Store.ID
		if item.Replay {
			replays++
		} else {
			created++
		}
	}
	if created != 1 || replays != 11 {
		t.Fatalf("one writer eleven replays required: created=%d replay=%d", created, replays)
	}
	independent, err := sql.Open("postgres", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer independent.Close()
	var owner, city, relation, terms string
	var published bool
	var latitude, longitude float64
	err = independent.QueryRowContext(ctx, `SELECT s.owner_actor_id,s.city_id,s.relation,s.published,
      s.latitude,s.longitude,c.terms_version FROM `+schema+`.stores s
      JOIN `+schema+`.store_registration_commands c ON c.store_id=s.id WHERE s.id=$1`, storeID).
		Scan(&owner, &city, &relation, &published, &latitude, &longitude, &terms)
	if err != nil || owner != "merchant-a" || city != "sanaa" || relation != "MARKETPLACE" ||
		published || terms != "merchant-terms-v1" || latitude != 15.3694 || longitude != 44.1910 {
		t.Fatalf("independent committed Store readback invalid: owner=%s city=%s relation=%s published=%v terms=%s %v",
			owner, city, relation, published, terms, err)
	}
	var count int
	if err = independent.QueryRowContext(ctx, "SELECT count(*) FROM "+schema+".stores").Scan(&count); err != nil || count != 1 {
		t.Fatalf("exactly one Store required, count=%d err=%v", count, err)
	}
	other := input
	other.Name = "Changed payload"
	if _, err = first.Register(ctx, "synthetic", other); !errors.Is(err, ErrOperationConflict) {
		t.Fatalf("same idempotency key changed payload: %v", err)
	}
	if _, err = db.ExecContext(ctx, "UPDATE "+schema+".store_registration_policies SET enabled=false,version=2 WHERE city_id='sanaa' AND relation='MARKETPLACE'"); err != nil {
		t.Fatal(err)
	}
	replay, err := first.Register(ctx, "synthetic", input)
	if err != nil || !replay.Replay || replay.Store.ID != storeID {
		t.Fatalf("same command must reconcile after policy close: %+v %v", replay, err)
	}
	newInput := input
	newInput.OperationID = "registration-merchant-a-002"
	if _, err = first.Register(ctx, "synthetic", newInput); !errors.Is(err, ErrRegistrationClosed) {
		t.Fatalf("fresh registration must fail under closed policy: %v", err)
	}
	if _, err = db.ExecContext(ctx, "UPDATE "+schema+".stores SET owner_actor_id='merchant-b' WHERE id=$1", storeID); err != nil {
		t.Fatal(err)
	}
	if _, err = first.Register(ctx, "synthetic", input); !errors.Is(err, ErrForbidden) {
		t.Fatalf("former Store owner must not read transferred replay: %v", err)
	}
	if _, err = db.ExecContext(ctx, "DELETE FROM "+schema+".store_registration_commands WHERE actor_id='merchant-a'"); err == nil {
		t.Fatal("immutable registration acceptance was deleted")
	}
	remaining, err := grants.ListOwnedMerchantStores(ctx, "merchant-a")
	if err != nil || len(remaining) != 0 {
		t.Fatalf("transferred Store remains visible: %+v %v", remaining, err)
	}
	// Post-write HTTP response never substitutes for independent SQL readback.
	postBody, _ := json.Marshal(input)
	request := httptest.NewRequest(http.MethodPost, "/v1/stores", bytes.NewReader(postBody))
	request.Header.Set("Authorization", "Bearer synthetic")
	request.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	NewMerchantRegistrationHandler(first).ServeHTTP(recorder, request)
	if recorder.Code != http.StatusForbidden {
		t.Fatalf("transferred Store replay expected forbidden, got %d", recorder.Code)
	}
}
