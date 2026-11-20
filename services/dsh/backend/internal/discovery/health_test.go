package discovery

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestDiscoveryHealthFailsClosedWithoutOwner(t *testing.T) {
	server := &Server{}
	for _, tc := range []struct {
		method string
		status int
		body   string
	}{
		{http.MethodGet, http.StatusServiceUnavailable, "{\"error\":\"OWNER_UNAVAILABLE\"}\n"},
		{http.MethodPost, http.StatusMethodNotAllowed, "{\"error\":\"METHOD_NOT_ALLOWED\"}\n"},
	} {
		w := httptest.NewRecorder()
		server.ServeHTTP(w, httptest.NewRequest(tc.method, "/health", nil))
		if w.Code != tc.status || w.Body.String() != tc.body || w.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("%s /health returned %d %s", tc.method, w.Code, w.Body.String())
		}
	}
}

func TestOwnerBackedDiscoveryHealthRequiresInitializedSchema(t *testing.T) {
	if os.Getenv("BTHWANI_ISOLATED_TEST_MODE") != "true" {
		t.Skip("owner-backed PostgreSQL integration requires explicit isolated test mode")
	}
	db, err := OpenFromEnvironment()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := db.PingContext(ctx); err != nil {
		t.Fatalf("the underlying PostgreSQL connection must be available: %v", err)
	}
	owner, err := New(db, fmt.Sprintf("dsh_test_health_%x", time.Now().UnixNano()))
	if err != nil {
		t.Fatal(err)
	}
	server := &Server{Owner: owner}
	w, body := request(server, "/health")
	if w.Code != http.StatusServiceUnavailable || body["error"] != "OWNER_UNAVAILABLE" {
		t.Fatalf("reachable PostgreSQL without the DSH schema returned %d %s", w.Code, w.Body.String())
	}
	path := os.Getenv("DSH_DISCOVERY_MIGRATION_FILE")
	if path == "" {
		path = filepath.Join("..", "..", "..", "database", "migrations", "001_public_discovery.sql")
	}
	migration, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := owner.Migrate(ctx, migration); err != nil {
		t.Fatal(err)
	}
	w, body = request(server, "/health")
	if w.Code != http.StatusOK || body["service"] != "dsh" || body["status"] != "ok" {
		t.Fatalf("fresh initialized DSH schema returned %d %s", w.Code, w.Body.String())
	}
	w, body = request(server, "/v1/public/stores?city_id=sanaa")
	if w.Code != http.StatusOK || body["revision"] != float64(0) || len(results(t, body)) != 0 {
		t.Fatalf("initialized DSH schema must serve an unseeded catalog: %d %s", w.Code, w.Body.String())
	}
}
