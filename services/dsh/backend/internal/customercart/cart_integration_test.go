package customercart

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/discovery"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storeavailability"
	_ "github.com/lib/pq"
)

// Simulate a response that disappears only after the transaction committed.
type closedAck struct {
	header http.Header
	status int
}

func (w *closedAck) Header() http.Header    { return w.header }
func (w *closedAck) WriteHeader(status int) { w.status = status }
func (w *closedAck) Write(_ []byte) (int, error) {
	if w.status == 0 {
		w.status = 200
	}
	return 0, io.ErrClosedPipe
}

type testSession struct {
	mu      sync.Mutex
	revoked bool
}

func (s *testSession) ResolveCurrentSession(_ context.Context, token string) (storeavailability.VerifiedActor, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.revoked || token == "revoked" {
		return storeavailability.VerifiedActor{}, storeavailability.ErrUnauthorized
	}
	switch token {
	case "customer-a":
		return storeavailability.VerifiedActor{Subject: "customer-a", Role: "CUSTOMER"}, nil
	case "customer-b":
		return storeavailability.VerifiedActor{Subject: "customer-b", Role: "CUSTOMER"}, nil
	case "merchant-a":
		return storeavailability.VerifiedActor{Subject: "merchant-a", Role: "MERCHANT"}, nil
	}
	return storeavailability.VerifiedActor{}, storeavailability.ErrUnauthorized
}
func jsonCartRequest(t *testing.T, method, store, token string, body any) *http.Request {
	t.Helper()
	var reader io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		reader = bytes.NewReader(b)
	}
	request := httptest.NewRequest(method, "/v1/carts/"+store, reader)
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		// Production uses a canonical 32-byte opaque bearer, never a client actor.
		request.Header.Set("Authorization", "Bearer "+cartTestBearer(token))
	}
	request.Header.Set("X-Actor-ID", "customer-b")
	return request
}
func cartTestBearer(key string) string {
	switch key {
	case "customer-a":
		return "AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA"
	case "customer-b":
		return "AgMEBQYHCAkKCwwNDg8QERITFBUWFxgZGhscHR4fICE"
	case "merchant-a":
		return "AwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8gISI"
	default:
		return "AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA"
	}
}
func (s *testSession) ResolveSessionByBearer(token string) (storeavailability.VerifiedActor, error) {
	switch token {
	case cartTestBearer("customer-a"):
		return s.ResolveCurrentSession(context.Background(), "customer-a")
	case cartTestBearer("customer-b"):
		return s.ResolveCurrentSession(context.Background(), "customer-b")
	case cartTestBearer("merchant-a"):
		return s.ResolveCurrentSession(context.Background(), "merchant-a")
	default:
		return storeavailability.VerifiedActor{}, storeavailability.ErrUnauthorized
	}
}

type cartSessionAdapter struct{ s *testSession }

func (a cartSessionAdapter) ResolveCurrentSession(_ context.Context, token string) (storeavailability.VerifiedActor, error) {
	return a.s.ResolveSessionByBearer(token)
}
func runCart(t *testing.T, h http.Handler, method, store, token string, body any) (int, []byte) {
	t.Helper()
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, jsonCartRequest(t, method, store, token, body))
	return rec.Code, rec.Body.Bytes()
}
func assertCartStatus(t *testing.T, got, want int, body []byte) {
	t.Helper()
	if got != want {
		t.Fatalf("Customer Cart HTTP %d expected %d: %s", got, want, body)
	}
}
func TestRealCustomerCartPostgres(t *testing.T) {
	if os.Getenv("BTHWANI_ISOLATED_TEST_MODE") != "true" || os.Getenv("DSH_CART_CI_TEST") != "true" {
		t.Skip("NOT_RUN: requires fresh isolated PostgreSQL Customer Cart owner stage")
	}
	ctx, cancel := context.WithTimeout(t.Context(), 45*time.Second)
	defer cancel()
	dsn := "postgres://bthwani_ci:synthetic-only@127.0.0.1:5432/bthwani_refoundation?sslmode=disable"
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	var dbname, role string
	if err = db.QueryRowContext(ctx, "SELECT current_database(), current_user").Scan(&dbname, &role); err != nil {
		t.Fatal(err)
	}
	if dbname != "bthwani_refoundation" || role != "bthwani_ci" {
		t.Fatal("Customer Cart fixture attempted a non-isolated database")
	}
	const schema = "dsh_test_cart_ci"
	root := os.Getenv("DSH_CART_TEST_MIGRATION_DIR")
	if root == "" {
		root = "/agent02/services/dsh/database/migrations"
	}
	owner, err := discovery.New(db, schema)
	if err != nil {
		t.Fatal(err)
	}
	for _, file := range []string{"001_public_discovery.sql", "007_customer_cart.sql"} {
		data, readErr := os.ReadFile(filepath.Join(root, file))
		if readErr != nil {
			t.Fatal(readErr)
		}
		if err = owner.Migrate(ctx, data); err != nil {
			t.Fatalf("reviewed DSH owner migration %s: %v", file, err)
		}
	}
	statements := []string{
		"INSERT INTO " + schema + ".service_cities VALUES ('sanaa',true)",
		"INSERT INTO " + schema + ".verticals VALUES ('grocery',true)",
		"INSERT INTO " + schema + ".stores(id,owner_actor_id,city_id,vertical_id,relation,name,published) VALUES ('store-a','merchant-a','sanaa','grocery','MARKETPLACE','Test Store',true),('store-b','merchant-a','sanaa','grocery','DIRECT','Other Store',true)",
		"INSERT INTO " + schema + ".products(id,store_id,name,active) VALUES ('product-a','store-a','Test Product',true),('product-b','store-b','Other Product',true)",
		"INSERT INTO " + schema + ".variants(id,product_id,sellable,required_attributes_valid) VALUES ('variant-a','product-a',true,true),('variant-b','product-b',true,true)",
		"INSERT INTO " + schema + ".offers(id,store_id,product_id,variant_id,published,available,price_yer,stock_units) VALUES ('offer-a','store-a','product-a','variant-a',true,true,550,10),('offer-b','store-b','product-b','variant-b',true,true,999,10)",
	}
	for _, query := range statements {
		if _, err = db.ExecContext(ctx, query); err != nil {
			t.Fatalf("seed error: %v query=%s", err, query)
		}
	}
	sessions := &testSession{}
	handler, err := NewHandler(db, schema, cartSessionAdapter{sessions})
	if err != nil {
		t.Fatal(err)
	}
	// The CI runner creates this separate disposable boundary fixture.
	// A DSH-looking schema name must not authorize Cart access there.
	boundaryDSN := "postgres://bthwani_ci:synthetic-only@127.0.0.1:5432/bthwani_dsh_boundary_fixture?sslmode=disable"
	boundaryDB, boundaryErr := sql.Open("postgres", boundaryDSN)
	if boundaryErr != nil {
		t.Fatal(boundaryErr)
	}
	defer boundaryDB.Close()
	boundaryHandler, boundaryErr := NewHandler(boundaryDB, schema, cartSessionAdapter{sessions})
	if boundaryErr != nil {
		t.Fatal(boundaryErr)
	}
	boundaryStatus, boundaryBody := runCart(t, boundaryHandler, "GET", "store-a", "customer-a", nil)
	assertCartStatus(t, boundaryStatus, 503, boundaryBody)
	if _, err = NewHandler(db, "public", cartSessionAdapter{sessions}); err == nil {
		t.Fatal("cart admitted unisolated schema")
	}
	for _, c := range []struct {
		method, store, token string
		status               int
	}{
		{"GET", "store-a", "", 401},
		{"PUT", "store-a", "", 400}, // missing JSON body
		{"GET", "store-a", "merchant-a", 403},
		{"GET", "store-a", "customer-b", 200},
		{"GET", "invalid!", "customer-a", 400},
	} {
		status, body := runCart(t, handler, c.method, c.store, c.token, nil)
		assertCartStatus(t, status, c.status, body)
	}
	input := map[string]any{"operationId": "cart-create-0001", "expectedVersion": 0,
		"lines": []map[string]any{{"offerId": "offer-a", "quantity": 2}}}
	status, body := runCart(t, handler, "PUT", "store-a", "customer-a", input)
	assertCartStatus(t, status, 200, body)
	var first ChangeResult
	if err = json.Unmarshal(body, &first); err != nil {
		t.Fatal(err)
	}
	if first.Replay || first.Cart.Version != 1 || first.Cart.ActorID != "customer-a" ||
		len(first.Cart.Lines) != 1 || first.Cart.Lines[0].PreviewUnitYER != "550" ||
		first.Cart.Lines[0].Quantity != 2 || !first.Cart.Lines[0].PreviewAvailable {
		t.Fatalf("invalid Cart owner result: %s", body)
	}
	status, body = runCart(t, handler, "PUT", "store-a", "customer-a", input)
	assertCartStatus(t, status, 200, body)
	var replay ChangeResult
	if err = json.Unmarshal(body, &replay); err != nil || !replay.Replay || replay.Cart.Version != 1 {
		t.Fatalf("Cart replay created another version: %s %v", body, err)
	}
	changed := map[string]any{"operationId": "cart-create-0001", "expectedVersion": 0,
		"lines": []map[string]any{{"offerId": "offer-a", "quantity": 3}}}
	status, body = runCart(t, handler, "PUT", "store-a", "customer-a", changed)
	assertCartStatus(t, status, 409, body)
	cross := map[string]any{"operationId": "cart-cross-store", "expectedVersion": 1,
		"lines": []map[string]any{{"offerId": "offer-b", "quantity": 1}}}
	status, body = runCart(t, handler, "PUT", "store-a", "customer-a", cross)
	assertCartStatus(t, status, 404, body)
	status, body = runCart(t, handler, "GET", "store-a", "customer-b", nil)
	assertCartStatus(t, status, 200, body)
	var empty Snapshot
	if err = json.Unmarshal(body, &empty); err != nil || empty.Version != 0 || len(empty.Lines) != 0 {
		t.Fatalf("cross actor leak: %s", body)
	}
	// Two distinct mutations at the same expectedVersion serialize on the
	// same DSH-owned Cart row. Exactly one may advance the durable version.
	contenders := []map[string]any{
		{"operationId": "cart-race-first", "expectedVersion": 1, "lines": []map[string]any{{"offerId": "offer-a", "quantity": 3}}},
		{"operationId": "cart-race-other", "expectedVersion": 1, "lines": []map[string]any{{"offerId": "offer-a", "quantity": 4}}},
	}
	var wg sync.WaitGroup
	results := make(chan int, 2)
	for _, change := range contenders {
		wg.Add(1)
		go func(c map[string]any) {
			defer wg.Done()
			code, _ := runCart(t, handler, "PUT", "store-a", "customer-a", c)
			results <- code
		}(change)
	}
	wg.Wait()
	close(results)
	nOk, nConflict := 0, 0
	for code := range results {
		if code == 200 {
			nOk++
		} else if code == 409 {
			nConflict++
		} else {
			t.Fatalf("unexpected raced Cart HTTP: %d", code)
		}
	}
	if nOk != 1 || nConflict != 1 {
		t.Fatalf("Cart optimistic race result %d successes, %d conflicts", nOk, nConflict)
	}
	var version, commands, lines int64
	if err = db.QueryRowContext(ctx, "SELECT version FROM "+schema+".customer_carts WHERE actor_id='customer-a' AND store_id='store-a'").Scan(&version); err != nil {
		t.Fatal(err)
	}
	if err = db.QueryRowContext(ctx, "SELECT count(*) FROM "+schema+".customer_cart_commands WHERE actor_id='customer-a' AND store_id='store-a'").Scan(&commands); err != nil {
		t.Fatal(err)
	}
	if err = db.QueryRowContext(ctx, "SELECT count(*) FROM "+schema+".customer_cart_lines WHERE actor_id='customer-a' AND store_id='store-a'").Scan(&lines); err != nil {
		t.Fatal(err)
	}
	if version != 2 || commands != 2 || lines != 1 {
		t.Fatalf("durable Cart readback version=%d commands=%d lines=%d", version, commands, lines)
	}
	if _, err = db.ExecContext(ctx, "UPDATE "+schema+".offers SET stock_units=0 WHERE id='offer-a'"); err != nil {
		t.Fatal(err)
	}
	status, body = runCart(t, handler, "GET", "store-a", "customer-a", nil)
	assertCartStatus(t, status, 200, body)
	var preview Snapshot
	if err = json.Unmarshal(body, &preview); err != nil || len(preview.Lines) != 1 || preview.Lines[0].PreviewAvailable {
		t.Fatalf("stale stock was displayed as available: %s", body)
	}
	noStock := map[string]any{"operationId": "cart-unavailable", "expectedVersion": 2,
		"lines": []map[string]any{{"offerId": "offer-a", "quantity": 5}}}
	status, body = runCart(t, handler, "PUT", "store-a", "customer-a", noStock)
	assertCartStatus(t, status, 404, body)
	if err = db.QueryRowContext(ctx, "SELECT version FROM "+schema+".customer_carts WHERE actor_id='customer-a' AND store_id='store-a'").Scan(&version); err != nil || version != 2 {
		t.Fatalf("stock denial still changed durable Cart version=%d err=%v", version, err)
	}
	// The owner may commit even when the network drops the acknowledgement.
	// Exactly the same operation must then replay, never post a second Cart change.
	if _, err = db.ExecContext(ctx, "UPDATE "+schema+".offers SET stock_units=10 WHERE id='offer-a'"); err != nil {
		t.Fatal(err)
	}
	lostChange := map[string]any{"operationId": "cart-lost-confirmation", "expectedVersion": 2,
		"lines": []map[string]any{{"offerId": "offer-a", "quantity": 3}}}
	lost := &closedAck{header: make(http.Header)}
	handler.ServeHTTP(lost, jsonCartRequest(t, "PUT", "store-a", "customer-a", lostChange))
	if lost.status != 200 {
		t.Fatalf("lost-ack mutation did not commit: %d", lost.status)
	}
	status, body = runCart(t, handler, "PUT", "store-a", "customer-a", lostChange)
	assertCartStatus(t, status, 200, body)
	if err = json.Unmarshal(body, &replay); err != nil || !replay.Replay || replay.Cart.Version != 3 {
		t.Fatalf("lost-ack retry created duplicate owner version: %s %v", body, err)
	}
	if err = db.QueryRowContext(ctx, "SELECT version FROM "+schema+".customer_carts WHERE actor_id='customer-a' AND store_id='store-a'").Scan(&version); err != nil || version != 3 {
		t.Fatalf("lost Cart confirmation was not durable or double-applied: %d %v", version, err)
	}
	// A Store can close between the commit and an acknowledgement retry.
	// The original operation remains readable; a fresh mutation must not
	// silently create a new draft for an unpublished Store.
	if _, err = db.ExecContext(ctx, "UPDATE "+schema+".stores SET published=false WHERE id='store-a'"); err != nil {
		t.Fatal(err)
	}
	status, body = runCart(t, handler, "PUT", "store-a", "customer-a", lostChange)
	assertCartStatus(t, status, 200, body)
	if err = json.Unmarshal(body, &replay); err != nil || !replay.Replay || replay.Cart.Version != 3 ||
		len(replay.Cart.Lines) != 1 || replay.Cart.Lines[0].PreviewAvailable {
		t.Fatalf("closed Store replay was not safely reconciled: %s %v", body, err)
	}
	newOperation := map[string]any{"operationId": "cart-after-closure", "expectedVersion": 3,
		"lines": []map[string]any{{"offerId": "offer-a", "quantity": 4}}}
	status, body = runCart(t, handler, "PUT", "store-a", "customer-a", newOperation)
	assertCartStatus(t, status, 404, body)
	sessions.mu.Lock()
	sessions.revoked = true
	sessions.mu.Unlock()
	status, body = runCart(t, handler, "GET", "store-a", "customer-a", nil)
	assertCartStatus(t, status, 401, body)
	t.Logf("DSH_CART_OWNER_POSTGRES_PASS version=%d commands=%d lines=%d replay_and_actor_isolation=true", version, commands, lines)
}

// The public contract requires an explicit optimistic version. Without it,
// Go's zero value would silently turn a malformed first write into version 0.
func TestCustomerCartRequiresExplicitExpectedVersion(t *testing.T) {
	handler := &Handler{}
	router := http.NewServeMux()
	router.HandleFunc("PUT /v1/carts/{storeID}", handler.put)
	cases := []struct {
		name    string
		version any
		omit    bool
		want    int
	}{
		{name: "missing", omit: true, want: http.StatusBadRequest},
		{name: "null", version: nil, want: http.StatusBadRequest},
		{name: "fractional", version: 0.5, want: http.StatusBadRequest},
		{name: "negative", version: -1, want: http.StatusBadRequest},
		{name: "explicit zero", version: 0, want: http.StatusUnauthorized},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			payload := map[string]any{
				"operationId": "cart-explicit-version-001",
				"lines":       []any{},
			}
			if !tc.omit {
				payload["expectedVersion"] = tc.version
			}
			response := httptest.NewRecorder()
			router.ServeHTTP(response, jsonCartRequest(t, http.MethodPut, "store-a", "", payload))
			assertCartStatus(t, response.Code, tc.want, response.Body.Bytes())
		})
	}
}

func TestCustomerCartRequiresCurrentVerifiedCustomer(t *testing.T) {
	if _, err := NewHandler(nil, "dsh_test_cart_ci", cartSessionAdapter{&testSession{}}); err == nil {
		t.Fatal("nil Cart owner database accepted")
	}
	if _, err := NewHandler(&sql.DB{}, "dsh_test_cart_ci", nil); err == nil {
		t.Fatal("nil Identity verifier accepted")
	}
	negativeVersion := int64(-1)
	changes := []Change{
		{},
		{OperationID: "cart-12345", ExpectedVersion: &negativeVersion, Lines: []struct {
			OfferID  string `json:"offerId"`
			Quantity int64  `json:"quantity"`
		}{}},
	}
	for _, c := range changes {
		if validChange(c) {
			t.Fatal("invalid Cart payload passed")
		}
	}
}
