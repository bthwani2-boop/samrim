package main

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"strings"
	"sync/atomic"
	"testing"
	"time"
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

func TestWalletRuntimeAdmission(t *testing.T) {
	const local = "postgres://bthwani_wlt_reader:synthetic-only@127.0.0.1:5432/bthwani_wlt_test?sslmode=disable"
	const container = "postgres://bthwani_wlt_reader:synthetic-only@postgres:5432/bthwani_wlt_test?sslmode=disable"
	for _, tc := range []struct {
		name, mode, containerFlag, address, database, identity, dsh string
		want                                                        bool
	}{
		{"local", "true", "", "127.0.0.1:23203", local, "http://127.0.0.1:3302", "", true},
		{"explicit local", "true", "false", "127.0.0.1:23203", local, "http://127.0.0.1:3302", "http://127.0.0.1:8080", true},
		{"container", "true", "true", "0.0.0.0:8080", container, "http://identity:3302", "http://dsh:8080", true},
		{"container optional DSH", "true", "true", "0.0.0.0:8080", container, "http://identity:3302", "", true},
		{"local not opted in", "", "", "127.0.0.1:23203", local, "http://127.0.0.1:3302", "", false},
		{"container not opted in", "", "true", "0.0.0.0:8080", container, "http://identity:3302", "", false},
		{"container missing flag", "true", "", "0.0.0.0:8080", container, "http://identity:3302", "", false},
		{"mixed local configuration", "true", "true", "127.0.0.1:23203", local, "http://identity:3302", "", false},
		{"unknown mode", "true", "unknown", "127.0.0.1:23203", local, "http://127.0.0.1:3302", "", false},
		{"local wildcard", "true", "", "0.0.0.0:23203", local, "http://127.0.0.1:3302", "", false},
		{"invalid local port", "true", "", "127.0.0.1:0", local, "http://127.0.0.1:3302", "", false},
		{"container wrong bind", "true", "true", "0.0.0.0:8081", container, "http://identity:3302", "", false},
		{"local admin", "true", "", "127.0.0.1:23203", strings.Replace(local, "bthwani_wlt_reader", "postgres", 1), "http://127.0.0.1:3302", "", false},
		{"container admin", "true", "true", "0.0.0.0:8080", strings.Replace(container, "bthwani_wlt_reader", "postgres", 1), "http://identity:3302", "", false},
		{"local wrong database", "true", "", "127.0.0.1:23203", strings.Replace(local, "bthwani_wlt_test", "samrim", 1), "http://127.0.0.1:3302", "", false},
		{"container wrong database", "true", "true", "0.0.0.0:8080", strings.Replace(container, "bthwani_wlt_test", "bthwani_refoundation", 1), "http://identity:3302", "", false},
		{"foreign database", "true", "true", "0.0.0.0:8080", strings.Replace(container, "postgres:5432", "example.invalid:5432", 1), "http://identity:3302", "", false},
		{"container loopback database", "true", "true", "0.0.0.0:8080", local, "http://identity:3302", "", false},
		{"local foreign database", "true", "", "127.0.0.1:23203", container, "http://127.0.0.1:3302", "", false},
		{"local query override", "true", "", "127.0.0.1:23203", local + "&host=other", "http://127.0.0.1:3302", "", false},
		{"container query override", "true", "true", "0.0.0.0:8080", container + "&host=other", "http://identity:3302", "", false},
		{"foreign container Identity", "true", "true", "0.0.0.0:8080", container, "http://example.invalid:3302", "", false},
		{"loopback container Identity", "true", "true", "0.0.0.0:8080", container, "http://127.0.0.1:3302", "", false},
		{"foreign local Identity", "true", "", "127.0.0.1:23203", local, "http://example.invalid:3302", "", false},
		{"foreign local DSH", "true", "", "127.0.0.1:23203", local, "http://127.0.0.1:3302", "http://example.invalid:8080", false},
		{"loopback container DSH", "true", "true", "0.0.0.0:8080", container, "http://identity:3302", "http://127.0.0.1:8080", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			config, err := admitServingConfiguration(func(key string) string {
				return map[string]string{
					"BTHWANI_ISOLATED_TEST_MODE":      tc.mode,
					"BTHWANI_ISOLATED_CONTAINER_MODE": tc.containerFlag,
					"WLT_DEV_LISTEN_ADDR":             tc.address,
					"WLT_TEST_DATABASE_URL":           tc.database,
					"WLT_TEST_IDENTITY_ORIGIN":        tc.identity,
					"WLT_TEST_DSH_ORIGIN":             tc.dsh,
				}[key]
			})
			if err == nil {
				if config.containerMode != (tc.containerFlag == "true") {
					t.Fatal("admitted a different runtime mode")
				}
				// The connector refuses any actual SQL operation; handler construction is pure.
				db := sql.OpenDB(healthTestDriver{errors.New("unexpected database access")})
				defer db.Close()
				_, err = config.handler(db)
			}
			if (err == nil) != tc.want {
				t.Fatalf("runtime admission=%t want=%t", err == nil, tc.want)
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

func TestWLTStartupChild(t *testing.T) {
	if os.Getenv("BTHWANI_WLT_STARTUP_TEST_CHILD") != "1" {
		return
	}
	os.Args = []string{"wlt"}
	main()
	t.Fatal("invalid startup returned without rejection")
}

func TestWLTStartupRejectsBeforeDatabaseConnection(t *testing.T) {
	for _, tc := range []struct {
		name, mode, identity, dsh string
	}{
		{"mixed container and loopback", "true", "http://identity:3302", "http://dsh:8080"},
		{"unknown mode", "unknown", "http://127.0.0.1:3302", ""},
		{"foreign Identity", "", "http://example.invalid:3302", ""},
		{"foreign DSH", "", "http://127.0.0.1:3302", "http://example.invalid:8080"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			listener, err := net.Listen("tcp4", "127.0.0.1:0")
			if err != nil {
				t.Fatal(err)
			}
			var connections atomic.Int32
			done := make(chan struct{})
			go func() {
				defer close(done)
				for {
					conn, err := listener.Accept()
					if err != nil {
						return
					}
					connections.Add(1)
					conn.Close()
				}
			}()
			defer func() { listener.Close(); <-done }()
			exe, err := os.Executable()
			if err != nil {
				t.Fatal(err)
			}
			ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
			defer cancel()
			cmd := exec.CommandContext(ctx, exe, "-test.run=^TestWLTStartupChild$")
			cmd.Env = append(os.Environ(),
				"BTHWANI_WLT_STARTUP_TEST_CHILD=1",
				"BTHWANI_ISOLATED_TEST_MODE=true",
				"BTHWANI_ISOLATED_CONTAINER_MODE="+tc.mode,
				"WLT_DEV_LISTEN_ADDR=127.0.0.1:23203",
				"WLT_TEST_DATABASE_URL=postgres://bthwani_wlt_reader:synthetic-only@"+listener.Addr().String()+"/bthwani_wlt_test?sslmode=disable",
				"WLT_TEST_IDENTITY_ORIGIN="+tc.identity,
				"WLT_TEST_DSH_ORIGIN="+tc.dsh,
			)
			out, err := cmd.CombinedOutput()
			if err == nil || ctx.Err() != nil || connections.Load() != 0 {
				t.Fatalf("expected immediate startup denial with zero database connections, got connections=%d error=%v output=%s", connections.Load(), err, out)
			}
			if strings.Contains(string(out), "complete owner baseline") {
				t.Fatalf("configuration reached database admission: %s", out)
			}
		})
	}
}

func TestServingLifecycleDrainsActiveRequest(t *testing.T) {
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	entered, release, completed := make(chan struct{}), make(chan struct{}), make(chan struct{})
	defer func() {
		select {
		case <-release:
		default:
			close(release)
		}
	}()
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	server := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		close(entered)
		select {
		case <-release:
			_, _ = io.WriteString(w, "finished")
			close(completed)
		case <-r.Context().Done():
		}
	})}
	defer server.Close()
	served := make(chan error, 1)
	go func() { served <- serveDevelopment(ctx, server, listener, 3*time.Second) }()
	client := &http.Client{Timeout: 4 * time.Second, Transport: &http.Transport{DisableKeepAlives: true}}
	defer client.CloseIdleConnections()
	response := make(chan error, 1)
	go func() {
		r, err := client.Get("http://" + listener.Addr().String())
		if err == nil {
			defer r.Body.Close()
			body, readErr := io.ReadAll(r.Body)
			if readErr != nil || r.StatusCode != 200 || string(body) != "finished" {
				err = errors.New("in-flight request not completed")
			}
		}
		response <- err
	}()
	select {
	case <-entered:
	case <-time.After(time.Second):
		t.Fatal("request did not enter")
	}
	cancel()
	deadline := time.Now().Add(time.Second)
	for {
		conn, err := net.DialTimeout("tcp", listener.Addr().String(), 50*time.Millisecond)
		if err != nil {
			break
		}
		conn.Close()
		if time.Now().After(deadline) {
			t.Fatal("listener did not stop accepting connections")
		}
		time.Sleep(10 * time.Millisecond)
	}
	select {
	case err := <-served:
		t.Fatalf("server returned before drain: %v", err)
	default:
	}
	close(release)
	select {
	case err := <-response:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(4 * time.Second):
		t.Fatal("request did not finish")
	}
	select {
	case <-completed:
	default:
		t.Fatal("handler did not complete")
	}
	select {
	case err := <-served:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(4 * time.Second):
		t.Fatal("server did not stop")
	}
}

func TestServingLifecycleBoundsUnfinishedRequest(t *testing.T) {
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	entered, interrupted := make(chan struct{}), make(chan struct{})
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	server := &http.Server{Handler: http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		close(entered)
		<-r.Context().Done()
		close(interrupted)
	})}
	defer server.Close()
	served := make(chan error, 1)
	go func() { served <- serveDevelopment(ctx, server, listener, 50*time.Millisecond) }()
	client := &http.Client{Timeout: 3 * time.Second}
	response := make(chan error, 1)
	go func() {
		r, err := client.Get("http://" + listener.Addr().String())
		if r != nil {
			r.Body.Close()
		}
		response <- err
	}()
	select {
	case <-entered:
	case <-time.After(time.Second):
		t.Fatal("request did not enter")
	}
	cancel()
	select {
	case err := <-served:
		if !errors.Is(err, context.DeadlineExceeded) {
			t.Fatalf("expected bounded shutdown failure, got %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("shutdown deadline not enforced")
	}
	select {
	case <-interrupted:
	case <-time.After(time.Second):
		t.Fatal("unfinished connection not closed")
	}
	select {
	case err := <-response:
		if err == nil {
			t.Fatal("interrupted request reported success")
		}
	case <-time.After(time.Second):
		t.Fatal("client did not observe interruption")
	}
}

func TestServingLifecycleReportsUnexpectedListenerFailure(t *testing.T) {
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	if err := listener.Close(); err != nil {
		t.Fatal(err)
	}
	server := &http.Server{}
	if err := serveDevelopment(t.Context(), server, listener, time.Second); err == nil {
		t.Fatal("unexpected listener failure was accepted")
	}
}

func TestServingLifecycleCancelledBeforeStart(t *testing.T) {
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	if err := serveDevelopment(ctx, &http.Server{}, listener, time.Second); err != nil {
		t.Fatal(err)
	}
	if conn, err := net.DialTimeout("tcp", listener.Addr().String(), time.Second); err == nil {
		conn.Close()
		t.Fatal("cancelled server retained listener")
	}
}
