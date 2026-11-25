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
	// Dedicated paging proof: 21 nonempty drafts plus one empty, isolated actor.
	exec("INSERT INTO " + schema + ".stores(id,owner_actor_id,city_id,vertical_id,relation,name,published) SELECT 'page-'||lpad(n::text,2,'0'),'merchant-a','sanaa','grocery','MARKETPLACE','Paging Store '||n,true FROM generate_series(1,22) n")
	exec("INSERT INTO " + schema + ".products(id,store_id,name,active) SELECT 'page-product-'||n,'page-'||lpad(n::text,2,'0'),'Paging Product',true FROM generate_series(1,21) n")
	exec("INSERT INTO " + schema + ".variants(id,product_id,sellable,required_attributes_valid) SELECT 'page-variant-'||n,'page-product-'||n,true,true FROM generate_series(1,21) n")
	exec("INSERT INTO " + schema + ".offers(id,store_id,product_id,variant_id,published,available,price_yer,stock_units) SELECT 'page-offer-'||n,'page-'||lpad(n::text,2,'0'),'page-product-'||n,'page-variant-'||n,true,true,550,10 FROM generate_series(1,21) n")
	exec("INSERT INTO " + schema + ".customer_carts(actor_id,store_id,version) SELECT 'customer-b','page-'||lpad(n::text,2,'0'),1 FROM generate_series(1,22) n")
	exec("INSERT INTO " + schema + ".customer_cart_lines(actor_id,store_id,offer_id,quantity) SELECT 'customer-b','page-'||lpad(n::text,2,'0'),'page-offer-'||n,1 FROM generate_series(1,21) n")
	p1 := read("customer-b", "")
	if len(p1.Carts) != 20 || p1.Carts[0].StoreID != "page-01" || p1.Carts[19].StoreID != "page-20" || p1.NextCursor != "page-20" {
		t.Fatalf("first page wrong: %+v", p1)
	}
	p2 := read("customer-b", "?after="+p1.NextCursor)
	if len(p2.Carts) != 1 || p2.Carts[0].StoreID != "page-21" || p2.NextCursor != "" {
		t.Fatalf("second page wrong: %+v", p2)
	}
	if p3 := read("customer-b", "?after=page-21"); len(p3.Carts) != 0 || p3.NextCursor != "" {
		t.Fatalf("tail wrong: %+v", p3)
	}
	if p := read("customer-a", ""); len(p.Carts) != 1 || p.Carts[0].StoreID != "store-a" || p.NextCursor != "" {
		t.Fatalf("cross-actor leak: %+v", p)
	}
	var pageCount, lineCount, versionSum int
	if err := db.QueryRowContext(ctx, "SELECT count(*),sum(version) FROM "+schema+".customer_carts WHERE actor_id='customer-b'").Scan(&pageCount, &versionSum); err != nil || pageCount != 22 || versionSum != 22 {
		t.Fatalf("cart write detected %d/%d %v", pageCount, versionSum, err)
	}
	if err := db.QueryRowContext(ctx, "SELECT count(*) FROM "+schema+".customer_cart_lines WHERE actor_id='customer-b'").Scan(&lineCount); err != nil || lineCount != 21 {
		t.Fatalf("line write detected %d %v", lineCount, err)
	}
	t.Log("PAGING_OWNER_PROOF_PASS: 20+1+0, empty excluded, actor separated, 22 carts/21 lines unchanged")
	exec("DELETE FROM " + schema + ".customer_carts WHERE actor_id='customer-b' AND store_id LIKE 'page-%'")
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
