package main

import (
	"database/sql"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

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

func TestPrivatePolicyPreflightCannotAuthorizePolicyMutation(t *testing.T) {
	origin := "http://127.0.0.1:18102"
	readonly := storePolicyCORS(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	}), map[string]bool{origin: true})
	for _, tc := range []struct {
		name, origin, method string
		want                 int
	}{
		{"approved read preflight", origin, "GET", http.StatusNoContent},
		{"approved scoped policy write preflight", origin, "PATCH", http.StatusNoContent},
		{"unapproved policy delete preflight", origin, "DELETE", http.StatusForbidden},
		{"unrelated origin", "http://evil.invalid", "GET", http.StatusForbidden},
	} {
		t.Run(tc.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodOptions, "/v1/operators/cities/city-a/store-availability-policy", nil)
			request.Header.Set("Origin", tc.origin)
			request.Header.Set("Access-Control-Request-Method", tc.method)
			request.Header.Set("Access-Control-Request-Headers", "authorization")
			rec := httptest.NewRecorder()
			readonly.ServeHTTP(rec, request)
			if rec.Code != tc.want {
				t.Fatalf("%s returned %d expected %d", tc.name, rec.Code, tc.want)
			}
			if tc.want == http.StatusNoContent && rec.Header().Get("Access-Control-Allow-Methods") != "GET, PATCH" {
				t.Fatal("Operator policy preflight advertised unexpected methods")
			}
		})
	}
}
