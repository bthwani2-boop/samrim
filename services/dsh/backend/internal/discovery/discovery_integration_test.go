package discovery

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
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
	if !strings.HasPrefix(os.Getenv("DSH_DB_SCHEMA"), "dsh_test_") {
		t.Fatal("owner-backed integration requires an explicitly isolated dsh_test_* schema")
	}
	owner, err := New(db, fmt.Sprintf("dsh_test_discovery_%x", time.Now().UnixNano()))
	if err != nil {
		t.Fatal(err)
	}
	baseline := filepath.Join("..", "..", "..", "database", "schema")
	if err = owner.BootstrapFresh(t.Context(), baseline); err != nil {
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

func TestOwnerBackedPublicStoreOperationalStatus(t *testing.T) {
	owner, server := setupIntegratedOwner(t)
	ctx := context.Background()
	tx, err := owner.beginScopedTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	var configuredCities int
	if err = tx.QueryRowContext(ctx, `SELECT count(*) FROM service_cities
		WHERE id IN ('sanaa','aden') AND timezone_name='Asia/Aden'`).Scan(&configuredCities); err != nil || configuredCities != 2 {
		t.Fatalf("synthetic import configured %d city timezones, want 2: %v", configuredCities, err)
	}
	// Each isolated projection fixture has a distinct coverage case. Store
	// mutation authorization and durable commands have their own tests.
	if _, err = tx.ExecContext(ctx, `INSERT INTO store_operational_availability
		(store_id,store_timezone,paused_until,preparation_minutes,changed_by_actor,change_reason)
		VALUES ('market-sanaa','Asia/Aden',now()+interval '30 minutes',15,'private-actor','private-reason'),
		('direct-sanaa','Asia/Aden',now()-interval '1 minute',15,'private-actor','private-reason'),
		('market-aden','Asia/Aden',NULL,15,'private-actor','private-reason'),
		('market-sanaa-paused','UTC',NULL,15,'private-actor','private-reason'),
		('draft-sanaa','Asia/Aden',now()+interval '30 minutes',15,'private-actor','private-reason')
		ON CONFLICT (store_id) DO UPDATE SET paused_until=EXCLUDED.paused_until,
		preparation_minutes=EXCLUDED.preparation_minutes, store_timezone=EXCLUDED.store_timezone`); err != nil {
		t.Fatal(err)
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO store_operational_weekly_hours
		(store_id,weekday,opens_minute,closes_minute)
		SELECT 'market-aden', weekday, 0, 1440 FROM generate_series(0,6) weekday
		ON CONFLICT (store_id,weekday,opens_minute) DO NOTHING`); err != nil {
		t.Fatal(err)
	}
	if err = tx.Commit(); err != nil {
		t.Fatal(err)
	}
	server.StoreAvailabilityEnabled = true
	w, active := request(server, "/v1/public/stores/market-sanaa")
	if w.Code != 200 || active["orderabilityStatus"] != "PAUSED" ||
		active["orderingAvailable"] != false || len(active) != 6 {
		t.Fatalf("unexpected public paused Store response: %d %s", w.Code, w.Body.String())
	}
	w, page := request(server, "/v1/public/stores?city_id=sanaa&limit=1")
	if w.Code != 200 {
		t.Fatalf("listing failed: %d %s", w.Code, w.Body.String())
	}
	items := results(t, page)
	if len(items) != 1 || items[0].(map[string]any)["orderabilityStatus"] != "PAUSED" ||
		items[0].(map[string]any)["orderingAvailable"] != false {
		t.Fatalf("listing lost active pause: %s", w.Body.String())
	}
	cursor, ok := page["nextCursor"].(string)
	if !ok || cursor == "" {
		t.Fatal("schedule-enabled listing lost pagination cursor")
	}
	w, page = request(server, "/v1/public/stores?city_id=sanaa&limit=1&cursor="+url.QueryEscape(cursor))
	if w.Code != 200 {
		t.Fatalf("schedule-enabled continuation failed: %d %s", w.Code, w.Body.String())
	}
	items = results(t, page)
	if len(items) != 1 || items[0].(map[string]any)["id"] != "market-sanaa-paused" ||
		items[0].(map[string]any)["orderingAvailable"] != false {
		t.Fatalf("schedule-enabled continuation crossed Store scope: %s", w.Body.String())
	}
	for _, query := range []string{"q=" + url.QueryEscape("' OR true --"), "vertical_id=disabled-vertical"} {
		w, page = request(server, "/v1/public/stores?city_id=sanaa&"+query)
		if w.Code != 200 || len(results(t, page)) != 0 {
			t.Fatalf("schedule-enabled selector crossed publication boundary: %d %s", w.Code, w.Body.String())
		}
	}
	if w, _ = request(server, "/v1/public/stores/disabled-vertical-store"); w.Code != 404 {
		t.Fatalf("schedule-enabled direct link leaked disabled vertical: %d %s", w.Code, w.Body.String())
	}
	for _, example := range []struct{ store, status string }{
		{"direct-sanaa", "CLOSED_BY_SCHEDULE"},
		{"market-aden", "OPERATIONALLY_UNAVAILABLE"},
		{"market-sanaa-paused", "OPERATIONALLY_UNAVAILABLE"},
	} {
		w, result := request(server, "/v1/public/stores/"+example.store)
		if w.Code != 200 || result["orderabilityStatus"] != example.status ||
			result["orderingAvailable"] != false || len(result) != 6 {
			t.Fatalf("unexpected Store %s projection: %d %s", example.store, w.Code, w.Body.String())
		}
	}
	if w, _ = request(server, "/v1/public/stores/draft-sanaa"); w.Code != 404 {
		t.Fatalf("draft Store leaked: %d %s", w.Code, w.Body.String())
	}
}

func TestRegressionFixtureDatabaseAdmission(t *testing.T) {
	if !isRegressionFixtureDatabase("bthwani_refoundation") {
		t.Fatal("disposable regression fixture database denied")
	}
	for _, database := range []string{"bthwani_dsh_dev", "bthwani_dsh_boundary_fixture", "bthwani_identity_dev", "bthwani_wlt_test", "postgres", ""} {
		if isRegressionFixtureDatabase(database) {
			t.Errorf("regression writes admitted to %q", database)
		}
	}
}

func TestOwnerBackedSyntheticImportDeniesAlternateDatabase(t *testing.T) {
	if os.Getenv("BTHWANI_ISOLATED_TEST_MODE") != "true" || os.Getenv("DSH_TEST_SEED_BOUNDARY") != "true" {
		t.Skip("requires a disposable PostgreSQL runner with cloned DSH fixture databases")
	}
	for _, database := range []string{"bthwani_dsh_boundary_fixture", "bthwani_dsh_dev"} {
		t.Run(database, func(t *testing.T) {
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
			ctx := t.Context()
			// The runner creates both databases in its own network-disabled,
			// disposable PostgreSQL container. Never arrange data in shared development.
			readback := func() [2]int64 {
				t.Helper()
				tx, err := owner.viewTx(ctx)
				if err != nil {
					t.Fatal(err)
				}
				defer tx.Rollback()
				var counts [2]int64
				if err = tx.QueryRowContext(ctx, "SELECT revision, (SELECT count(*) FROM stores) FROM public_revision WHERE singleton").Scan(&counts[0], &counts[1]); err != nil {
					t.Fatal(err)
				}
				return counts
			}
			before := readback()
			importErr := owner.ImportSynthetic(ctx)
			if after := readback(); after != before {
				t.Errorf("synthetic import modified the protected fixture: %v -> %v", before, after)
			}
			if importErr == nil || !strings.Contains(importErr.Error(), "outside the isolated refoundation database") {
				t.Fatalf("expected synthetic import to deny the protected database, got %v", importErr)
			}
		})
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

func TestOwnerBackedDiscoveryDemoSeed(t *testing.T) {
	if os.Getenv("BTHWANI_ISOLATED_TEST_MODE") != "true" {
		t.Skip("requires disposable owner PostgreSQL")
	}
	t.Setenv("DSH_BOOTSTRAP_SYNTHETIC_REGISTRATION", "false")
	db, err := OpenFromEnvironment()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	ctx, cancel := context.WithTimeout(t.Context(), 30*time.Second)
	defer cancel()
	owner, err := New(db, fmt.Sprintf("dsh_test_demo_%x", time.Now().UnixNano()))
	if err != nil {
		t.Fatal(err)
	}
	if err = owner.BootstrapFresh(ctx, filepath.Join("..", "..", "..", "database", "schema")); err != nil {
		t.Fatal(err)
	}
	if err = owner.ImportSynthetic(ctx); err == nil {
		t.Fatal("regression seed must refuse demo schema")
	}
	var wg sync.WaitGroup
	outcomes := make(chan error, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); outcomes <- owner.ImportSyntheticDemo(ctx) }()
	}
	wg.Wait()
	close(outcomes)
	committed := 0
	for e := range outcomes {
		if e == nil {
			committed++
		} else if !strings.Contains(e.Error(), "empty demo schema") {
			t.Fatal(e)
		}
	}
	if committed != 1 {
		t.Fatalf("exactly one seed may commit, got %d", committed)
	}
	var stores, products, variants, offers int
	var revision int64
	q := "SELECT (SELECT count(*) FROM " + owner.Schema + ".stores),(SELECT count(*) FROM " + owner.Schema + ".products),(SELECT count(*) FROM " + owner.Schema + ".variants),(SELECT count(*) FROM " + owner.Schema + ".offers),(SELECT revision FROM " + owner.Schema + ".public_revision WHERE singleton)"
	if err = db.QueryRowContext(ctx, q).Scan(&stores, &products, &variants, &offers, &revision); err != nil {
		t.Fatal(err)
	}
	if stores != 30 || products != 500 || variants != 500 || offers != 500 || revision != 1 {
		t.Fatalf("unexpected durable demo result %d/%d/%d/%d revision=%d", stores, products, variants, offers, revision)
	}
	if err = owner.ImportSyntheticDemo(ctx); err == nil {
		t.Fatal("must refuse reimport")
	}
	s := &Server{Owner: owner}
	assertPages := func(path string, want int) {
		t.Helper()
		seen := map[string]bool{}
		next := path
		for i := 0; i < 4; i++ {
			w, body := request(s, next)
			if w.Code != 200 {
				t.Fatalf("%s: %d %s", next, w.Code, w.Body.String())
			}
			if body["revision"] != float64(1) {
				t.Fatalf("revision %v", body)
			}
			for _, v := range results(t, body) {
				item := v.(map[string]any)
				id := item["id"].(string)
				if seen[id] {
					t.Fatalf("duplicate %s", id)
				}
				seen[id] = true
				if item["orderingAvailable"] == true {
					t.Fatal("demo cannot promise checkout")
				}
			}
			cursor, _ := body["nextCursor"].(string)
			if cursor == "" {
				if len(seen) != want {
					t.Fatalf("%s got %d, want %d", path, len(seen), want)
				}
				return
			}
			next = path + "&cursor=" + cursor
		}
		t.Fatal("pagination did not terminate")
	}
	assertPages("/v1/public/stores?city_id=sanaa&limit=20", 25)
	assertPages("/v1/public/stores?city_id=aden&limit=20", 3)
	assertPages("/v1/public/stores/demo-store-01/offers?limit=20", 23)
	if w, _ := request(s, "/v1/public/stores/demo-store-29"); w.Code != 200 {
		t.Fatal("Direct Store link missing")
	}
	if w, _ := request(s, "/v1/public/stores/demo-store-30"); w.Code != 404 {
		t.Fatal("draft Store exposed")
	}
	if err = db.QueryRowContext(ctx, q).Scan(&stores, &products, &variants, &offers, &revision); err != nil || stores != 30 || offers != 500 || revision != 1 {
		t.Fatalf("rejected replay changed fixture: %v", err)
	}
	other, err := New(db, "dsh_test_not_demo")
	if err != nil {
		t.Fatal(err)
	}
	if err = other.ImportSyntheticDemo(ctx); err == nil {
		t.Fatal("demo seed accepted ordinary schema")
	}
}
