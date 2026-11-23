package storeavailability

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
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
	source, err := os.ReadFile(filepath.Join("..", "..", "..", "database", "migrations", "001_public_discovery.sql"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = db.ExecContext(ctx, strings.ReplaceAll(string(source), "__SCHEMA__", schema)); err != nil {
		t.Fatal(err)
	}
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
}
