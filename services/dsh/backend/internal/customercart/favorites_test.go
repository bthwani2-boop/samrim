package customercart

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func favoriteRequest(t *testing.T, h http.Handler, method, suffix, actor, body string) (int, []byte) {
	t.Helper()
	r := httptest.NewRequest(method, "/v1/customers/me/favorite-stores"+suffix, strings.NewReader(body))
	if actor != "" {
		r.Header.Set("Authorization", "Bearer "+cartTestBearer(actor))
	}
	if body != "" {
		r.Header.Set("Content-Type", "application/json")
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w.Code, w.Body.Bytes()
}

func TestFavoriteStoreRequiresCurrentCustomer(t *testing.T) {
	h, err := NewHandler(&sql.DB{}, "dsh_test_favorite", cartSessionAdapter{&testSession{}})
	if err != nil {
		t.Fatal(err)
	}
	for _, c := range []struct {
		method, suffix, actor, body string
		status                      int
	}{
		{"GET", "", "", "", 401},
		{"GET", "/store-a", "merchant-a", "", 403},
		{"GET", "?actorId=customer-b", "customer-a", "", 400},
		{"PUT", "/store-a", "customer-a", `{"favorite":true,"favorite":false}`, 400},
		{"PUT", "/store-a", "customer-a", `{"favorite":true,"actorId":"customer-b"}`, 400},
	} {
		got, body := favoriteRequest(t, h, c.method, c.suffix, c.actor, c.body)
		assertCartStatus(t, got, c.status, body)
	}
}

func verifyFavoritesOnRealPostgres(t *testing.T, ctx context.Context, db *sql.DB, schema string, h http.Handler, sessions *testSession) {
	t.Helper()
	call := func(method, suffix, actor, body string, want int) map[string]any {
		t.Helper()
		got, raw := favoriteRequest(t, h, method, suffix, actor, body)
		assertCartStatus(t, got, want, raw)
		var value map[string]any
		if err := json.Unmarshal(raw, &value); err != nil {
			t.Fatal(err)
		}
		return value
	}
	state := call("PUT", "/store-a", "customer-a", `{"favorite":true}`, 200)
	if state["favorite"] != true || state["actorId"] != "customer-a" {
		t.Fatalf("wrong state: %v", state)
	}
	call("PUT", "/store-a", "customer-a", `{"favorite":true}`, 200)
	if call("GET", "/store-a", "customer-b", "", 200)["favorite"] != false {
		t.Fatal("foreign favorite leaked")
	}
	if list := call("GET", "", "customer-a", "", 200)["storeIds"].([]any); len(list) != 1 || list[0] != "store-a" {
		t.Fatalf("wrong list %v", list)
	}
	if list := call("GET", "", "customer-b", "", 200)["storeIds"].([]any); len(list) != 0 {
		t.Fatal("foreign list leaked")
	}
	var count int
	if err := db.QueryRowContext(ctx, "SELECT count(*) FROM "+schema+".customer_favorite_stores WHERE actor_id='customer-a' AND store_id='store-a'").Scan(&count); err != nil || count != 1 {
		t.Fatalf("durable favorite count %d: %v", count, err)
	}
	call("PUT", "/unknown", "customer-a", `{"favorite":true}`, 404)
	if _, err := db.ExecContext(ctx, "UPDATE "+schema+".stores SET published=false WHERE id='store-a'"); err != nil {
		t.Fatal(err)
	}
	if list := call("GET", "", "customer-a", "", 200)["storeIds"].([]any); len(list) != 0 {
		t.Fatal("unpublished store leaked")
	}
	if call("GET", "/store-a", "customer-a", "", 200)["favorite"] != false {
		t.Fatal("unpublished favorite leaked")
	}
	call("PUT", "/store-a", "customer-a", `{"favorite":false}`, 200)
	if err := db.QueryRowContext(ctx, "SELECT count(*) FROM "+schema+".customer_favorite_stores WHERE actor_id='customer-a' AND store_id='store-a'").Scan(&count); err != nil || count != 0 {
		t.Fatalf("durable removal %d: %v", count, err)
	}
	if _, err := db.ExecContext(ctx, "UPDATE "+schema+".stores SET published=true WHERE id='store-a'"); err != nil {
		t.Fatal(err)
	}
	// Use only the disposable fixture rows and preserve the shared cart seed.
	if _, err := db.ExecContext(ctx, "INSERT INTO "+schema+".stores(id,owner_actor_id,city_id,vertical_id,relation,name,published) SELECT 'favorite-page-'||lpad(i::text,2,'0'),'merchant-a','sanaa','grocery','MARKETPLACE','Favorite fixture',true FROM generate_series(1,21) i"); err != nil {
		t.Fatal(err)
	}
	for i := 1; i <= 21; i++ {
		call("PUT", fmt.Sprintf("/favorite-page-%02d", i), "customer-a", `{"favorite":true}`, 200)
	}
	first := call("GET", "", "customer-a", "", 200)
	if ids := first["storeIds"].([]any); len(ids) != 20 || ids[0] != "favorite-page-01" || ids[19] != "favorite-page-20" || first["nextCursor"] != "favorite-page-20" {
		t.Fatalf("invalid first page: %v", first)
	}
	next := call("GET", "?after=favorite-page-20", "customer-a", "", 200)
	if ids := next["storeIds"].([]any); len(ids) != 1 || ids[0] != "favorite-page-21" || next["nextCursor"] != nil {
		t.Fatalf("invalid next page: %v", next)
	}
	sessions.mu.Lock()
	sessions.revoked = true
	sessions.mu.Unlock()
	call("GET", "", "customer-a", "", 401)
	call("PUT", "/favorite-page-01", "customer-a", `{"favorite":false}`, 401)
	sessions.mu.Lock()
	sessions.revoked = false
	sessions.mu.Unlock()
	if call("GET", "/favorite-page-01", "customer-a", "", 200)["favorite"] != true {
		t.Fatal("revoked session mutated favorite")
	}
	call("PUT", "/store-b", "customer-a", `{"favorite":true}`, 200)
	if call("GET", "/store-b", "customer-a", "", 200)["favorite"] != true {
		t.Fatal("published DIRECT favorite not retained")
	}
	call("PUT", "/store-b", "customer-a", `{"favorite":false}`, 200)
	if _, err := db.ExecContext(ctx, "DELETE FROM "+schema+".customer_favorite_stores WHERE actor_id='customer-a' AND store_id LIKE 'favorite-page-%'; DELETE FROM "+schema+".stores WHERE id LIKE 'favorite-page-%'"); err != nil {
		t.Fatal(err)
	}
}
