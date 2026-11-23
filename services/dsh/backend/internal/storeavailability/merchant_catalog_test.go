package storeavailability

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/testfixture"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

// Selector validation is independent of a database, and must occur before
// any attempt to read an owner Store or return draft records.
func TestMerchantCatalogSelectorsAndAuthentication(t *testing.T) {
	db, err := sql.Open("postgres", "postgres://synthetic@127.0.0.1:1/unused?sslmode=disable")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	checks := []struct {
		name, path, token string
		identity          IdentitySessions
		expected          int
	}{
		{"missing bearer", "/v1/stores/store-one/catalog", "", fakeIdentity{actor: VerifiedActor{Subject: "merchant-a", Role: MerchantRole}}, 401},
		{"revoked bearer", "/v1/stores/store-one/catalog", "synthetic", fakeIdentity{denied: true}, 401},
		{"operator without store access", "/v1/stores/store-one/catalog", "synthetic", fakeIdentity{actor: VerifiedActor{Subject: "operator-a", Role: OperatorRole}}, 403},
		{"identity outage", "/v1/stores/store-one/catalog", "synthetic", unavailableIdentitySessionAdapter{}, 503},
		{"invalid store id", "/v1/stores/INVALID/catalog", "synthetic", fakeIdentity{actor: VerifiedActor{Subject: "merchant-a", Role: MerchantRole}}, 400},
		{"duplicate cursor", "/v1/stores/store-one/catalog?cursor=a&cursor=b", "synthetic", fakeIdentity{actor: VerifiedActor{Subject: "merchant-a", Role: MerchantRole}}, 400},
		{"unknown selector", "/v1/stores/store-one/catalog?actorId=merchant-b", "synthetic", fakeIdentity{actor: VerifiedActor{Subject: "merchant-a", Role: MerchantRole}}, 400},
		{"bad limit", "/v1/stores/store-one/catalog?limit=51", "synthetic", fakeIdentity{actor: VerifiedActor{Subject: "merchant-a", Role: MerchantRole}}, 400},
		{"bad zero-padding", "/v1/stores/store-one/catalog?limit=02", "synthetic", fakeIdentity{actor: VerifiedActor{Subject: "merchant-a", Role: MerchantRole}}, 400},
		{"malformed escape", "/v1/stores/store-one/catalog?cursor=%ZZ", "synthetic", fakeIdentity{actor: VerifiedActor{Subject: "merchant-a", Role: MerchantRole}}, 400},
	}
	for _, tc := range checks {
		t.Run(tc.name, func(t *testing.T) {
			handler, err := NewMerchantCatalogHandler(tc.identity, db, "dsh_test_catalog_http")
			if err != nil {
				t.Fatal(err)
			}
			req := httptest.NewRequest("GET", tc.path, nil)
			if tc.token != "" {
				req.Header.Set("Authorization", "Bearer "+tc.token)
			}
			reply := httptest.NewRecorder()
			router := http.NewServeMux()
			router.Handle("GET /v1/stores/{storeID}/catalog", handler)
			router.ServeHTTP(reply, req)
			if reply.Code != tc.expected || reply.Header().Get("Cache-Control") != "no-store" {
				t.Fatalf("response %d expected %d: %s", reply.Code, tc.expected, reply.Body.String())
			}
		})
	}
	if _, err := NewMerchantCatalogHandler(nil, db, "dsh_test_catalog_http"); err == nil {
		t.Fatal("nil Identity admitted")
	}
	if _, err := NewMerchantCatalogHandler(fakeIdentity{}, nil, "dsh_test_catalog_http"); err == nil {
		t.Fatal("nil database admitted")
	}
	if _, err := NewMerchantCatalogHandler(fakeIdentity{}, db, "not-valid!"); err == nil {
		t.Fatal("invalid schema admitted")
	}
	handler, _ := NewMerchantCatalogHandler(fakeIdentity{}, db, "dsh_test_catalog_http")
	for _, method := range []string{"HEAD", "DELETE", "POST"} {
		req := httptest.NewRequest(method, "/v1/stores/store-one/catalog", nil)
		result := httptest.NewRecorder()
		handler.ServeHTTP(result, req)
		if result.Code != http.StatusMethodNotAllowed {
			t.Fatalf("%s returned %d", method, result.Code)
		}
	}
}

type changingMerchantIdentity struct{ count int }

func (identity *changingMerchantIdentity) ResolveCurrentSession(context.Context, string) (VerifiedActor, error) {
	identity.count++
	if identity.count > 1 {
		return VerifiedActor{}, ErrUnauthorized
	}
	return VerifiedActor{Subject: "merchant-a", Role: MerchantRole}, nil
}
func (*changingMerchantIdentity) RequireOperatorPermission(context.Context, string, string, string) error {
	return ErrForbidden
}

func TestMerchantCatalogRealPostgresOwnerReadback(t *testing.T) {
	dsn := os.Getenv("BTHWANI_DSH_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("NOT_RUN: isolated agent-02 PostgreSQL is not configured")
	}
	uri, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	allowLocal := uri.Host == "127.0.0.1:35322"
	allowContainer := uri.Host == "127.0.0.1:5432" && os.Getenv("BTHWANI_DSH_TEST_CONTAINER") == "bthwani-session02-orderability-pg"
	if uri.Scheme != "postgres" || (!allowLocal && !allowContainer) ||
		uri.Path != "/orderability_agent02" || uri.User.Username() != "bthwani_agent02" {
		t.Fatal("refusing any database except dedicated synthetic orderability_agent02")
	}
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	ctx, cancel := context.WithTimeout(t.Context(), 30*time.Second)
	defer cancel()
	var dbname, user string
	if err := db.QueryRowContext(ctx, "SELECT current_database(),current_user").Scan(&dbname, &user); err != nil ||
		dbname != "orderability_agent02" || user != "bthwani_agent02" {
		t.Fatalf("isolated database not verified: %v", err)
	}
	schema := fmt.Sprintf("dsh_test_catalog_%d", time.Now().UnixNano())
	testfixture.Fresh(t, ctx, db, "dsh", schema, filepath.Join("..", "..", "..", "database", "schema"))
	defer db.ExecContext(context.Background(), "DROP SCHEMA IF EXISTS "+schema+" CASCADE")
	statements := []string{
		"INSERT INTO " + schema + ".service_cities(id,active) VALUES('sanaa',true)",
		"INSERT INTO " + schema + ".verticals(id,active) VALUES('grocery',true)",
		"INSERT INTO " + schema + ".stores(id,owner_actor_id,city_id,vertical_id,relation,name,published) VALUES ('catalog-a','merchant-a','sanaa','grocery','MARKETPLACE','Owned',false),('catalog-b','merchant-b','sanaa','grocery','DIRECT','Foreign',false)",
		"INSERT INTO " + schema + ".products(id,store_id,name,active) VALUES('p-a','catalog-a','Draft',false),('p-b','catalog-a','Listed',true),('p-foreign','catalog-b','Private',false)",
		"INSERT INTO " + schema + ".variants(id,product_id,sellable,required_attributes_valid) VALUES('v-a','p-a',false,false),('v-b','p-b',true,true),('v-foreign','p-foreign',false,false)",
		"INSERT INTO " + schema + ".offers(id,store_id,product_id,variant_id,published,available,price_yer,stock_units) VALUES('of-a','catalog-a','p-a','v-a',false,false,1200,0),('of-b','catalog-a','p-b','v-b',true,true,1500,7),('of-foreign','catalog-b','p-foreign','v-foreign',false,false,99,0)",
	}
	for _, q := range statements {
		if _, err = db.ExecContext(ctx, q); err != nil {
			t.Fatal(err)
		}
	}
	merchant := fakeIdentity{actor: VerifiedActor{Subject: "merchant-a", Role: MerchantRole}}
	handler, err := NewMerchantCatalogHandler(merchant, db, schema)
	if err != nil {
		t.Fatal(err)
	}
	get := func(h http.Handler, path string) (int, MerchantCatalogPage) {
		t.Helper()
		req := httptest.NewRequest("GET", path, nil)
		req.Header.Set("Authorization", "Bearer synthetic")
		req.Header.Set("X-Actor-ID", "merchant-b") // forged actor never changes DB scope
		result := httptest.NewRecorder()
		router := http.NewServeMux()
		router.Handle("GET /v1/stores/{storeID}/catalog", h)
		router.ServeHTTP(result, req)
		var page MerchantCatalogPage
		if result.Code == 200 && json.Unmarshal(result.Body.Bytes(), &page) != nil {
			t.Fatalf("invalid JSON: %s", result.Body.String())
		}
		if result.Header().Get("Cache-Control") != "no-store" {
			t.Fatal("private catalog cacheable")
		}
		return result.Code, page
	}
	status, first := get(handler, "/v1/stores/catalog-a/catalog?limit=1")
	if status != 200 || first.ActorID != "merchant-a" || len(first.Items) != 1 ||
		first.Items[0].ID != "of-a" || first.Items[0].Published || first.Items[0].ProductActive ||
		first.NextCursor != "of-a" {
		t.Fatalf("draft page not authorized: %d %+v", status, first)
	}
	status, second := get(handler, "/v1/stores/catalog-a/catalog?limit=1&cursor=of-a")
	if status != 200 || len(second.Items) != 1 || second.Items[0].ID != "of-b" ||
		second.NextCursor != "" || second.Items[0].PriceYER != "1500" {
		t.Fatalf("next page mismatch: %d %+v", status, second)
	}
	if status, _ = get(handler, "/v1/stores/catalog-b/catalog"); status != 403 {
		t.Fatalf("foreign Store returned %d", status)
	}
	revoked, _ := NewMerchantCatalogHandler(fakeIdentity{denied: true}, db, schema)
	if status, _ = get(revoked, "/v1/stores/catalog-a/catalog"); status != 401 {
		t.Fatalf("revoked session read %d", status)
	}
	switched, _ := NewMerchantCatalogHandler(&changingMerchantIdentity{}, db, schema)
	if status, _ = get(switched, "/v1/stores/catalog-a/catalog"); status != 401 {
		t.Fatalf("revoked during read returned %d", status)
	}
	// Independent owner SQL connection verifies no extra Product/Offer writes.
	independent, err := sql.Open("postgres", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer independent.Close()
	var rows int
	if err = independent.QueryRowContext(ctx, "SELECT count(*) FROM "+schema+".offers WHERE store_id='catalog-a'").Scan(&rows); err != nil || rows != 2 {
		t.Fatalf("owner data unexpectedly changed: count=%d err=%v", rows, err)
	}

	registrar := &MerchantStoreRegistrar{identity: merchant, grants: &PostgresStoreGrants{db: db, schema: schema}}
	command := MerchantCatalogDraftChange{
		OperationID: "create-draft-0001", Name: "  مسودة جديدة  ", PriceYER: "2300", StockUnits: 4,
	}
	responses := make(chan MerchantCatalogDraftResult, 12)
	errorsFound := make(chan error, 12)
	var group sync.WaitGroup
	for i := 0; i < 12; i++ {
		group.Add(1)
		go func() {
			defer group.Done()
			value, e := registrar.CreateCatalogDraft(ctx, "synthetic", "catalog-a", command)
			if e != nil {
				errorsFound <- e
				return
			}
			responses <- value
		}()
	}
	group.Wait()
	close(responses)
	close(errorsFound)
	for e := range errorsFound {
		t.Errorf("idempotent concurrent draft failed: %v", e)
	}
	var draftOfferID string
	created, replayed := 0, 0
	for value := range responses {
		if value.Offer.StoreID != "catalog-a" || value.Offer.Name != "مسودة جديدة" ||
			value.Offer.PriceYER != "2300" || value.Offer.Published || value.Offer.Available ||
			value.Offer.ProductActive || value.Offer.VariantSellable || value.Offer.RequiredAttributesValid {
			t.Fatalf("unsafe published draft: %+v", value)
		}
		if draftOfferID != "" && draftOfferID != value.Offer.ID {
			t.Fatalf("duplicate draft generated: %s vs %s", draftOfferID, value.Offer.ID)
		}
		draftOfferID = value.Offer.ID
		if value.Replay {
			replayed++
		} else {
			created++
		}
	}
	if created != 1 || replayed != 11 {
		t.Fatalf("expected one write, 11 replays; created=%d replay=%d", created, replayed)
	}
	conflict := command
	conflict.PriceYER = "9999"
	if _, e := registrar.CreateCatalogDraft(ctx, "synthetic", "catalog-a", conflict); !errors.Is(e, ErrOperationConflict) {
		t.Fatalf("operation key reused with different price: %v", e)
	}
	if _, e := registrar.CreateCatalogDraft(ctx, "synthetic", "catalog-b", command); !errors.Is(e, ErrForbidden) {
		t.Fatalf("another Store created draft: %v", e)
	}
	otherRegistrar := &MerchantStoreRegistrar{identity: fakeIdentity{actor: VerifiedActor{Subject: "merchant-b", Role: MerchantRole}},
		grants: &PostgresStoreGrants{db: db, schema: schema}}
	if _, e := otherRegistrar.CreateCatalogDraft(ctx, "synthetic", "catalog-a", command); !errors.Is(e, ErrForbidden) {
		t.Fatalf("another Merchant created draft: %v", e)
	}
	// HTTP and SQL use the same owner command; replay never creates another record.
	draftHTTP, err := NewMerchantCatalogDraftHandler(registrar)
	if err != nil {
		t.Fatal(err)
	}
	post := func(input string) (int, MerchantCatalogDraftResult) {
		request := httptest.NewRequest("POST", "/v1/stores/catalog-a/catalog", strings.NewReader(input))
		request.Header.Set("Authorization", "Bearer synthetic")
		request.Header.Set("Content-Type", "application/json")
		request.Header.Set("X-Actor-ID", "merchant-b")
		response := httptest.NewRecorder()
		mux := http.NewServeMux()
		mux.Handle("POST /v1/stores/{storeID}/catalog", draftHTTP)
		mux.ServeHTTP(response, request)
		var result MerchantCatalogDraftResult
		if (response.Code == 200 || response.Code == 201) && json.Unmarshal(response.Body.Bytes(), &result) != nil {
			t.Fatal("draft HTTP invalid JSON")
		}
		return response.Code, result
	}
	encoded, _ := json.Marshal(command)
	if code, replay := post(string(encoded)); code != 200 || !replay.Replay || replay.Offer.ID != draftOfferID {
		t.Fatalf("HTTP replay mismatch code=%d body=%+v", code, replay)
	}
	if code, _ := post(`{"operationId":"create-draft-0001","OperationID":"changed","name":"X","priceYer":"999","stockUnits":0}`); code != 400 {
		t.Fatalf("duplicate command identity reached SQL: %d", code)
	}
	newHTTP := command
	newHTTP.OperationID = "create-draft-http-0002"
	newHTTP.Name = "HTTP draft"
	payloadHTTP, _ := json.Marshal(newHTTP)
	if code, created := post(string(payloadHTTP)); code != 201 || created.Replay ||
		created.Offer.StoreID != "catalog-a" || created.Offer.Name != "HTTP draft" ||
		created.Offer.Published || created.Offer.Available {
		t.Fatalf("HTTP did not create one unpublished DSH draft: code=%d result=%+v", code, created)
	}
	var records, offers, products, variants int
	for _, check := range []struct {
		sql  string
		dest *int
	}{
		{"SELECT count(*) FROM " + schema + ".catalog_draft_commands WHERE actor_id='merchant-a'", &records},
		{"SELECT count(*) FROM " + schema + ".offers WHERE store_id='catalog-a'", &offers},
		{"SELECT count(*) FROM " + schema + ".products WHERE store_id='catalog-a'", &products},
		{"SELECT count(*) FROM " + schema + ".variants v JOIN " + schema + ".products p ON p.id=v.product_id WHERE p.store_id='catalog-a'", &variants},
	} {
		if e := independent.QueryRowContext(ctx, check.sql).Scan(check.dest); e != nil {
			t.Fatal(e)
		}
	}
	if records != 2 || offers != 4 || products != 4 || variants != 4 {
		t.Fatalf("duplicate or missing durable DSH draft records commands=%d offers=%d products=%d variants=%d", records, offers, products, variants)
	}
	// Immutable command history must not allow rewriting an accepted operation key.
	if _, e := independent.ExecContext(ctx, "UPDATE "+schema+".catalog_draft_commands SET request_hash=repeat('0',64) WHERE actor_id='merchant-a'"); e == nil {
		t.Fatal("DSH command audit can be rewritten")
	}

	firstEdit := MerchantCatalogDraftEditChange{
		OperationID: "edit-draft-0001", ExpectedVersion: 1, Name: "مسودة معدلة", PriceYER: "2500", StockUnits: 8,
	}
	secondEdit := MerchantCatalogDraftEditChange{
		OperationID: "edit-draft-0002", ExpectedVersion: 1, Name: "مسودة متنافسة", PriceYER: "2700", StockUnits: 5,
	}
	type editOutcome struct {
		result MerchantCatalogDraftEditResult
		err    error
	}
	edits := make(chan editOutcome, 2)
	for _, input := range []MerchantCatalogDraftEditChange{firstEdit, secondEdit} {
		group.Add(1)
		go func(input MerchantCatalogDraftEditChange) {
			defer group.Done()
			value, e := registrar.EditCatalogDraft(ctx, "synthetic", "catalog-a", draftOfferID, input)
			edits <- editOutcome{result: value, err: e}
		}(input)
	}
	group.Wait()
	close(edits)
	var winning MerchantCatalogDraftEditChange
	success, conflicts := 0, 0
	for outcome := range edits {
		switch {
		case outcome.err == nil:
			success++
			if outcome.result.Offer.DraftVersion != 2 || outcome.result.Replay || outcome.result.Offer.Published {
				t.Fatalf("first draft edit not one safe increment: %+v", outcome.result)
			}
			if outcome.result.Offer.Name == firstEdit.Name {
				winning = firstEdit
			} else {
				winning = secondEdit
			}
		case errors.Is(outcome.err, ErrCatalogDraftVersionConflict):
			conflicts++
		default:
			t.Fatalf("unexpected concurrent edit result: %v", outcome.err)
		}
	}
	if success != 1 || conflicts != 1 {
		t.Fatalf("lost-update protection failed: successes=%d conflicts=%d", success, conflicts)
	}
	if _, e := registrar.EditCatalogDraft(ctx, "synthetic", "catalog-b", draftOfferID, winning); !errors.Is(e, ErrForbidden) {
		t.Fatalf("cross-Store draft edit accepted: %v", e)
	}
	if _, e := otherRegistrar.EditCatalogDraft(ctx, "synthetic", "catalog-a", draftOfferID, winning); !errors.Is(e, ErrForbidden) {
		t.Fatalf("cross-actor draft edit accepted: %v", e)
	}
	publishedAttempt := winning
	publishedAttempt.OperationID = "edit-draft-published-0004"
	if _, e := registrar.EditCatalogDraft(ctx, "synthetic", "catalog-a", "of-b", publishedAttempt); !errors.Is(e, ErrForbidden) {
		t.Fatalf("published offer editable as draft: %v", e)
	}
	foreignDraftAttempt := winning
	foreignDraftAttempt.OperationID = "edit-draft-unregistered-0005"
	if _, e := registrar.EditCatalogDraft(ctx, "synthetic", "catalog-a", "of-a", foreignDraftAttempt); !errors.Is(e, ErrForbidden) {
		t.Fatalf("non-DSH-created draft editable: %v", e)
	}
	malformed := winning
	malformed.PriceYER = "9999"
	if _, e := registrar.EditCatalogDraft(ctx, "synthetic", "catalog-a", draftOfferID, malformed); !errors.Is(e, ErrOperationConflict) {
		t.Fatalf("same edit operation mutated on retry: %v", e)
	}
	next := MerchantCatalogDraftEditChange{
		OperationID: "edit-draft-0003", ExpectedVersion: 2, Name: "مرحلة ثالثة", PriceYER: "3000", StockUnits: 2,
	}
	third, e := registrar.EditCatalogDraft(ctx, "synthetic", "catalog-a", draftOfferID, next)
	if e != nil || third.Replay || third.Offer.DraftVersion != 3 {
		t.Fatalf("second versioned edit not durable: %+v err=%v", third, e)
	}
	replay, e := registrar.EditCatalogDraft(ctx, "synthetic", "catalog-a", draftOfferID, winning)
	if e != nil || !replay.Replay || replay.Offer.DraftVersion != 2 ||
		replay.Offer.Name != winning.Name || replay.Offer.PriceYER != winning.PriceYER {
		t.Fatalf("historical edit replay changed after later edit: %+v err=%v", replay, e)
	}
	original, e := registrar.CreateCatalogDraft(ctx, "synthetic", "catalog-a", command)
	if e != nil || !original.Replay || original.Offer.DraftVersion != 1 ||
		original.Offer.Name != "مسودة جديدة" || original.Offer.PriceYER != "2300" {
		t.Fatalf("original creation replay drifted after edit: %+v err=%v", original, e)
	}
	var durableName, durablePrice string
	var durableStock, durableVersion int64
	e = independent.QueryRowContext(ctx, `SELECT p.name,o.price_yer::text,o.stock_units,o.draft_version
	 FROM `+schema+`.offers o JOIN `+schema+`.products p ON p.id=o.product_id
	 WHERE o.id=$1`, draftOfferID).Scan(&durableName, &durablePrice, &durableStock, &durableVersion)
	if e != nil || durableName != next.Name || durablePrice != next.PriceYER ||
		durableStock != next.StockUnits || durableVersion != 3 {
		t.Fatalf("independent DSH current edit readback failed: name=%s price=%s stock=%d version=%d err=%v", durableName, durablePrice, durableStock, durableVersion, e)
	}
	if e = independent.QueryRowContext(ctx, "SELECT count(*) FROM "+schema+".catalog_draft_edit_commands WHERE actor_id='merchant-a'").Scan(&records); e != nil || records != 2 {
		t.Fatalf("edit replay wrote unexpected journal count=%d err=%v", records, e)
	}
	if _, e = independent.ExecContext(ctx, "UPDATE "+schema+".catalog_draft_edit_commands SET result_price_yer=1 WHERE actor_id='merchant-a'"); e == nil {
		t.Fatal("draft edit journal can be rewritten")
	}
	editHandler, e := NewMerchantCatalogEditHandler(registrar)
	if e != nil {
		t.Fatal(e)
	}
	patch := func(path, body string) (int, MerchantCatalogDraftEditResult) {
		req := httptest.NewRequest("PATCH", path, strings.NewReader(body))
		req.Header.Set("Authorization", "Bearer synthetic")
		req.Header.Set("Content-Type", "application/json")
		result := httptest.NewRecorder()
		router := http.NewServeMux()
		router.Handle("PATCH /v1/stores/{storeID}/catalog/{offerID}", editHandler)
		router.ServeHTTP(result, req)
		var value MerchantCatalogDraftEditResult
		if result.Code == 200 && json.Unmarshal(result.Body.Bytes(), &value) != nil {
			t.Fatalf("invalid edit JSON: %s", result.Body.String())
		}
		return result.Code, value
	}
	editBody, _ := json.Marshal(next)
	if status, retried := patch("/v1/stores/catalog-a/catalog/"+draftOfferID, string(editBody)); status != 200 || !retried.Replay || retried.Offer.DraftVersion != 3 {
		t.Fatalf("HTTP edit retry failed: status=%d result=%+v", status, retried)
	}
	if status, _ := patch("/v1/stores/catalog-a/catalog/"+draftOfferID,
		`{"operationId":"edit-draft-0003","ExpectedVersion":100,"expectedVersion":2,"name":"x","priceYer":"3","stockUnits":2}`); status != 400 {
		t.Fatalf("duplicate version JSON reached writer status=%d", status)
	}
}
