package storeavailability

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/testfixture"
	"go/ast"
	"go/parser"
	"go/token"
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
		{"revoked search", "/v1/stores/store-one/catalog?q=Draft&limit=1&cursor=of-a", "synthetic", fakeIdentity{denied: true}, 401},
		{"revoked valid status", "/v1/stores/store-one/catalog?status=stockout&limit=1&cursor=of-a", "synthetic", fakeIdentity{denied: true}, 401},
		{"duplicate status", "/v1/stores/store-one/catalog?status=published&status=stockout", "synthetic", fakeIdentity{denied: true}, 400},
		{"invalid status", "/v1/stores/store-one/catalog?status=unknown", "synthetic", fakeIdentity{denied: true}, 400},
		{"empty status", "/v1/stores/store-one/catalog?status=", "synthetic", fakeIdentity{denied: true}, 400},
		{"duplicate search", "/v1/stores/store-one/catalog?q=a&q=b", "synthetic", fakeIdentity{denied: true}, 400},
		{"invalid UTF8 search", "/v1/stores/store-one/catalog?q=%FF", "synthetic", fakeIdentity{denied: true}, 400},
		{"NUL search", "/v1/stores/store-one/catalog?q=%00", "synthetic", fakeIdentity{denied: true}, 400},
		{"long search", "/v1/stores/store-one/catalog?q=" + strings.Repeat("a", 81), "synthetic", fakeIdentity{denied: true}, 400},
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

func TestMerchantCatalogWriteConfirmsOriginalActor(t *testing.T) {
	for _, tc := range []struct {
		name     string
		identity fakeIdentity
		want     error
	}{
		{"same actor", fakeIdentity{actor: VerifiedActor{Subject: "merchant-a", Role: MerchantRole}}, nil},
		{"changed actor", fakeIdentity{actor: VerifiedActor{Subject: "merchant-b", Role: MerchantRole}}, ErrUnknownResult},
		{"revoked", fakeIdentity{denied: true}, ErrUnknownResult},
		{"changed role", fakeIdentity{actor: VerifiedActor{Subject: "merchant-a", Role: "customer"}}, ErrUnknownResult},
	} {
		t.Run(tc.name, func(t *testing.T) {
			service := &MerchantStoreRegistrar{identity: tc.identity}
			if err := service.confirmCatalogActor(t.Context(), "synthetic", "merchant-a"); !errors.Is(err, tc.want) {
				t.Fatalf("actor confirmation: got %v, want %v", err, tc.want)
			}
		})
	}
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
	// A missing owner schema must never resolve catalog relations in pg_temp.
	shadow, err := sql.Open("postgres", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer shadow.Close()
	shadow.SetMaxOpenConns(1)
	for _, relation := range []string{"stores", "offers", "products", "variants"} {
		if _, err := shadow.ExecContext(ctx, "CREATE TEMP TABLE "+relation+" AS SELECT * FROM "+schema+"."+relation); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := readMerchantCatalog(ctx, shadow, schema+"_missing", "merchant-a", "catalog-a", 20, "", "", ""); !errors.Is(err, ErrStoreOwnerUnavailable) {
		t.Fatalf("missing schema catalog shadow must fail closed: %v", err)
	}
	if _, err := readMerchantInventorySummary(ctx, shadow, schema+"_missing", "merchant-a", "catalog-a"); !errors.Is(err, ErrStoreOwnerUnavailable) {
		t.Fatalf("missing schema summary shadow must fail closed: %v", err)
	}

	merchant := fakeIdentity{actor: VerifiedActor{Subject: "merchant-a", Role: MerchantRole}}
	// The command boundary must reject an absent owner even when a connection
	// contains a complete temporary imitation of the catalog.
	if _, err := shadow.ExecContext(ctx, "CREATE TEMP TABLE catalog_draft_commands AS SELECT * FROM "+schema+".catalog_draft_commands"); err != nil {
		t.Fatal(err)
	}
	shadowRegistrar := &MerchantStoreRegistrar{identity: merchant, grants: &PostgresStoreGrants{db: shadow, schema: schema + "_missing"}}
	shadowCommand := MerchantCatalogDraftChange{OperationID: "shadow-create-0001", Name: "Shadow draft", PriceYER: "100", StockUnits: 1}
	if _, err := shadowRegistrar.CreateCatalogDraft(ctx, "synthetic", "catalog-a", shadowCommand); !errors.Is(err, ErrStoreOwnerUnavailable) {
		t.Fatalf("missing owner catalog command must fail closed: %v", err)
	}
	shadowEdit := MerchantCatalogDraftEditChange{OperationID: "shadow-edit-0001", ExpectedVersion: 1, Name: "Shadow edit", PriceYER: "200", StockUnits: 2}
	if _, err := shadowRegistrar.EditCatalogDraft(ctx, "synthetic", "catalog-a", "of-a", shadowEdit); !errors.Is(err, ErrStoreOwnerUnavailable) {
		t.Fatalf("missing owner catalog edit must fail closed: %v", err)
	}
	if _, err := shadowRegistrar.CatalogImport(ctx, "synthetic", "catalog-a", "shadow-import-0001", nil, false, 0); !errors.Is(err, ErrStoreOwnerUnavailable) {
		t.Fatalf("missing owner catalog import must fail closed: %v", err)
	}
	var shadowCount int
	if err := shadow.QueryRowContext(ctx, "SELECT count(*) FROM pg_temp.catalog_draft_commands").Scan(&shadowCount); err != nil || shadowCount != 0 {
		t.Fatalf("unexpected temporary command write: count=%d error=%v", shadowCount, err)
	}

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
	// The complete summary must be independent of the currently paginated rows.
	getSummary := func(identity IdentitySessions, path string, bearer string) (int, MerchantInventorySummary) {
		t.Helper()
		h, e := NewMerchantInventorySummaryHandler(identity, db, schema)
		if e != nil {
			t.Fatal(e)
		}
		req := httptest.NewRequest("GET", path, nil)
		if bearer != "" {
			req.Header.Set("Authorization", "Bearer "+bearer)
		}
		req.Header.Set("X-Actor-ID", "merchant-b")
		result := httptest.NewRecorder()
		router := http.NewServeMux()
		router.Handle("GET /v1/stores/{storeID}/inventory-summary", h)
		router.ServeHTTP(result, req)
		var value MerchantInventorySummary
		if result.Code == 200 && json.Unmarshal(result.Body.Bytes(), &value) != nil {
			t.Fatalf("invalid summary JSON: %s", result.Body.String())
		}
		if result.Header().Get("Cache-Control") != "no-store" {
			t.Fatal("cacheable summary")
		}
		return result.Code, value
	}
	const summaryPath = "/v1/stores/catalog-a/inventory-summary"
	status, summary := getSummary(merchant, summaryPath, "synthetic")
	if status != 200 || summary != (MerchantInventorySummary{ActorID: "merchant-a", StoreID: "catalog-a", TotalOffers: 2, PublishedOffers: 1, AvailableOffers: 1}) {
		t.Fatalf("summary not scoped or complete: %d %+v", status, summary)
	}
	for _, tc := range []struct {
		identity     IdentitySessions
		path, bearer string
		status       int
	}{
		{merchant, summaryPath, "", 401},
		{merchant, "/v1/stores/catalog-b/inventory-summary", "synthetic", 403},
		{merchant, summaryPath + "?limit=1", "synthetic", 400},
		{fakeIdentity{denied: true}, summaryPath, "synthetic", 401},
		{&changingMerchantIdentity{}, summaryPath, "synthetic", 401},
	} {
		if code, _ := getSummary(tc.identity, tc.path, tc.bearer); code != tc.status {
			t.Fatalf("summary denial: %d expected %d", code, tc.status)
		}
	}
	// A published stockout is unavailable; a zero-stock draft is not counted as published stockout.
	if _, err = db.ExecContext(ctx, "UPDATE "+schema+".offers SET stock_units=0 WHERE id='of-b'"); err != nil {
		t.Fatal(err)
	}
	status, summary = getSummary(merchant, summaryPath, "synthetic")
	if status != 200 || summary.PublishedOffers != 1 || summary.AvailableOffers != 0 || summary.UnavailableOffers != 1 || summary.StockoutOffers != 1 {
		t.Fatalf("stockout not reflected: %d %+v", status, summary)
	}
	for _, selector := range []string{"stockout", "unavailable"} {
		code, page := get(handler, "/v1/stores/catalog-a/catalog?status="+selector)
		if code != 200 || len(page.Items) != 1 || page.Items[0].ID != "of-b" {
			t.Fatalf("published stockout filter %s: %d %+v", selector, code, page)
		}
	}
	if _, err = db.ExecContext(ctx, "UPDATE "+schema+".offers SET stock_units=7 WHERE id='of-b'"); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct{ selector, want string }{
		{"published", "of-b"}, {"unpublished", "of-a"}, {"available", "of-b"},
		{"unavailable", ""}, {"stockout", ""},
	} {
		code, page := get(handler, "/v1/stores/catalog-a/catalog?limit=1&status="+tc.selector)
		if code != 200 || page.NextCursor != "" || (tc.want == "" && len(page.Items) != 0) ||
			(tc.want != "" && (len(page.Items) != 1 || page.Items[0].ID != tc.want)) {
			t.Fatalf("owner filter %s: %d %+v", tc.selector, code, page)
		}
	}
	if code, page := get(handler, "/v1/stores/catalog-a/catalog?status=published&q=Draft"); code != 200 || len(page.Items) != 0 {
		t.Fatalf("combined status/name mismatch: %d %+v", code, page)
	}
	if code, _ := get(handler, "/v1/stores/catalog-b/catalog?status=unpublished"); code != 403 {
		t.Fatalf("foreign status filter: %d", code)
	}
	status, second := get(handler, "/v1/stores/catalog-a/catalog?limit=1&cursor=of-a")
	if status != 200 || len(second.Items) != 1 || second.Items[0].ID != "of-b" ||
		second.NextCursor != "" || second.Items[0].PriceYER != "1500" {
		t.Fatalf("next page mismatch: %d %+v", status, second)
	}
	status, filtered := get(handler, "/v1/stores/catalog-a/catalog?q=drAFt")
	if status != 200 || len(filtered.Items) != 1 || filtered.Items[0].ID != "of-a" {
		t.Fatalf("private name search mismatch: %d %+v", status, filtered)
	}
	for _, query := range []string{"%25", "Private"} {
		status, empty := get(handler, "/v1/stores/catalog-a/catalog?q="+query)
		if status != 200 || len(empty.Items) != 0 {
			t.Fatalf("literal or foreign search leaked: %d %+v", status, empty)
		}
	}
	if status, _ = get(handler, "/v1/stores/catalog-b/catalog?q=Private"); status != 403 {
		t.Fatalf("foreign Store search returned %d", status)
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

	historyHandler, e := NewMerchantCatalogDraftHistoryHandler(merchant, db, schema)
	if e != nil {
		t.Fatal(e)
	}
	historyRoute := func(handler http.Handler, store, offer, selectors string) (int, MerchantCatalogDraftHistoryPage) {
		t.Helper()
		mux := http.NewServeMux()
		mux.Handle("GET /v1/stores/{storeID}/catalog/{offerID}/draft-history", handler)
		req := httptest.NewRequest("GET", "/v1/stores/"+store+"/catalog/"+offer+"/draft-history"+selectors, nil)
		req.Header.Set("Authorization", "Bearer synthetic")
		res := httptest.NewRecorder()
		mux.ServeHTTP(res, req)
		var page MerchantCatalogDraftHistoryPage
		if res.Code == 200 && json.Unmarshal(res.Body.Bytes(), &page) != nil {
			t.Fatal("invalid history response")
		}
		return res.Code, page
	}
	code, history := historyRoute(historyHandler, "catalog-a", draftOfferID, "?limit=1")
	if code != 200 || history.ActorID != "merchant-a" || history.StoreID != "catalog-a" ||
		history.OfferID != draftOfferID || history.NextBeforeVersion != "3" || len(history.Entries) != 1 {
		t.Fatalf("draft history first page: %d %+v", code, history)
	}
	entry := history.Entries[0]
	if entry.Version != 3 || entry.PreviousPriceYER != winning.PriceYER || entry.PriceYER != next.PriceYER ||
		entry.PreviousStockUnits != winning.StockUnits || entry.StockUnits != next.StockUnits || entry.CommittedAt.IsZero() {
		t.Fatalf("draft history must reflect immutable transition: %+v", entry)
	}
	code, history = historyRoute(historyHandler, "catalog-a", draftOfferID, "?limit=1&beforeVersion=3")
	if code != 200 || len(history.Entries) != 1 || history.NextBeforeVersion != "" ||
		history.Entries[0].Version != 2 || history.Entries[0].PreviousPriceYER != command.PriceYER ||
		history.Entries[0].PriceYER != winning.PriceYER {
		t.Fatalf("draft history second page: %d %+v", code, history)
	}
	code, history = historyRoute(historyHandler, "catalog-a", "of-b", "")
	if code != 200 || history.Entries == nil || len(history.Entries) != 0 {
		t.Fatalf("published offer must not fabricate draft history: %d %+v", code, history)
	}
	for _, scope := range [][2]string{{"catalog-b", draftOfferID}, {"catalog-a", "of-foreign"}, {"catalog-a", "missing"}} {
		code, _ = historyRoute(historyHandler, scope[0], scope[1], "")
		if code != 403 {
			t.Fatalf("history scope %v returned %d", scope, code)
		}
	}
	revokedHistory, _ := NewMerchantCatalogDraftHistoryHandler(&changingMerchantIdentity{}, db, schema)
	if code, _ = historyRoute(revokedHistory, "catalog-a", draftOfferID, ""); code != 401 {
		t.Fatalf("revoked history returned %d", code)
	}
	if _, e := readMerchantCatalogDraftHistory(ctx, shadow, schema+"_missing", "merchant-a", "catalog-a", draftOfferID, 20, 0); !errors.Is(e, ErrStoreOwnerUnavailable) {
		t.Fatalf("missing owner history scope admitted: %v", e)
	}
	// Verify both historical transitions independently, including the old values
	// from the locked version rather than a later read of the current Offer.
	for _, entry := range []struct {
		before MerchantCatalogDraftChange
		after  MerchantCatalogDraftEditChange
	}{
		{command, winning},
		{MerchantCatalogDraftChange{Name: winning.Name, PriceYER: winning.PriceYER, StockUnits: winning.StockUnits}, next},
	} {
		var oldName, oldPrice, newName, newPrice, auditStore, auditOffer string
		var oldStock, newStock, expectedVersion, resultVersion int64
		e = independent.QueryRowContext(ctx, `SELECT store_id,offer_id,expected_version,result_version,
			old_name,old_price_yer::text,old_stock_units,result_name,result_price_yer::text,result_stock_units
			FROM `+schema+`.catalog_draft_edit_commands WHERE actor_id=$1 AND operation_id=$2`,
			"merchant-a", entry.after.OperationID).Scan(&auditStore, &auditOffer, &expectedVersion, &resultVersion,
			&oldName, &oldPrice, &oldStock, &newName, &newPrice, &newStock)
		if e != nil || auditStore != "catalog-a" || auditOffer != draftOfferID ||
			expectedVersion != entry.after.ExpectedVersion || resultVersion != expectedVersion+1 ||
			oldName != strings.TrimSpace(entry.before.Name) || oldPrice != entry.before.PriceYER ||
			oldStock != entry.before.StockUnits || newName != entry.after.Name ||
			newPrice != entry.after.PriceYER || newStock != entry.after.StockUnits {
			t.Fatalf("durable audit transition mismatch for %s: %v", entry.after.OperationID, e)
		}
	}
	for _, entry := range []struct {
		store, operation, state string
		expected                int64
	}{
		{"catalog-b", "audit-cross-store-0001", "23503", 10},
		{"catalog-a", "audit-duplicate-version-0001", "23505", 1},
	} {
		_, e = independent.ExecContext(ctx, `INSERT INTO `+schema+`.catalog_draft_edit_commands
			(actor_id,operation_id,request_hash,store_id,offer_id,expected_version,result_version,
			old_name,old_price_yer,old_stock_units,result_name,result_price_yer,result_stock_units)
			VALUES ('merchant-a',$1,repeat('a',64),$2,$3,$4,$5,'old',1,0,'new',2,1)`,
			entry.operation, entry.store, draftOfferID, entry.expected, entry.expected+1)
		var pgErr interface{ SQLState() string }
		if !errors.As(e, &pgErr) || pgErr.SQLState() != entry.state {
			t.Fatalf("audit integrity: expected %s for %s, got %v", entry.state, entry.operation, e)
		}
	}
	if _, e = independent.ExecContext(ctx, "DELETE FROM "+schema+".catalog_draft_edit_commands WHERE actor_id='merchant-a'"); e == nil {
		t.Fatal("draft edit journal can be deleted")
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
	// Add more offers than the maximum catalog page size in the disposable schema.
	for _, statement := range []string{
		"INSERT INTO " + schema + ".products(id,store_id,name,active) SELECT 'summary-p-'||n,'catalog-a','Inventory fixture',true FROM generate_series(1,60) n",
		"INSERT INTO " + schema + ".variants(id,product_id,sellable,required_attributes_valid) SELECT 'summary-v-'||n,'summary-p-'||n,true,true FROM generate_series(1,60) n",
		"INSERT INTO " + schema + ".offers(id,store_id,product_id,variant_id,published,available,price_yer,stock_units) SELECT 'summary-of-'||n,'catalog-a','summary-p-'||n,'summary-v-'||n,true,true,100,n%2 FROM generate_series(1,60) n",
	} {
		if _, err := db.ExecContext(ctx, statement); err != nil {
			t.Fatal(err)
		}
	}
	status, summary = getSummary(merchant, summaryPath, "synthetic")
	if status != 200 || summary != (MerchantInventorySummary{ActorID: "merchant-a", StoreID: "catalog-a", TotalOffers: 64, PublishedOffers: 61, AvailableOffers: 31, UnavailableOffers: 30, StockoutOffers: 30}) {
		t.Fatalf("whole Store inventory must exceed page limit: %d %+v", status, summary)
	}
	for _, tc := range []struct {
		selector string
		want     int64
	}{
		{"published", summary.PublishedOffers}, {"unpublished", summary.TotalOffers - summary.PublishedOffers},
		{"available", summary.AvailableOffers}, {"unavailable", summary.UnavailableOffers}, {"stockout", summary.StockoutOffers},
	} {
		cursor := ""
		var count int64
		for pageIndex := 0; pageIndex < 10; pageIndex++ {
			path := "/v1/stores/catalog-a/catalog?limit=10&status=" + tc.selector
			if cursor != "" {
				path += "&cursor=" + cursor
			}
			code, page := get(handler, path)
			if code != 200 || len(page.Items) > 10 {
				t.Fatalf("filtered page %s: %d %+v", tc.selector, code, page)
			}
			for _, item := range page.Items {
				if item.ID <= cursor || item.StoreID != "catalog-a" {
					t.Fatalf("filtered cursor/scope mismatch: %+v", item)
				}
				cursor = item.ID
				count++
			}
			if page.NextCursor == "" {
				break
			}
			if page.NextCursor != cursor {
				t.Fatalf("filtered continuation mismatch: %+v", page)
			}
		}
		if count != tc.want {
			t.Fatalf("filtered count %s=%d, summary=%d", tc.selector, count, tc.want)
		}
	}
}

func TestMerchantInventorySummaryRejectsUnauthorizedBeforeDatabase(t *testing.T) {
	db, err := sql.Open("postgres", "postgres://synthetic@127.0.0.1:1/unused?sslmode=disable")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	merchant := fakeIdentity{actor: VerifiedActor{Subject: "merchant-a", Role: MerchantRole}}
	const path = "/v1/stores/store-a/inventory-summary"
	for _, tc := range []struct {
		path, bearer string
		identity     IdentitySessions
		status       int
	}{
		{path, "", merchant, 401},
		{path, "synthetic", fakeIdentity{denied: true}, 401},
		{path, "synthetic", fakeIdentity{actor: VerifiedActor{Subject: "operator-a", Role: OperatorRole}}, 403},
		{path + "?limit=1", "synthetic", merchant, 400},
		{"/v1/stores/INVALID/inventory-summary", "synthetic", merchant, 400},
	} {
		h, err := NewMerchantInventorySummaryHandler(tc.identity, db, "dsh_test_inventory")
		if err != nil {
			t.Fatal(err)
		}
		mux := http.NewServeMux()
		mux.Handle("GET /v1/stores/{storeID}/inventory-summary", h)
		req := httptest.NewRequest("GET", tc.path, nil)
		if tc.bearer != "" {
			req.Header.Set("Authorization", "Bearer "+tc.bearer)
		}
		reply := httptest.NewRecorder()
		mux.ServeHTTP(reply, req)
		if reply.Code != tc.status || reply.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("unexpected inventory response: %d expected %d", reply.Code, tc.status)
		}
	}
}

// Both reads must use one fixed parameterized statement; no SQL assembly at a database call.
func TestMerchantCatalogFixedQueryBoundary(t *testing.T) {
	f, err := parser.ParseFile(token.NewFileSet(), "merchant_catalog.go", nil, 0)
	if err != nil {
		t.Fatal(err)
	}
	calls := 0
	ast.Inspect(f, func(n ast.Node) bool {
		call, ok := n.(*ast.CallExpr)
		if !ok {
			return true
		}
		sel, ok := call.Fun.(*ast.SelectorExpr)
		if !ok || (sel.Sel.Name != "QueryContext" && sel.Sel.Name != "QueryRowContext") {
			return true
		}
		calls++
		if len(call.Args) < 2 {
			t.Error("missing SQL statement")
			return true
		}
		lit, ok := call.Args[1].(*ast.BasicLit)
		if !ok || lit.Kind != token.STRING {
			t.Errorf("%s must use fixed SQL", sel.Sel.Name)
		}
		return true
	})
	if calls != 2 {
		t.Errorf("expected owner authorization and one catalog projection, got %d SQL calls", calls)
	}
}

func TestMerchantDraftHistoryRejectsInvalidScope(t *testing.T) {
	db, err := sql.Open("postgres", "postgres://synthetic@127.0.0.1:1/unused?sslmode=disable")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	merchant := fakeIdentity{actor: VerifiedActor{Subject: "merchant-a", Role: MerchantRole}}
	const route = "/v1/stores/store-a/catalog/of-a/draft-history"
	for _, tc := range []struct {
		path, bearer string
		identity     IdentitySessions
		status       int
	}{
		{route, "", merchant, 401},
		{route, "synthetic", fakeIdentity{denied: true}, 401},
		{route, "synthetic", fakeIdentity{actor: VerifiedActor{Subject: "operator-a", Role: OperatorRole}}, 403},
		{route + "?limit=0", "synthetic", merchant, 400},
		{route + "?beforeVersion=2&beforeVersion=3", "synthetic", merchant, 400},
		{route + "?q=secret", "synthetic", merchant, 400},
		{route + "?beforeVersion=9007199254740992", "synthetic", merchant, 400},
		{"/v1/stores/store-a/catalog/INVALID/draft-history", "synthetic", merchant, 400},
	} {
		h, err := NewMerchantCatalogDraftHistoryHandler(tc.identity, db, "dsh_test_history")
		if err != nil {
			t.Fatal(err)
		}
		mux := http.NewServeMux()
		mux.Handle("GET /v1/stores/{storeID}/catalog/{offerID}/draft-history", h)
		req := httptest.NewRequest("GET", tc.path, nil)
		if tc.bearer != "" {
			req.Header.Set("Authorization", "Bearer "+tc.bearer)
		}
		res := httptest.NewRecorder()
		mux.ServeHTTP(res, req)
		if res.Code != tc.status || res.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("%s: status %d expected %d", tc.path, res.Code, tc.status)
		}
	}
}
