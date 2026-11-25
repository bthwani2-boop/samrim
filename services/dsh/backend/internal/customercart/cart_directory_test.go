package customercart

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestCartDirectoryRejectsInvalidScope(t *testing.T) {
	h, err := NewHandler(&sql.DB{}, "dsh_test_directory", cartSessionAdapter{&testSession{}})
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		path, token, body string
		status            int
	}{
		{"/v1/carts", "", "", 401},
		{"/v1/carts", "merchant-a", "", 403},
		{"/v1/carts?actorId=customer-b", "", "", 400},
		{"/v1/carts?after=a&after=b", "", "", 400},
		{"/v1/carts?after=BAD", "", "", 400},
		{"/v1/carts", "", "unexpected", 400},
	} {
		req := httptest.NewRequest(http.MethodGet, tc.path, strings.NewReader(tc.body))
		if tc.token != "" {
			req.Header.Set("Authorization", "Bearer "+cartTestBearer(tc.token))
		}
		rr := httptest.NewRecorder()
		h.ServeHTTP(rr, req)
		if rr.Code != tc.status || rr.Header().Get("Cache-Control") != "no-store" {
			t.Errorf("%s: got %d, want %d; %s", tc.path, rr.Code, tc.status, rr.Body.String())
		}
	}
}

func verifyCartDirectoryOnPostgres(t *testing.T, ctx context.Context, db *sql.DB, schema string, h http.Handler) {
	t.Helper()
	exec := func(query string) {
		t.Helper()
		if _, err := db.ExecContext(ctx, query); err != nil {
			t.Fatal(err)
		}
	}
	read := func(actor, after string) cartDirectoryPage {
		t.Helper()
		req := httptest.NewRequest(http.MethodGet, "/v1/carts"+after, nil)
		req.Header.Set("Authorization", "Bearer "+cartTestBearer(actor))
		req.Header.Set("X-Actor-ID", "customer-b")
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		assertCartStatus(t, rec.Code, 200, rec.Body.Bytes())
		var page cartDirectoryPage
		if err := json.Unmarshal(rec.Body.Bytes(), &page); err != nil {
			t.Fatal(err)
		}
		if page.ActorID != actor || page.Carts == nil {
			t.Fatalf("invalid actor or null list: %s", rec.Body.String())
		}
		return page
	}
	first := read("customer-a", "")
	if len(first.Carts) != 1 || first.Carts[0] != (cartDirectoryEntry{StoreID: "store-a", StoreName: "Test Store", Version: 1, LineCount: 1}) {
		t.Fatalf("unexpected owner page: %+v", first)
	}
	if page := read("customer-b", ""); len(page.Carts) != 0 {
		t.Fatalf("cross actor leak: %+v", page)
	}
	if page := read("customer-a", "?after=store-a"); len(page.Carts) != 0 {
		t.Fatalf("cursor repeated cart: %+v", page)
	}
	// Only these synthetic rows in the disposable database are created for this proof.
	exec("INSERT INTO " + schema + ".customer_carts(actor_id,store_id,version) VALUES ('customer-b','store-a',1),('customer-b','store-b',1)")
	exec("INSERT INTO " + schema + ".customer_cart_lines(actor_id,store_id,offer_id,quantity) VALUES ('customer-b','store-b','offer-b',1)")
	if page := read("customer-b", ""); len(page.Carts) != 1 || page.Carts[0].StoreID != "store-b" {
		t.Fatalf("empty cart not excluded or wrong scope: %+v", page)
	}
	exec("UPDATE " + schema + ".stores SET published=false WHERE id='store-b'")
	if page := read("customer-b", ""); len(page.Carts) != 1 || page.Carts[0].StoreName != "" {
		t.Fatalf("hidden Store name disclosed or draft omitted: %+v", page)
	}
	exec("UPDATE " + schema + ".stores SET published=true WHERE id='store-b'")
	exec("DELETE FROM " + schema + ".customer_carts WHERE actor_id='customer-b' AND store_id IN ('store-a','store-b')")
	// Verify original persisted draft was neither changed nor reserved.
	var version int64
	var count int
	if err := db.QueryRowContext(ctx, "SELECT version FROM "+schema+".customer_carts WHERE actor_id='customer-a' AND store_id='store-a'").Scan(&version); err != nil || version != 1 {
		t.Fatalf("owner version changed: %d %v", version, err)
	}
	if err := db.QueryRowContext(ctx, "SELECT count(*) FROM "+schema+".customer_cart_lines WHERE actor_id='customer-a' AND store_id='store-a'").Scan(&count); err != nil || count != 1 {
		t.Fatalf("owner lines changed: %d %v", count, err)
	}
	t.Log("CART_DIRECTORY_OWNER_READBACK_PASS actor isolation, empty exclusion, hidden Store name, cursor and durable no-write")
}
