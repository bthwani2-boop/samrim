package discovery

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

func setupIntegratedOwner(t *testing.T) (*Owner, *Server) {
	t.Helper()
	if os.Getenv("BTHWANI_ISOLATED_TEST_MODE") != "true" {
		t.Skip("Owner-backed PostgreSQL integration requires explicit BTHWANI_ISOLATED_TEST_MODE; not counted as PASS here")
	}
	db, err := OpenFromEnvironment()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	schema := os.Getenv("DSH_DB_SCHEMA")
	if !strings.HasPrefix(schema, "dsh_test_") {
		t.Fatal("owner-backed integration requires an explicitly isolated dsh_test_* schema")
	}
	owner, err := New(db, schema)
	if err != nil {
		t.Fatal(err)
	}
	migrationPath := os.Getenv("DSH_DISCOVERY_MIGRATION_FILE")
	if migrationPath == "" {
		migrationPath = filepath.Join("..", "..", "..", "database", "migrations", "001_public_discovery.sql")
	}
	migration, err := os.ReadFile(migrationPath)
	if err != nil {
		t.Fatal(err)
	}
	if err = owner.Migrate(context.Background(), migration); err != nil {
		t.Fatal(err)
	}
	if err = owner.ImportSynthetic(context.Background()); err != nil {
		t.Fatal(err)
	}
	return owner, &Server{Owner: owner, AllowedOrigins: map[string]bool{"http://localhost:18101": true}}
}
func request(s *Server, path string) (*httptest.ResponseRecorder, map[string]any) {
	w := httptest.NewRecorder()
	s.ServeHTTP(w, httptest.NewRequest("GET", path, nil))
	var parsed map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &parsed)
	return w, parsed
}
func results(t *testing.T, parsed map[string]any) []any {
	t.Helper()
	got, ok := parsed["items"].([]any)
	if !ok {
		t.Fatalf("response missing items: %#v", parsed)
	}
	return got
}
func TestOwnerBackedMarketplaceVisibility(t *testing.T) {
	_, s := setupIntegratedOwner(t)
	w, body := request(s, "/v1/public/stores?city_id=sanaa")
	if w.Code != 200 {
		t.Fatalf("status %d %s", w.Code, w.Body.String())
	}
	items := results(t, body)
	if len(items) != 2 {
		t.Fatalf("expected two published Sana'a stores, got %d: %s", len(items), w.Body.String())
	}
	found := map[string]bool{}
	for _, v := range items {
		x := v.(map[string]any)
		id := x["id"].(string)
		found[id] = true
		if x["orderingAvailable"] != false {
			t.Errorf("no supported checkout should be shown as available")
		}
	}
	if !found["market-sanaa"] || !found["market-sanaa-paused"] {
		t.Fatalf("wrong marketplace %+v", found)
	}
	if strings.Contains(w.Body.String(), "owner-a") || strings.Contains(w.Body.String(), "direct-sanaa") ||
		strings.Contains(w.Body.String(), "draft-sanaa") || strings.Contains(w.Body.String(), "market-aden") ||
		strings.Contains(w.Body.String(), "disabled-vertical-store") {
		t.Fatalf("public data leak: %s", w.Body.String())
	}
	w, _ = request(s, "/v1/public/stores?city_id=unknown")
	if w.Code != 200 || len(results(t, decode(t, w.Body.Bytes()))) != 0 {
		t.Fatal("unknown city not empty")
	}
	w, body = request(s, "/v1/public/stores/direct-sanaa")
	if w.Code != 200 || body["id"] != "direct-sanaa" {
		t.Fatal("published Direct link not accessible")
	}
	w, _ = request(s, "/v1/public/stores/draft-sanaa")
	if w.Code != 404 {
		t.Fatal("unpublished store leaked")
	}
	w, _ = request(s, "/v1/public/stores/disabled-vertical-store")
	if w.Code != 404 {
		t.Fatal("disabled vertical leaked")
	}
	w, body = request(s, "/v1/public/stores/market-sanaa-paused")
	if w.Code != 200 || body["orderabilityStatus"] != "OPERATIONALLY_UNAVAILABLE" || body["orderingAvailable"] != false {
		t.Fatal("paused store status lost")
	}
}

func TestOwnerBackedSyntheticImportDeniesAlternateDatabase(t *testing.T) {
	if os.Getenv("BTHWANI_ISOLATED_TEST_MODE") != "true" || os.Getenv("DSH_TEST_SEED_BOUNDARY") != "true" {
		t.Skip("requires a disposable PostgreSQL runner with a cloned DSH fixture database")
	}
	const database = "bthwani_dsh_boundary_fixture"
	t.Setenv("REF_POSTGRES_DB", database)
	db, err := OpenFromEnvironment()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	owner, err := New(db, "dsh_test_seed_boundary")
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	readRevision := func() int64 {
		t.Helper()
		tx, err := owner.viewTx(ctx)
		if err != nil {
			t.Fatal(err)
		}
		defer tx.Rollback()
		rev, err := owner.revision(ctx, tx)
		if err != nil {
			t.Fatal(err)
		}
		return rev
	}

	before := readRevision()
	importErr := owner.ImportSynthetic(ctx)
	if after := readRevision(); after != before {
		t.Errorf("synthetic import modified the alternate database: revision %d -> %d", before, after)
	}
	if importErr == nil || !strings.Contains(importErr.Error(), "outside the isolated refoundation database") {
		t.Fatalf("expected synthetic import to deny the alternate database, got %v", importErr)
	}
}

func decode(t *testing.T, raw []byte) map[string]any {
	t.Helper()
	var b map[string]any
	if err := json.Unmarshal(raw, &b); err != nil {
		t.Fatal(err)
	}
	return b
}
func TestOwnerBackedOfferVisibilityAndCursorRecovery(t *testing.T) {
	owner, s := setupIntegratedOwner(t)
	w, body := request(s, "/v1/public/stores/market-sanaa/offers?limit=1")
	if w.Code != 200 {
		t.Fatalf("status %d %s", w.Code, w.Body.String())
	}
	items := results(t, body)
	if len(items) != 1 {
		t.Fatalf("expected first page: %s", w.Body.String())
	}
	first := items[0].(map[string]any)
	if first["priceYer"] != float64(1200) || first["id"] != "of-flour" {
		t.Fatalf("price mismatch: %v", first)
	}
	cursor, ok := body["nextCursor"].(string)
	if !ok || cursor == "" {
		t.Fatal("expected cursor")
	}
	w, body = request(s, "/v1/public/stores/market-sanaa/offers?limit=1&cursor="+cursor)
	if w.Code != 200 || len(results(t, body)) != 1 {
		t.Fatalf("second page %d %s", w.Code, w.Body.String())
	}
	if body["items"].([]any)[0].(map[string]any)["priceYer"] != float64(150) {
		t.Fatal("wrong second price")
	}
	w, body = request(s, "/v1/public/stores/direct-sanaa/offers")
	if w.Code != 200 || len(results(t, body)) != 0 {
		t.Fatal("direct Store should be link-accessible but empty")
	}
	w, _ = request(s, "/v1/public/stores/draft-sanaa/offers")
	if w.Code != 404 {
		t.Fatal("draft offer route must not disclose Store")
	}
	w, _ = request(s, "/v1/public/stores/market-sanaa/offers?cursor=bad")
	if w.Code != 400 {
		t.Fatalf("malformed cursor accepted: %d", w.Code)
	}
	w, _ = request(s, "/v1/public/stores/market-sanaa/offers?limit=999")
	if w.Code != 400 {
		t.Fatal("unbounded page accepted")
	}
	if err := owner.ImportSynthetic(context.Background()); err != nil {
		t.Fatal(err)
	}
	w, _ = request(s, "/v1/public/stores/market-sanaa/offers?limit=1&cursor="+cursor)
	if w.Code != 409 {
		t.Fatalf("stale cursor accepted: %d", w.Code)
	}
}
func TestOwnerBackedUnpublishedStoreRejectsOfferContinuation(t *testing.T) {
	owner, server := setupIntegratedOwner(t)
	w, firstPage := request(server, "/v1/public/stores/market-sanaa/offers?limit=1")
	if w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	cursor, ok := firstPage["nextCursor"].(string)
	if !ok || cursor == "" {
		t.Fatal("expected a continuation cursor from the published Store")
	}
	// Explicit DSH-owner test-state transition on the isolated synthetic Store.
	// This proves public-read revocation, not an implemented Merchant publication API.
	t.Cleanup(func() {
		if err := owner.ImportSynthetic(context.Background()); err != nil {
			t.Error(err)
		}
	})
	tx, err := owner.beginScopedTx(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	if _, err = tx.Exec("UPDATE stores SET published=false WHERE id='market-sanaa'"); err != nil {
		t.Fatal(err)
	}
	if err = tx.Commit(); err != nil {
		t.Fatal(err)
	}
	readback, err := owner.viewTx(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer readback.Rollback()
	var published bool
	if err = readback.QueryRow("SELECT published FROM stores WHERE id='market-sanaa'").Scan(&published); err != nil || published {
		t.Fatalf("durable publication denial not established: published=%v error=%v", published, err)
	}
	for _, path := range []string{"/v1/public/stores/market-sanaa", "/v1/public/stores/market-sanaa/offers?limit=1&cursor=" + cursor} {
		w, body := request(server, path)
		if w.Code != 404 || body["error"] != "NOT_FOUND" {
			t.Fatalf("unpublished Store read did not fail closed: %d %s", w.Code, w.Body.String())
		}
	}
}

func TestOwnerBackedConcurrentReadsAndSafeFailures(t *testing.T) {
	owner, s := setupIntegratedOwner(t)
	var wg sync.WaitGroup
	failed := make(chan string, 64)
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			w, b := request(s, "/v1/public/stores?city_id=sanaa")
			if w.Code != 200 || len(resultsSafe(b)) != 2 {
				failed <- w.Body.String()
			}
		}()
	}
	wg.Add(1)
	go func() {
		defer wg.Done()
		if err := owner.ImportSynthetic(context.Background()); err != nil {
			failed <- err.Error()
		}
	}()
	wg.Wait()
	close(failed)
	for message := range failed {
		t.Errorf("concurrent read failed: %s", message)
	}
	w, _ := request(s, "/v1/public/stores?city_id=INVALID")
	if w.Code != 400 {
		t.Fatal("invalid city accepted")
	}
	w, _ = request(s, "/v1/public/stores/../../private")
	if w.Code != 404 {
		t.Fatal("path traversal accepted")
	}
	if _, err := New(owner.DB, "x;drop"); err == nil {
		t.Fatal("SQL identifier injection accepted")
	}
	w = httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/v1/public/stores?city_id=sanaa", strings.NewReader("{}"))
	s.ServeHTTP(w, req)
	if w.Code != 405 {
		t.Fatal("public write method accepted")
	}
}
func resultsSafe(b map[string]any) []any { v, _ := b["items"].([]any); return v }

func TestOwnerScopedTransactionSearchPathResetsOnPooledConnection(t *testing.T) {
	owner, _ := setupIntegratedOwner(t)
	// Force reuse of one physical PostgreSQL connection to detect scope leakage.
	owner.DB.SetMaxOpenConns(1)
	ctx := context.Background()
	tx, err := owner.viewTx(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var scoped string
	if err = tx.QueryRowContext(ctx, "SELECT current_setting('search_path')").Scan(&scoped); err != nil {
		_ = tx.Rollback()
		t.Fatal(err)
	}
	if !strings.Contains(scoped, owner.Schema) {
		_ = tx.Rollback()
		t.Fatalf("transaction did not select its DSH schema: %q", scoped)
	}
	if err = tx.Commit(); err != nil {
		t.Fatal(err)
	}
	var after string
	if err = owner.DB.QueryRowContext(ctx, "SELECT current_setting('search_path')").Scan(&after); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(after, owner.Schema) {
		t.Fatalf("DSH schema leaked across pooled transactions: %q", after)
	}

	other, err := New(owner.DB, "dsh_test_uncreated_isolation")
	if err != nil {
		t.Fatal(err)
	}
	otherTx, err := other.viewTx(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer otherTx.Rollback()
	var otherPath string
	if err = otherTx.QueryRowContext(ctx, "SELECT current_setting('search_path')").Scan(&otherPath); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(otherPath, other.Schema) || strings.Contains(otherPath, owner.Schema) {
		t.Fatalf("cross-scope DSH schema contamination: %q", otherPath)
	}
}
