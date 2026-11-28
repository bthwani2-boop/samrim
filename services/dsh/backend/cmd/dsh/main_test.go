package main

import (
	"context"
	"database/sql"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestCustomerCartDockerOptInRequiresIsolatedContainerAndOwner(t *testing.T) {
	public := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusTeapot)
	})
	t.Setenv("DSH_ENABLE_ISOLATED_CUSTOMER_CART", "")
	h, err := isolatedCustomerCartHandler(nil, "dsh", ":8080", public)
	if err != nil {
		t.Fatal(err)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", "/v1/carts/store-a", nil))
	if rec.Code != http.StatusTeapot {
		t.Fatal("cart became available without owner opt-in")
	}

	db, err := sql.Open("postgres", "postgres://fake:fake@127.0.0.1:1/synthetic?sslmode=disable")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	t.Setenv("DSH_ENABLE_ISOLATED_CUSTOMER_CART", "true")
	t.Setenv("DSH_IDENTITY_VERIFIER_URL", "https://identity:3343")
	t.Setenv("DSH_DB_HOST", "postgres")
	t.Setenv("REF_POSTGRES_DB", "bthwani_dsh_dev")
	for _, tc := range []struct {
		name, isolated, container, schema, addr string
		allowed                                 bool
	}{
		{"isolated Docker", "true", "true", "dsh_test_cart_docker", "0.0.0.0:8080", true},
		{"missing isolation", "", "true", "dsh_test_cart_docker", "0.0.0.0:8080", false},
		{"missing container approval", "true", "", "dsh_test_cart_docker", "0.0.0.0:8080", false},
		{"protected schema", "true", "true", "dsh", "0.0.0.0:8080", false},
		{"arbitrary listener", "true", "true", "dsh_test_cart_docker", "0.0.0.0:9090", false},
		{"unspecified listener", "true", "true", "dsh_test_cart_docker", ":8080", false},
		{"untrusted Docker verifier", "true", "true", "dsh_test_cart_docker", "0.0.0.0:8080", false},
		{"loopback mode", "true", "", "dsh_test_cart_docker", "127.0.0.1:8080", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("BTHWANI_ISOLATED_TEST_MODE", tc.isolated)
			t.Setenv("BTHWANI_ISOLATED_CONTAINER_MODE", tc.container)
			if tc.name == "untrusted Docker verifier" {
				t.Setenv("DSH_IDENTITY_VERIFIER_URL", "https://outside.example")
			}
			h, err := isolatedCustomerCartHandler(db, tc.schema, tc.addr, public)
			if tc.allowed && err != nil {
				t.Fatalf("safe Cart opt-in refused: %v", err)
			}
			if !tc.allowed && err == nil {
				t.Fatalf("unsafe Cart opt-in accepted")
			}
			if tc.allowed {
				rec := httptest.NewRecorder()
				h.ServeHTTP(rec, httptest.NewRequest("GET", "/v1/carts/store-a", nil))
				if rec.Code != http.StatusUnauthorized {
					t.Fatalf("Cart route did not enforce current Identity: %d", rec.Code)
				}
				rec = httptest.NewRecorder()
				h.ServeHTTP(rec, httptest.NewRequest("GET", "/v1/carts", nil))
				if rec.Code != http.StatusUnauthorized {
					t.Fatalf("Cart directory mount did not enforce Identity: %d", rec.Code)
				}
			}
		})
	}
}

func TestAvailabilityMountIsAbsentUnlessIsolatedAndExplicitlyEnabled(t *testing.T) {
	public := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusTeapot)
	})
	t.Setenv("DSH_ENABLE_ISOLATED_STORE_AVAILABILITY", "")
	h, err := isolatedStoreAvailabilityHandler(nil, "dsh", public, nil)
	if err != nil || h == nil {
		t.Fatalf("public-only default was not constructed: err=%v", err)
	}
	unchanged := httptest.NewRecorder()
	h.ServeHTTP(unchanged, httptest.NewRequest("GET", "/v1/stores/store-1/availability", nil))
	if unchanged.Code != http.StatusTeapot {
		t.Fatalf("non-opted-in request no longer uses existing public handler: %d", unchanged.Code)
	}
	t.Setenv("DSH_ENABLE_ISOLATED_STORE_AVAILABILITY", "true")
	t.Setenv("DSH_LISTEN_ADDR", "127.0.0.1:18080")
	for _, c := range []struct {
		name, isolated, schema, identity string
	}{
		{"protected schema", "true", "dsh", "http://127.0.0.1:3302"},
		{"missing isolation", "", "dsh_test_a02", "http://127.0.0.1:3302"},
		{"empty synthetic suffix", "true", "dsh_test_", "http://127.0.0.1:3302"},
		{"untrusted Identity", "true", "dsh_test_a02", "http://identity:3302"},
	} {
		t.Run(c.name, func(t *testing.T) {
			t.Setenv("BTHWANI_ISOLATED_TEST_MODE", c.isolated)
			t.Setenv("DSH_IDENTITY_VERIFIER_URL", c.identity)
			if _, err := isolatedStoreAvailabilityHandler(nil, c.schema, public, nil); err == nil {
				t.Fatal("protected Store operation started outside a verified development boundary")
			}
		})
	}
}

func TestProtectedAvailabilityCannotBindWildcardAddress(t *testing.T) {
	t.Setenv("DSH_ENABLE_ISOLATED_STORE_AVAILABILITY", "true")
	t.Setenv("BTHWANI_ISOLATED_TEST_MODE", "true")
	t.Setenv("DSH_IDENTITY_VERIFIER_URL", "http://127.0.0.1:3302")
	public := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) })
	for _, addr := range []string{"", ":8080", "0.0.0.0:8080", "example.com:8080"} {
		t.Setenv("DSH_LISTEN_ADDR", addr)
		_, err := isolatedStoreAvailabilityHandler(nil, "dsh_test_a02", public, nil)
		if err == nil || !strings.Contains(err.Error(), "loopback") {
			t.Fatalf("unsafe address %q accepted or denied for the wrong reason: %v", addr, err)
		}
	}
}

func TestOptInHandlerForwardsPublicReadsAndProtectsStoreMutation(t *testing.T) {
	t.Setenv("DSH_LISTEN_ADDR", "127.0.0.1:18080")
	t.Setenv("DSH_ENABLE_ISOLATED_STORE_AVAILABILITY", "true")
	t.Setenv("BTHWANI_ISOLATED_TEST_MODE", "true")
	t.Setenv("DSH_IDENTITY_VERIFIER_URL", "http://127.0.0.1:3302")
	// sql.Open does not connect. This proves router composition only; real
	// Identity and PostgreSQL persistence are tested separately end to end.
	db, err := sql.Open("postgres", "postgres://test:test@127.0.0.1:1/synthetic?sslmode=disable")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	public := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/health" {
			t.Fatalf("private path leaked into the public discovery handler: %s", r.URL.Path)
		}
		w.WriteHeader(http.StatusNoContent)
	})
	handler, err := isolatedStoreAvailabilityHandler(db, "dsh_test_a02", public, map[string]bool{"http://127.0.0.1:18102": true})
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		method, path string
		status       int
	}{
		{"GET", "/health", 204},
		{"GET", "/v1/stores/store-1/availability", 401},
		{"PATCH", "/v1/stores/store-1/availability", 401},
		{"GET", "/v1/operators/cities/city-a/store-availability-policy", 401},
		{"PATCH", "/v1/operators/cities/city-a/store-availability-policy", 401},
	} {
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, httptest.NewRequest(tc.method, tc.path, nil))
		if rec.Code != tc.status {
			t.Fatalf("%s %s returned %d, expected %d", tc.method, tc.path, rec.Code, tc.status)
		}
	}
}

func TestProtectedStoreCorsDoesNotGrantAuthorization(t *testing.T) {
	t.Setenv("DSH_LISTEN_ADDR", "127.0.0.1:18080")
	t.Setenv("DSH_ENABLE_ISOLATED_STORE_AVAILABILITY", "true")
	t.Setenv("BTHWANI_ISOLATED_TEST_MODE", "true")
	t.Setenv("DSH_IDENTITY_VERIFIER_URL", "http://127.0.0.1:3302")
	db, err := sql.Open("postgres", "postgres://test:test@127.0.0.1:1/synthetic?sslmode=disable")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	allowed := "http://127.0.0.1:18102"
	handler, err := isolatedStoreAvailabilityHandler(db, "dsh_test_a02",
		http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusTeapot) }),
		map[string]bool{allowed: true})
	if err != nil {
		t.Fatal(err)
	}
	path := "/v1/stores/store-1/availability"
	for _, tc := range []struct {
		name, origin, method, preflightMethod, headers string
		want                                           int
		allowOrigin                                    bool
	}{
		{"valid preflight", allowed, "OPTIONS", "PATCH", "authorization, content-type", 204, true},
		{"unauthorized preflight", "http://evil.invalid", "OPTIONS", "PATCH", "authorization", 403, false},
		{"untrusted null origin", "null", "OPTIONS", "PATCH", "authorization", 403, false},
		{"unsupported method", allowed, "OPTIONS", "DELETE", "authorization", 403, true},
		{"untrusted header", allowed, "OPTIONS", "PATCH", "x-admin", 403, true},
		{"actual request still requires bearer", allowed, "GET", "", "", 401, true},
		{"no origin still requires bearer", "", "GET", "", "", 401, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(tc.method, path, nil)
			if tc.origin != "" {
				req.Header.Set("Origin", tc.origin)
			}
			if tc.preflightMethod != "" {
				req.Header.Set("Access-Control-Request-Method", tc.preflightMethod)
				req.Header.Set("Access-Control-Request-Headers", tc.headers)
			}
			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, req)
			if rec.Code != tc.want {
				t.Fatalf("status=%d want=%d", rec.Code, tc.want)
			}
			if tc.allowOrigin && rec.Header().Get("Access-Control-Allow-Origin") != allowed {
				t.Fatal("configured origin was not echoed")
			}
			if !tc.allowOrigin && rec.Header().Get("Access-Control-Allow-Origin") != "" {
				t.Fatal("untrusted origin received CORS access")
			}
			if rec.Header().Get("Access-Control-Allow-Credentials") != "" {
				t.Fatal("cookie credentials must not be exposed")
			}
			if rec.Header().Get("Cache-Control") != "no-store" {
				t.Fatal("protected response was cacheable")
			}
		})
	}
}

func TestCustomerCartContainerRejectsUnverifiedDatabaseTransport(t *testing.T) {
	t.Setenv("DSH_ENABLE_ISOLATED_CUSTOMER_CART", "true")
	t.Setenv("BTHWANI_ISOLATED_TEST_MODE", "true")
	t.Setenv("BTHWANI_ISOLATED_CONTAINER_MODE", "true")
	t.Setenv("DSH_IDENTITY_VERIFIER_URL", isolatedDSHVerifierURL)
	db, err := sql.Open("postgres", "postgres://synthetic@127.0.0.1:1/unused?sslmode=disable")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	fallback := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusTeapot) })
	for _, tc := range []struct{ name, host, database string }{
		{"foreign host", "outside.invalid", "bthwani_dsh_dev"},
		{"protected database", "postgres", "production"},
		{"empty database", "postgres", ""},
		{"empty host", "", "bthwani_dsh_dev"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("DSH_DB_HOST", tc.host)
			t.Setenv("REF_POSTGRES_DB", tc.database)
			h, err := isolatedCustomerCartHandler(db, "dsh_test_cart", "0.0.0.0:8080", fallback)
			if h != nil || err == nil {
				t.Fatal("unverified database transport admitted cart, address and favorite routes")
			}
		})
	}
}

func TestDSHServingLifecycleDrainsBothListeners(t *testing.T) {
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	seed := httptest.NewTLSServer(http.NotFoundHandler())
	defer seed.Close()
	entered := make(chan string, 2)
	release := make(chan struct{})
	defer func() {
		select {
		case <-release:
		default:
			close(release)
		}
	}()
	handler := func(name string) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			entered <- name
			select {
			case <-release:
				_, _ = io.WriteString(w, name)
			case <-r.Context().Done():
			}
		})
	}
	public := &http.Server{Addr: "127.0.0.1:0", Handler: handler("public")}
	private := &http.Server{Addr: "127.0.0.1:0", Handler: handler("private"), TLSConfig: seed.TLS.Clone()}
	endpoints, err := bindDSHServers(public, private)
	if err != nil {
		t.Fatal(err)
	}
	defer public.Close()
	defer private.Close()
	served := make(chan error, 1)
	go func() { served <- serveDSH(ctx, endpoints, 3*time.Second) }()
	results := make(chan error, 2)
	request := func(client *http.Client, url, expected string) {
		r, err := client.Get(url)
		if err == nil {
			defer r.Body.Close()
			body, readErr := io.ReadAll(r.Body)
			if readErr != nil || r.StatusCode != 200 || string(body) != expected {
				err = errors.New("in-flight request not completed")
			}
		}
		results <- err
	}
	publicClient := &http.Client{Timeout: 4 * time.Second}
	defer publicClient.CloseIdleConnections()
	privateClient := seed.Client()
	privateClient.Timeout = 4 * time.Second
	go request(publicClient, "http://"+endpoints[0].listener.Addr().String(), "public")
	go request(privateClient, "https://"+endpoints[1].listener.Addr().String(), "private")
	seen := map[string]bool{}
	for range 2 {
		select {
		case name := <-entered:
			seen[name] = true
		case <-time.After(2 * time.Second):
			t.Fatal("both listeners did not accept requests")
		}
	}
	if !seen["public"] || !seen["private"] {
		t.Fatal("wrong listeners served")
	}
	cancel()
	for _, ep := range endpoints {
		deadline := time.Now().Add(2 * time.Second)
		for {
			conn, err := net.DialTimeout("tcp", ep.listener.Addr().String(), 50*time.Millisecond)
			if err != nil {
				break
			}
			conn.Close()
			if time.Now().After(deadline) {
				t.Fatal("listener still accepts connections")
			}
			time.Sleep(10 * time.Millisecond)
		}
	}
	select {
	case err := <-served:
		t.Fatalf("server returned before draining: %v", err)
	default:
	}
	close(release)
	for range 2 {
		select {
		case err := <-results:
			if err != nil {
				t.Fatal(err)
			}
		case <-time.After(4 * time.Second):
			t.Fatal("active request not drained")
		}
	}
	select {
	case err := <-served:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(4 * time.Second):
		t.Fatal("lifecycle did not finish")
	}
}

func TestDSHServingLifecycleRollsBackPartialBind(t *testing.T) {
	occupied, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer occupied.Close()
	probe, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	address := probe.Addr().String()
	probe.Close()
	endpoints, err := bindDSHServers(&http.Server{Addr: address}, &http.Server{Addr: occupied.Addr().String()})
	if err == nil || len(endpoints) != 0 {
		t.Fatal("partial bind accepted")
	}
	rebound, err := net.Listen("tcp4", address)
	if err != nil {
		t.Fatalf("public listener leaked: %v", err)
	}
	rebound.Close()
}

func TestDSHServingLifecycleFailureStopsPeer(t *testing.T) {
	public := &http.Server{Addr: "127.0.0.1:0"}
	private := &http.Server{Addr: "127.0.0.1:0"}
	endpoints, err := bindDSHServers(public, private)
	if err != nil {
		t.Fatal(err)
	}
	defer public.Close()
	defer private.Close()
	if err := endpoints[1].listener.Close(); err != nil {
		t.Fatal(err)
	}
	if err := serveDSH(t.Context(), endpoints, time.Second); err == nil {
		t.Fatal("unexpected listener failure accepted")
	}
	if conn, err := net.DialTimeout("tcp", endpoints[0].listener.Addr().String(), time.Second); err == nil {
		conn.Close()
		t.Fatal("public peer remained listening")
	}
}

func TestDSHServingLifecycleBoundsUnfinishedRequest(t *testing.T) {
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	entered, interrupted := make(chan struct{}), make(chan struct{})
	public := &http.Server{Addr: "127.0.0.1:0", Handler: http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		close(entered)
		<-r.Context().Done()
		close(interrupted)
	})}
	endpoints, err := bindDSHServers(public, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer public.Close()
	served := make(chan error, 1)
	go func() { served <- serveDSH(ctx, endpoints, 50*time.Millisecond) }()
	client := &http.Client{Timeout: 3 * time.Second}
	defer client.CloseIdleConnections()
	response := make(chan error, 1)
	go func() {
		r, err := client.Get("http://" + endpoints[0].listener.Addr().String())
		if r != nil {
			r.Body.Close()
		}
		response <- err
	}()
	select {
	case <-entered:
	case <-time.After(2 * time.Second):
		t.Fatal("request did not enter")
	}
	cancel()
	select {
	case err := <-served:
		if !errors.Is(err, context.DeadlineExceeded) {
			t.Fatalf("expected shutdown deadline, got %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("unbounded shutdown")
	}
	select {
	case <-interrupted:
	case <-time.After(time.Second):
		t.Fatal("unfinished connection retained")
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
