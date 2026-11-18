package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCaptainStandingRoutesRemainOffUnlessIsolatedAndLoopback(t *testing.T) {
	public := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) })
	routes, err := isolatedCaptainStandingHandler(nil, "dsh", public, nil)
	if err != nil {
		t.Fatal(err)
	}
	w := httptest.NewRecorder()
	routes.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/public", nil))
	if w.Code != http.StatusNoContent {
		t.Fatalf("public fallback changed: %d", w.Code)
	}
	t.Setenv("DSH_ENABLE_ISOLATED_CAPTAIN_STANDING", "true")
	t.Setenv("BTHWANI_ISOLATED_TEST_MODE", "true")
	t.Setenv("DSH_LISTEN_ADDR", "0.0.0.0:8080")
	if _, err = isolatedCaptainStandingHandler(nil, "dsh_test_captain_a02", public, nil); err == nil {
		t.Fatal("public listener exposed protected Captain API")
	}
	t.Setenv("DSH_LISTEN_ADDR", "127.0.0.1:3301")
	if _, err = isolatedCaptainStandingHandler(nil, "dsh", public, nil); err == nil {
		t.Fatal("protected DSH schema accepted")
	}
}
