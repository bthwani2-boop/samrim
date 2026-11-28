package storeavailability

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/testfixture"
)

func TestCatalogImportManifestValidation(t *testing.T) {
	valid := MerchantCatalogImportChange{SourceSHA256: strings.Repeat("a", 64), Rows: []MerchantCatalogImportRow{{Row: 2, Name: "a", PriceYER: "12", StockUnits: "2"}}}
	if err := validateCatalogImport("import-0001", valid); err != nil {
		t.Fatal(err)
	}
	for _, change := range []MerchantCatalogImportChange{
		{},
		{SourceSHA256: valid.SourceSHA256, Rows: []MerchantCatalogImportRow{{Row: 3}}},
		{SourceSHA256: valid.SourceSHA256, Rows: []MerchantCatalogImportRow{{Row: 2, OfferID: "of-a"}}},
		{SourceSHA256: valid.SourceSHA256, Rows: []MerchantCatalogImportRow{{Row: 2, ExpectedVersion: 1}}},
		{SourceSHA256: valid.SourceSHA256, Rows: []MerchantCatalogImportRow{{Row: 2, SourceIssue: "UNKNOWN"}}},
		{SourceSHA256: valid.SourceSHA256, Rows: []MerchantCatalogImportRow{{Row: 2, SourceIssue: "INVALID_ROW", OfferID: "of-a", ExpectedVersion: 1}}},
	} {
		if validateCatalogImport("import-0001", change) == nil {
			t.Fatalf("invalid accepted: %+v", change)
		}
	}
	if catalogImportRowOperation("a", "b", "c", 2) == catalogImportRowOperation("a", "b", "c", 3) {
		t.Fatal("row operation collision")
	}
	if catalogImportRowOperation("a", "b", "c", 2) == catalogImportRowOperation("a", "b", "d", 2) {
		t.Fatal("run operation collision")
	}
}

func TestCatalogImportStoredManifestRejectsChangedContent(t *testing.T) {
	change := MerchantCatalogImportChange{SourceSHA256: strings.Repeat("a", 64), Rows: []MerchantCatalogImportRow{{Row: 2, Name: "Milk", PriceYER: "100", StockUnits: "2"}}}
	manifest, digest, err := encodeCatalogImportManifest("import-0001", change)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := decodeCatalogImportManifest("import-0001", digest, manifest); err != nil {
		t.Fatalf("unchanged manifest rejected: %v", err)
	}
	// PostgreSQL jsonb can reorder object keys and add whitespace.
	reordered := []byte(`{"rows":[{"stockUnits":"2","priceYer":"100","name":"Milk","row":2}],"sourceSha256":"` + change.SourceSHA256 + `"}`)
	if _, err := decodeCatalogImportManifest("import-0001", digest, reordered); err != nil {
		t.Fatalf("equivalent jsonb rejected: %v", err)
	}
	change.Rows[0].PriceYER = "101"
	changed, _, err := encodeCatalogImportManifest("import-0001", change)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := decodeCatalogImportManifest("import-0001", digest, changed); !errors.Is(err, ErrStoreOwnerUnavailable) {
		t.Fatalf("changed manifest not rejected: %v", err)
	}
	if _, err := decodeCatalogImportManifest("import-0001", strings.Repeat("0", 64), manifest); !errors.Is(err, ErrStoreOwnerUnavailable) {
		t.Fatalf("wrong digest not rejected: %v", err)
	}
}

func TestCatalogImportMalformedSourceRowIsHeldWithoutWriter(t *testing.T) {
	row := MerchantCatalogImportRow{Row: 2, Name: "Extra columns", PriceYER: "100", StockUnits: "2", SourceIssue: "INVALID_ROW"}
	change := MerchantCatalogImportChange{SourceSHA256: strings.Repeat("a", 64), Rows: []MerchantCatalogImportRow{row}}
	if err := validateCatalogImport("import-0001", change); err != nil {
		t.Fatal(err)
	}
	service := &MerchantStoreRegistrar{}
	out, err := service.processCatalogImportRow(t.Context(), nil, "merchant-a", "store-a", "import-0001", row, false)
	if err != nil || out.Status != "HELD" || out.Reason != "INVALID_VALUES" || out.OfferID != "" || out.ResultVersion != 0 {
		t.Fatalf("malformed source row must be held: %+v %v", out, err)
	}
}

func TestCatalogImportHandlerDeniesAnonymousAndMalformed(t *testing.T) {
	db, err := sql.Open("postgres", "postgres://synthetic@127.0.0.1:1/unused?sslmode=disable")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	service := &MerchantStoreRegistrar{identity: fakeIdentity{actor: VerifiedActor{Subject: "merchant-a", Role: MerchantRole}}, grants: &PostgresStoreGrants{db: db, schema: "dsh_test_import"}}
	h, err := NewMerchantCatalogImportHandler(service)
	if err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	mux.Handle("/v1/stores/{storeID}/catalog-imports/{runID}", h)
	for _, tc := range []struct {
		method, path, token, body string
		status                    int
	}{
		{"GET", "/v1/stores/catalog-a/catalog-imports/import-0001", "", "", 401},
		{"PUT", "/v1/stores/catalog-a/catalog-imports/import-0001", "synthetic", `{"sourceSha256":"a","rows":[]}`, 400},
		{"PATCH", "/v1/stores/catalog-a/catalog-imports/import-0001", "synthetic", "{}", 400},
		{"GET", "/v1/stores/catalog-a/catalog-imports/import-0001?actor=merchant-b", "synthetic", "", 400},
		{"GET", "/v1/stores/catalog-a/catalog-imports/import-0001?offset=0&extra=%ZZ", "synthetic", "", 400},
		{"GET", "/v1/stores/catalog-a/catalog-imports/import-0001?offset=0&extra=1;bad=2", "synthetic", "", 400},
		{"DELETE", "/v1/stores/catalog-a/catalog-imports/import-0001", "synthetic", "", 405},
	} {
		req := httptest.NewRequest(tc.method, tc.path, strings.NewReader(tc.body))
		req.Header.Set("Content-Type", "application/json")
		if tc.token != "" {
			req.Header.Set("Authorization", "Bearer "+tc.token)
		}
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, req)
		if w.Code != tc.status || w.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("unexpected %d %s", w.Code, w.Body.String())
		}
	}
}

func TestMerchantCatalogImportRealPostgresOwnerReadback(t *testing.T) {
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
	if uri.Scheme != "postgres" || (!allowLocal && !allowContainer) || uri.Path != "/orderability_agent02" || uri.User.Username() != "bthwani_agent02" {
		t.Fatal("refusing any database except dedicated synthetic orderability_agent02")
	}
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	ctx, cancel := context.WithTimeout(t.Context(), 45*time.Second)
	defer cancel()
	var dbname, user string
	if err = db.QueryRowContext(ctx, "SELECT current_database(),current_user").Scan(&dbname, &user); err != nil || dbname != "orderability_agent02" || user != "bthwani_agent02" {
		t.Fatalf("isolated database not verified: %v", err)
	}
	schema := fmt.Sprintf("dsh_test_import_%d", time.Now().UnixNano())
	testfixture.Fresh(t, ctx, db, "dsh", schema, filepath.Join("..", "..", "..", "database", "schema"))
	defer db.ExecContext(context.Background(), "DROP SCHEMA IF EXISTS "+schema+" CASCADE")
	for _, q := range []string{
		"INSERT INTO " + schema + ".service_cities(id,active) VALUES ('sanaa',true)",
		"INSERT INTO " + schema + ".verticals(id,active) VALUES ('grocery',true)",
		"INSERT INTO " + schema + ".stores(id,owner_actor_id,city_id,vertical_id,relation,name,published) VALUES ('import-a','merchant-a','sanaa','grocery','MARKETPLACE','Owned',false),('import-b','merchant-b','sanaa','grocery','DIRECT','Foreign',false)",
	} {
		if _, err = db.ExecContext(ctx, q); err != nil {
			t.Fatal(err)
		}
	}
	service := &MerchantStoreRegistrar{identity: fakeIdentity{actor: VerifiedActor{Subject: "merchant-a", Role: MerchantRole}}, grants: &PostgresStoreGrants{db: db, schema: schema}}
	other := &MerchantStoreRegistrar{identity: fakeIdentity{actor: VerifiedActor{Subject: "merchant-b", Role: MerchantRole}}, grants: &PostgresStoreGrants{db: db, schema: schema}}
	offer := func(name, id string) MerchantCatalogOffer {
		r, e := service.CreateCatalogDraft(ctx, "synthetic", "import-a", MerchantCatalogDraftChange{OperationID: id, Name: name, PriceYER: "100", StockUnits: 1})
		if e != nil {
			t.Fatal(e)
		}
		return r.Offer
	}
	a := offer("Milk", "draft-import-a")
	b := offer("Bread", "draft-import-b")
	c := offer("Stale", "draft-import-c")
	d := offer("Duplicate", "draft-import-d")
	f := offer("Published", "draft-import-f")
	if _, err = db.ExecContext(ctx, "UPDATE "+schema+".offers SET published=true WHERE id=$1", f.ID); err != nil {
		t.Fatal(err)
	}
	manifest := MerchantCatalogImportChange{SourceSHA256: strings.Repeat("a", 64), Rows: []MerchantCatalogImportRow{
		{Row: 2, Name: a.Name, OfferID: a.ID, ExpectedVersion: 1, PriceYER: "123", StockUnits: "4"},
		{Row: 3, Name: c.Name, OfferID: c.ID, ExpectedVersion: 2, PriceYER: "456", StockUnits: "5"},
		{Row: 4, Name: d.Name, OfferID: d.ID, ExpectedVersion: 1, PriceYER: "321", StockUnits: "2"},
		{Row: 5, Name: "duplicate", PriceYER: "1", StockUnits: "1"},
		{Row: 6, Name: f.Name, OfferID: f.ID, ExpectedVersion: 1, PriceYER: "999", StockUnits: "1"},
		{Row: 7, Name: "Unknown", PriceYER: "50", StockUnits: "0"},
	}}
	for i := 8; i < 28; i++ {
		manifest.Rows = append(manifest.Rows, MerchantCatalogImportRow{Row: i, Name: fmt.Sprintf("held-%d", i), SourceIssue: "INVALID_ROW"})
	}
	manifest.Rows = append(manifest.Rows, MerchantCatalogImportRow{Row: 28, Name: b.Name, OfferID: b.ID, ExpectedVersion: 1, PriceYER: "888", StockUnits: "6"})
	h, err := NewMerchantCatalogImportHandler(service)
	if err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	mux.Handle("/v1/stores/{storeID}/catalog-imports/{runID}", h)
	call := func(method string, body any) (int, MerchantCatalogImportResult) {
		t.Helper()
		var data string
		if body != nil {
			encoded, e := json.Marshal(body)
			if e != nil {
				t.Fatal(e)
			}
			data = string(encoded)
		}
		r := httptest.NewRequest(method, "/v1/stores/import-a/catalog-imports/import-0001", strings.NewReader(data))
		r.Header.Set("Authorization", "Bearer synthetic")
		r.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, r)
		var result MerchantCatalogImportResult
		if w.Code == 200 && json.Unmarshal(w.Body.Bytes(), &result) != nil {
			t.Fatalf("invalid response %s", w.Body.String())
		}
		return w.Code, result
	}
	if code, r := call("PUT", manifest); code != 200 || r.Total != 27 || len(r.Outcomes) != 0 {
		t.Fatalf("start %d %+v", code, r)
	}
	changed := manifest
	changed.Rows = append([]MerchantCatalogImportRow(nil), manifest.Rows...)
	changed.Rows[0].PriceYER = "124"
	if code, _ := call("PUT", changed); code != 409 {
		t.Fatalf("mutated run %d", code)
	}
	if _, e := other.CatalogImport(ctx, "synthetic", "import-a", "import-0001", nil, true, 0); !errors.Is(e, ErrForbidden) {
		t.Fatalf("foreign grant %v", e)
	}
	// Revocation after the actor was resolved must roll back both row
	// receipts and edits, not only suppress the HTTP acknowledgement.
	revoked := &MerchantStoreRegistrar{identity: &changingMerchantIdentity{}, grants: service.grants}
	if _, e := revoked.CatalogImport(ctx, "synthetic", "import-a", "import-0001", nil, true, 0); !errors.Is(e, ErrUnknownResult) {
		t.Fatalf("revoked transaction returned %v", e)
	}
	if code, r := call("GET", nil); code != 200 || r.Processed != 0 || len(r.Outcomes) != 0 {
		t.Fatalf("revoked transaction leaked durable effects %d %+v", code, r)
	}
	var versionAfterRevocation int64
	if e := db.QueryRowContext(ctx, "SELECT draft_version FROM "+schema+".offers WHERE id=$1", a.ID).Scan(&versionAfterRevocation); e != nil || versionAfterRevocation != 1 {
		t.Fatalf("revoked edit version=%d err=%v", versionAfterRevocation, e)
	}
	if code, r := call("PATCH", nil); code != 200 || len(r.Outcomes) != 25 {
		t.Fatalf("first chunk %d %+v", code, r)
	}
	if code, r := call("GET", nil); code != 200 || len(r.Outcomes) != 25 {
		t.Fatalf("durable read %d %+v", code, r)
	}
	code, result := call("PATCH", nil)
	if code != 200 || result.Processed != 27 || result.Offset != 25 || len(result.Outcomes) != 2 {
		t.Fatalf("second chunk %d %+v", code, result)
	}
	_, firstPage := call("GET", nil)
	if firstPage.Outcomes[0].Status != "ACCEPTED" || firstPage.Outcomes[0].ResultVersion != 2 || firstPage.Outcomes[1].Reason != "STALE_VERSION_OR_NAME" ||
		firstPage.Outcomes[2].Reason != "DUPLICATE" || firstPage.Outcomes[3].Reason != "DUPLICATE" || firstPage.Outcomes[4].Reason != "INELIGIBLE" ||
		firstPage.Outcomes[5].Status != "HELD" || firstPage.Outcomes[6].Reason != "INVALID_VALUES" || result.Outcomes[1].Status != "ACCEPTED" {
		t.Fatalf("unexpected outcomes %+v", result.Outcomes)
	}
	if code, r := call("PATCH", nil); code != 200 || r.Processed != 27 || len(r.Outcomes) != 0 {
		t.Fatalf("completed retry %d %+v", code, r)
	}
	independent, err := sql.Open("postgres", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer independent.Close()
	var accepted, edits, products int
	if err = independent.QueryRowContext(ctx, "SELECT count(*) FROM "+schema+".catalog_import_outcomes WHERE status='ACCEPTED'").Scan(&accepted); err != nil || accepted != 2 {
		t.Fatalf("accepted=%d %v", accepted, err)
	}
	if err = independent.QueryRowContext(ctx, "SELECT count(*) FROM "+schema+".catalog_draft_edit_commands").Scan(&edits); err != nil || edits != 2 {
		t.Fatalf("edits=%d %v", edits, err)
	}
	if err = independent.QueryRowContext(ctx, "SELECT count(*) FROM "+schema+".products").Scan(&products); err != nil || products != 5 {
		t.Fatalf("products=%d %v", products, err)
	}
	var price, version, stock int64
	if err = independent.QueryRowContext(ctx, "SELECT price_yer,draft_version,stock_units FROM "+schema+".offers WHERE id=$1", a.ID).Scan(&price, &version, &stock); err != nil || price != 123 || version != 2 || stock != 4 {
		t.Fatalf("durable offer: %d %d %d %v", price, version, stock, err)
	}
	// The database itself refuses receipts pointing at another Store or an
	// accepted edit without a version, independently of the HTTP checks.
	for _, tc := range []struct {
		store, status, reason, offer, state string
		version                             any
	}{
		{"import-b", "HELD", "UNSELECTED", "", "23503", nil},
		{"import-a", "ACCEPTED", "UPDATED", a.ID, "23514", nil},
	} {
		_, err = independent.ExecContext(ctx, "INSERT INTO "+schema+`.catalog_import_outcomes
			(actor_id,run_id,store_id,row_number,status,reason,offer_id,result_version)
			VALUES ('merchant-a','import-0001',$1,29,$2,$3,NULLIF($4,''),$5)`, tc.store, tc.status, tc.reason, tc.offer, tc.version)
		var pgErr interface{ SQLState() string }
		if !errors.As(err, &pgErr) || pgErr.SQLState() != tc.state {
			t.Fatalf("receipt integrity: expected %s, got %v", tc.state, err)
		}
	}
	_, err = independent.ExecContext(ctx, "INSERT INTO "+schema+`.catalog_import_runs
		(actor_id,run_id,store_id,request_hash,manifest) VALUES ('merchant-a','invalid-run-0001','import-a',repeat('a',64),'{}')`)
	var pgErr interface{ SQLState() string }
	if !errors.As(err, &pgErr) || pgErr.SQLState() != "23514" {
		t.Fatalf("invalid manifest accepted: %v", err)
	}
	if _, err = independent.ExecContext(ctx, "DELETE FROM "+schema+".catalog_import_outcomes"); err == nil {
		t.Fatal("mutable receipt")
	}
	if _, err = independent.ExecContext(ctx, "UPDATE "+schema+".catalog_import_runs SET request_hash=repeat('b',64)"); err == nil {
		t.Fatal("mutable run")
	}
}

func TestCatalogImportStoredManifestRequiresExactRepresentation(t *testing.T) {
	change := MerchantCatalogImportChange{SourceSHA256: strings.Repeat("a", 64), Rows: []MerchantCatalogImportRow{{Row: 2, Name: "", PriceYER: "", StockUnits: ""}}}
	manifest, digest, err := encodeCatalogImportManifest("import-0001", change)
	if err != nil {
		t.Fatal(err)
	}
	for _, bad := range []string{
		strings.Replace(string(manifest), `"name":"",`, "", 1),
		strings.Replace(string(manifest), `"name":""`, `"name":null`, 1),
		strings.Replace(string(manifest), `"name":""`, `"Name":""`, 1),
		strings.Replace(string(manifest), `"name":""`, `"name":"other","name":""`, 1),
		strings.Replace(string(manifest), `"name":""`, `"name":"","unknown":true`, 1),
		strings.Replace(string(manifest), `"name":""`, `"name":"","offerId":null`, 1),
		strings.Replace(string(manifest), `"name":""`, `"name":"","expectedVersion":0`, 1),
		strings.Replace(string(manifest), `"name":""`, `"name":"","sourceIssue":""`, 1),
	} {
		if _, err := decodeCatalogImportManifest("import-0001", digest, []byte(bad)); !errors.Is(err, ErrStoreOwnerUnavailable) {
			t.Errorf("ambiguous manifest admitted: %s", bad)
		}
	}
	if _, err := decodeCatalogImportManifest("import-0001", digest, manifest); err != nil {
		t.Fatal(err)
	}
}
