package main

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

func TestDevelopmentHealthRejectsClosedDatabaseAndWrongMethod(t *testing.T) {
	db, err := sql.Open("postgres", "postgres://127.0.0.1:1/bthwani_wlt_test?sslmode=disable")
	if err != nil {
		t.Fatal(err)
	}
	// sql.Open is lazy. Close before serving; the real database/sql ping fails
	// deterministically without touching any running PostgreSQL service.
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	handler := developmentHealth(db, "", false)
	for _, tc := range []struct {
		method string
		want   int
	}{
		{http.MethodGet, http.StatusServiceUnavailable},
		{http.MethodPost, http.StatusMethodNotAllowed},
	} {
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, httptest.NewRequest(tc.method, "/health", nil))
		if response.Code != tc.want || response.Body.Len() != 0 {
			t.Fatalf("%s: status=%d body=%q", tc.method, response.Code, response.Body.String())
		}
		if tc.method == http.MethodPost && response.Header().Get("Allow") != "GET" {
			t.Fatal("method rejection did not advertise GET")
		}
	}
}

func TestSandboxCommandRejectsNonIsolatedDatabaseBeforeReadingSession(t *testing.T) {
	const dsn = "postgres://bthwani_wlt_sandbox:fixture@127.0.0.1:5432/bthwani_wlt_test?sslmode=disable"
	for _, tc := range []struct{ mode, database string }{
		{"", dsn},
		{"true", strings.Replace(dsn, "127.0.0.1", "192.0.2.1", 1)},
		{"true", strings.Replace(dsn, "bthwani_wlt_test", "bthwani_wlt_restore", 1)},
		{"true", strings.Replace(dsn, "bthwani_wlt_sandbox", "bthwani_wlt_reader", 1)},
	} {
		err := runSandboxFunding(t.Context(), "post-sandbox-funding", []string{"fixture-reference", "9"}, strings.NewReader(""), io.Discard,
			func(name string) string {
				return map[string]string{"BTHWANI_ISOLATED_TEST_MODE": tc.mode, "WLT_SANDBOX_DATABASE_URL": tc.database}[name]
			})
		if err == nil || !strings.Contains(err.Error(), "dedicated isolated loopback database role") {
			t.Fatalf("sandbox did not reject the isolation configuration: %v", err)
		}
	}
}

func TestWalletContainerRuntimeRequiresExplicitIsolatedOwner(t *testing.T) {
	const dsn = "postgres://bthwani_wlt_reader:synthetic-only@postgres:5432/bthwani_wlt_test?sslmode=disable"
	for _, tc := range []struct {
		name, mode, container, address, database, identity string
		want                                               bool
	}{
		{"valid", "true", "true", "0.0.0.0:8080", dsn, "http://identity:3302", true},
		{"no opt in", "", "true", "0.0.0.0:8080", dsn, "http://identity:3302", false},
		{"no container opt in", "true", "", "0.0.0.0:8080", dsn, "http://identity:3302", false},
		{"external bind", "true", "true", "0.0.0.0:8081", dsn, "http://identity:3302", false},
		{"admin writer", "true", "true", "0.0.0.0:8080", strings.Replace(dsn, "bthwani_wlt_reader", "postgres", 1), "http://identity:3302", false},
		{"alternate database", "true", "true", "0.0.0.0:8080", strings.Replace(dsn, "bthwani_wlt_test", "bthwani_refoundation", 1), "http://identity:3302", false},
		{"external db", "true", "true", "0.0.0.0:8080", strings.Replace(dsn, "postgres:5432", "example.com:5432", 1), "http://identity:3302", false},
		{"local db", "true", "true", "0.0.0.0:8080", strings.Replace(dsn, "postgres:5432", "127.0.0.1:5432", 1), "http://identity:3302", false},
		{"dsn override", "true", "true", "0.0.0.0:8080", dsn + "&host=other", "http://identity:3302", false},
		{"foreign identity", "true", "true", "0.0.0.0:8080", dsn, "http://example.com:3302", false},
		{"loopback identity", "true", "true", "0.0.0.0:8080", dsn, "http://127.0.0.1:3302", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := validContainerIsolation(tc.mode, tc.container, tc.address, tc.database, tc.identity)
			if got != tc.want {
				t.Fatalf("container isolation=%t want=%t", got, tc.want)
			}
		})
	}
}

func TestWalletRuntimeRequiresIsolatedReader(t *testing.T) {
	const dsn = "postgres://bthwani_wlt_reader:synthetic-only@127.0.0.1:5432/bthwani_wlt_test?sslmode=disable"
	for _, test := range []struct {
		name, mode, address, database string
		want                          bool
	}{
		{"isolated", "true", "127.0.0.1:23203", dsn, true},
		{"no opt-in", "", "127.0.0.1:23203", dsn, false},
		{"wildcard", "true", "0.0.0.0:23203", dsn, false},
		{"non-reader", "true", "127.0.0.1:23203", "postgres://postgres@127.0.0.1:5432/bthwani_wlt_test?sslmode=disable", false},
		{"other database", "true", "127.0.0.1:23203", "postgres://bthwani_wlt_reader@127.0.0.1:5432/samrim?sslmode=disable", false},
		{"query override", "true", "127.0.0.1:23203", dsn + "&host=other", false},
	} {
		t.Run(test.name, func(t *testing.T) {
			if got := validIsolation(test.mode, test.address, test.database); got != test.want {
				t.Errorf("isolation=%t want=%t", got, test.want)
			}
		})
	}
}

// Native database/sql ping seam; the peer is an actual loopback HTTP server.
type healthTestDriver struct{ pingError error }

func (d healthTestDriver) Open(string) (driver.Conn, error) { return healthTestConn{d.pingError}, nil }
func (d healthTestDriver) Connect(ctx context.Context) (driver.Conn, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return d.Open("")
}
func (d healthTestDriver) Driver() driver.Driver { return d }

type healthTestConn struct{ pingError error }

func (c healthTestConn) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("unexpected SQL")
}
func (c healthTestConn) Begin() (driver.Tx, error) { return nil, errors.New("unexpected transaction") }
func (c healthTestConn) Close() error              { return nil }
func (c healthTestConn) Ping(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	return c.pingError
}

func TestDevelopmentHealthRequiresIdentityDocument(t *testing.T) {
	const valid = `{"status":"ok"}`
	for _, tc := range []struct {
		name, body, media, cache, encoding string
		code, want                         int
	}{
		{"ready", valid, "application/json", "no-store", "", 200, 200},
		{"wrong service", "<html>not Identity</html>", "text/html", "no-store", "", 200, 503},
		{"empty", "", "application/json", "no-store", "", 200, 503},
		{"unavailable", `{"status":"unavailable"}`, "application/json", "no-store", "", 200, 503},
		{"wrong case", `{"Status":"ok"}`, "application/json", "no-store", "", 200, 503},
		{"unknown field", `{"status":"ok","other":true}`, "application/json", "no-store", "", 200, 503},
		{"duplicate", `{"status":"unavailable","status":"ok"}`, "application/json", "no-store", "", 200, 503},
		{"trailing", valid + "{}", "application/json", "no-store", "", 200, 503},
		{"null", "null", "application/json", "no-store", "", 200, 503},
		{"oversized", valid + strings.Repeat(" ", 5000), "application/json", "no-store", "", 200, 503},
		{"cacheable", valid, "application/json", "max-age=3600", "", 200, 503},
		{"no cache policy", valid, "application/json", "", "", 200, 503},
		{"unsupported encoding", valid, "application/json", "no-store", "gzip", 200, 503},
		{"redirect", valid, "application/json", "no-store", "", 302, 503},
		{"dependency error", valid, "application/json", "no-store", "", 503, 503},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var calls atomic.Int32
			owner := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				if r.URL.Path != "/health" || r.Method != http.MethodGet || r.Header.Get("Authorization") != "" {
					t.Error("unexpected readiness request")
				}
				w.Header().Set("Content-Type", tc.media)
				if tc.cache != "" {
					w.Header().Set("Cache-Control", tc.cache)
				}
				if tc.encoding != "" {
					w.Header().Set("Content-Encoding", tc.encoding)
				}
				if tc.code == 302 {
					w.Header().Set("Location", "/redirected")
				}
				w.WriteHeader(tc.code)
				_, _ = io.WriteString(w, tc.body)
			}))
			defer owner.Close()
			db := sql.OpenDB(healthTestDriver{})
			defer db.Close()
			response := httptest.NewRecorder()
			developmentHealth(db, owner.URL, true).ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/health", nil))
			if response.Code != tc.want || response.Body.Len() != 0 || calls.Load() != 1 {
				t.Fatalf("status=%d want=%d body=%q calls=%d", response.Code, tc.want, response.Body.String(), calls.Load())
			}
			if response.Header().Get("Cache-Control") != "no-store" {
				t.Fatal("readiness result must not be cached")
			}
		})
	}
}

func TestDevelopmentHealthShortCircuitsAndRecovers(t *testing.T) {
	var calls atomic.Int32
	owner := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		_, _ = io.WriteString(w, `{"status":"ok"}`)
	}))
	defer owner.Close()
	failed := sql.OpenDB(healthTestDriver{errors.New("private database failure")})
	defer failed.Close()
	healthy := sql.OpenDB(healthTestDriver{})
	defer healthy.Close()
	probe := func(db *sql.DB, ctx context.Context, method, origin string, containerMode bool, want int) {
		t.Helper()
		response := httptest.NewRecorder()
		developmentHealth(db, origin, containerMode).ServeHTTP(response, httptest.NewRequestWithContext(ctx, method, "/health", nil))
		if response.Code != want || response.Body.Len() != 0 || response.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("status=%d want=%d body=%q", response.Code, want, response.Body.String())
		}
	}
	probe(failed, t.Context(), http.MethodGet, owner.URL, true, 503)
	probe(nil, t.Context(), http.MethodGet, owner.URL, true, 503)
	probe(healthy, t.Context(), http.MethodPost, owner.URL, true, 405)
	probe(healthy, t.Context(), http.MethodGet, owner.URL, false, 200)
	probe(healthy, t.Context(), http.MethodGet, strings.Replace(owner.URL, "127.0.0.1", "localhost", 1), true, 503)
	cancelled, cancel := context.WithCancel(t.Context())
	cancel()
	probe(healthy, cancelled, http.MethodGet, owner.URL, true, 503)
	if calls.Load() != 0 {
		t.Fatal("peer reached after rejection or in local mode")
	}
	probe(healthy, t.Context(), http.MethodGet, owner.URL, true, 200)
	if calls.Load() != 1 {
		t.Fatal("recovery did not verify the peer")
	}
}
