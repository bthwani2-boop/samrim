package main

import (
	"database/sql"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
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
