package customercart

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/identityaccess"
)

// Every favorite response is private, including errors. Check the complete
// public error envelope rather than treating a matching HTTP status as parity.
func favoriteCall(t *testing.T, h http.Handler, method, suffix, actor, body string, status int, code string) map[string]any {
	t.Helper()
	r := httptest.NewRequest(method, "/v1/customers/me/favorite-stores"+suffix, strings.NewReader(body))
	if actor != "" {
		r.Header.Set("Authorization", "Bearer "+cartTestBearer(actor))
	}
	r.Header.Set("X-Actor-ID", "foreign-customer")
	if body != "" {
		r.Header.Set("Content-Type", "application/json")
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	assertCartStatus(t, w.Code, status, w.Body.Bytes())
	for name, want := range map[string]string{
		"Content-Type":           "application/json",
		"Cache-Control":          "no-store",
		"X-Content-Type-Options": "nosniff",
	} {
		if got := w.Header().Get(name); got != want {
			t.Fatalf("%s = %q, want %q", name, got, want)
		}
	}
	var value map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &value); err != nil || value == nil {
		t.Fatalf("invalid favorite response: %s (%v)", w.Body.Bytes(), err)
	}
	if code != "" && !reflect.DeepEqual(value, map[string]any{"error": code}) {
		t.Fatalf("favorite error = %v, want exactly %s", value, code)
	}
	return value
}

func assertFavoriteState(t *testing.T, value map[string]any, actor, store string, favorite bool) {
	t.Helper()
	want := map[string]any{"actorId": actor, "storeId": store, "favorite": favorite}
	if !reflect.DeepEqual(value, want) {
		t.Fatalf("favorite state = %v, want %v", value, want)
	}
}

func assertFavoritePage(t *testing.T, value map[string]any, actor, cursor string, ids ...string) {
	t.Helper()
	storeIDs := make([]any, len(ids))
	for i, id := range ids {
		storeIDs[i] = id
	}
	want := map[string]any{"actorId": actor, "storeIds": storeIDs}
	if cursor != "" {
		want["nextCursor"] = cursor
	}
	if !reflect.DeepEqual(value, want) {
		t.Fatalf("favorite page = %v, want %v", value, want)
	}
}

// Inject a failure only at an Identity verification boundary. SQL is real
// in the owner test; this adapter proves controlled failure, not live Identity.
type favoriteIdentityFailure struct {
	delegate Identity
	failAt   int
	calls    int
}

func (f *favoriteIdentityFailure) ResolveCurrentSession(ctx context.Context, token string) (identityaccess.VerifiedActor, error) {
	f.calls++
	if f.calls == f.failAt {
		return identityaccess.VerifiedActor{}, identityaccess.ErrIdentityUnavailable
	}
	return f.delegate.ResolveCurrentSession(ctx, token)
}

func TestFavoriteStoreRequiresCurrentCustomer(t *testing.T) {
	h, err := NewHandler(&sql.DB{}, "dsh_test_favorite", cartSessionAdapter{&testSession{}})
	if err != nil {
		t.Fatal(err)
	}
	for _, c := range []struct {
		name, method, suffix, actor, body string
		status                            int
		code                              string
	}{
		{"anonymous-list", "GET", "", "", "", 401, "UNAUTHORIZED_OR_OWNER_UNAVAILABLE"},
		{"anonymous-write", "PUT", "/store-a", "", `{"favorite":true}`, 401, "UNAUTHORIZED_OR_OWNER_UNAVAILABLE"},
		{"foreign-role", "GET", "/store-a", "merchant-a", "", 403, "UNAUTHORIZED_OR_OWNER_UNAVAILABLE"},
		{"actor-selector", "GET", "?actorId=customer-b", "customer-a", "", 400, "INVALID_REQUEST"},
		{"duplicate-cursor", "GET", "?after=store-a&after=store-b", "customer-a", "", 400, "INVALID_REQUEST"},
		{"invalid-cursor", "GET", "?after=invalid!", "customer-a", "", 400, "INVALID_REQUEST"},
		{"invalid-store", "GET", "/invalid!", "customer-a", "", 400, "INVALID_REQUEST"},
		{"item-query", "GET", "/store-a?actorId=customer-b", "customer-a", "", 400, "INVALID_REQUEST"},
		{"read-body", "GET", "", "customer-a", `{}`, 400, "INVALID_REQUEST"},
		{"duplicate-command", "PUT", "/store-a", "customer-a", `{"favorite":true,"favorite":false}`, 400, "INVALID_REQUEST"},
		{"foreign-actor-command", "PUT", "/store-a", "customer-a", `{"favorite":true,"actorId":"customer-b"}`, 400, "INVALID_REQUEST"},
		{"null-command", "PUT", "/store-a", "customer-a", `{"favorite":null}`, 400, "INVALID_REQUEST"},
		{"missing-command", "PUT", "/store-a", "customer-a", `{}`, 400, "INVALID_REQUEST"},
		{"trailing-command", "PUT", "/store-a", "customer-a", `{"favorite":true}{}`, 400, "INVALID_REQUEST"},
	} {
		t.Run(c.name, func(t *testing.T) {
			favoriteCall(t, h, c.method, c.suffix, c.actor, c.body, c.status, c.code)
		})
	}
	t.Run("identity-unavailable", func(t *testing.T) {
		fault := &favoriteIdentityFailure{delegate: cartSessionAdapter{&testSession{}}, failAt: 1}
		handler, err := NewHandler(&sql.DB{}, "dsh_test_favorite", fault)
		if err != nil {
			t.Fatal(err)
		}
		favoriteCall(t, handler, "GET", "", "customer-a", "", 503, "UNAUTHORIZED_OR_OWNER_UNAVAILABLE")
		if fault.calls != 1 {
			t.Fatalf("unexpected Identity verification count: %d", fault.calls)
		}
	})
}

func verifyFavoritesOnRealPostgres(t *testing.T, ctx context.Context, db *sql.DB, schema string, h http.Handler, sessions *testSession) {
	t.Helper()
	const customer = "customer-a"
	const foreign = "customer-b"
	const store = "store-a"
	const add = `{"favorite":true}`
	const remove = `{"favorite":false}`
	call := func(method, suffix, actor, body string) map[string]any {
		t.Helper()
		return favoriteCall(t, h, method, suffix, actor, body, 200, "")
	}
	count := func(id string, want int) {
		t.Helper()
		var got int
		err := db.QueryRowContext(ctx, "SELECT count(*) FROM "+schema+".customer_favorite_stores WHERE actor_id=$1 AND store_id=$2", customer, id).Scan(&got)
		if err != nil || got != want {
			t.Fatalf("durable favorite %s count %d, want %d: %v", id, got, want, err)
		}
	}
	exec := func(query string) {
		t.Helper()
		if _, err := db.ExecContext(ctx, query); err != nil {
			t.Fatal(err)
		}
	}
	assertFavoriteState(t, call("PUT", "/"+store, customer, add), customer, store, true)
	assertFavoriteState(t, call("PUT", "/"+store, customer, add), customer, store, true)
	assertFavoriteState(t, call("GET", "/"+store, foreign, ""), foreign, store, false)
	assertFavoritePage(t, call("GET", "", customer, ""), customer, "", store)
	assertFavoritePage(t, call("GET", "", foreign, ""), foreign, "")
	count(store, 1)
	favoriteCall(t, h, "PUT", "/unknown", customer, add, 404, "STORE_UNAVAILABLE")
	count("unknown", 0)

	exec("UPDATE " + schema + ".stores SET published=false WHERE id='store-a'")
	assertFavoritePage(t, call("GET", "", customer, ""), customer, "")
	assertFavoriteState(t, call("GET", "/"+store, customer, ""), customer, store, false)
	favoriteCall(t, h, "PUT", "/"+store, customer, add, 404, "STORE_UNAVAILABLE")
	count(store, 1)
	assertFavoriteState(t, call("PUT", "/"+store, customer, remove), customer, store, false)
	count(store, 0)
	exec("UPDATE " + schema + ".stores SET published=true WHERE id='store-a'")

	// Verify both sides of the durable transaction boundary. Losing Identity
	// before commit denies the write; losing it after commit is unknown to
	// the caller, not an invitation to blindly repeat the mutation.
	for _, failure := range []struct {
		at, persisted int
		code          string
	}{
		{2, 0, "UNAUTHORIZED_OR_OWNER_UNAVAILABLE"},
		{3, 1, "OPERATION_RESULT_UNKNOWN"},
	} {
		fault := &favoriteIdentityFailure{delegate: cartSessionAdapter{sessions}, failAt: failure.at}
		handler, err := NewHandler(db, schema, fault)
		if err != nil {
			t.Fatal(err)
		}
		favoriteCall(t, handler, "PUT", "/"+store, customer, add, 503, failure.code)
		if fault.calls != failure.at {
			t.Fatalf("unexpected Identity verification count: %d, want %d", fault.calls, failure.at)
		}
		count(store, failure.persisted)
		assertFavoriteState(t, call("GET", "/"+store, customer, ""), customer, store, failure.persisted == 1)
		assertFavoriteState(t, call("PUT", "/"+store, customer, remove), customer, store, false)
		count(store, 0)
	}

	// A read must not publish a private response after a failed final check.
	fault := &favoriteIdentityFailure{delegate: cartSessionAdapter{sessions}, failAt: 3}
	handler, err := NewHandler(db, schema, fault)
	if err != nil {
		t.Fatal(err)
	}
	favoriteCall(t, handler, "GET", "", customer, "", 503, "UNAUTHORIZED_OR_OWNER_UNAVAILABLE")
	assertFavoritePage(t, call("GET", "", customer, ""), customer, "")

	// Only disposable fixture rows are created; the shared cart seed is preserved.
	exec("INSERT INTO " + schema + ".stores(id,owner_actor_id,city_id,vertical_id,relation,name,published) SELECT 'favorite-page-'||lpad(i::text,2,'0'),'merchant-a','sanaa','grocery','MARKETPLACE','Favorite fixture',true FROM generate_series(1,21) i")
	ids := make([]string, 21)
	for i := range ids {
		ids[i] = fmt.Sprintf("favorite-page-%02d", i+1)
		assertFavoriteState(t, call("PUT", "/"+ids[i], customer, add), customer, ids[i], true)
	}
	assertFavoritePage(t, call("GET", "", customer, ""), customer, ids[19], ids[:20]...)
	assertFavoritePage(t, call("GET", "?after="+ids[19], customer, ""), customer, "", ids[20])
	assertFavoritePage(t, call("GET", "?after="+ids[20], customer, ""), customer, "")

	sessions.mu.Lock()
	sessions.revoked = true
	sessions.mu.Unlock()
	defer func() {
		sessions.mu.Lock()
		sessions.revoked = false
		sessions.mu.Unlock()
	}()
	favoriteCall(t, h, "GET", "", customer, "", 401, "UNAUTHORIZED_OR_OWNER_UNAVAILABLE")
	favoriteCall(t, h, "PUT", "/"+ids[0], customer, remove, 401, "UNAUTHORIZED_OR_OWNER_UNAVAILABLE")
	sessions.mu.Lock()
	sessions.revoked = false
	sessions.mu.Unlock()
	assertFavoriteState(t, call("GET", "/"+ids[0], customer, ""), customer, ids[0], true)
	count(ids[0], 1)
	assertFavoriteState(t, call("PUT", "/store-b", customer, add), customer, "store-b", true)
	assertFavoriteState(t, call("GET", "/store-b", customer, ""), customer, "store-b", true)
	assertFavoriteState(t, call("PUT", "/store-b", customer, remove), customer, "store-b", false)
	count("store-b", 0)
	exec("DELETE FROM " + schema + ".customer_favorite_stores WHERE actor_id='customer-a' AND store_id LIKE 'favorite-page-%'; DELETE FROM " + schema + ".stores WHERE id LIKE 'favorite-page-%'")
	t.Log("FAVORITE_OWNER_CONTRACT_PASS exact errors, private headers, persisted boundary failure, pagination, isolation and recovery")
}
