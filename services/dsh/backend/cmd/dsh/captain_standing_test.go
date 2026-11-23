package main

import (
	"database/sql"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/captainstanding"
)

func TestCaptainStandingContainerAdmissionRequiresVerifiedIsolation(t *testing.T) {
	cases := []struct {
		name, testMode, containerMode, listen, verifier, schema string
		allow                                                   bool
	}{
		{"verified-container", "true", "true", "0.0.0.0:8080", isolatedDSHVerifierURL, "dsh_test_captain_a02", true},
		{"not-isolated-mode", "false", "true", "0.0.0.0:8080", isolatedDSHVerifierURL, "dsh_test_captain_a02", false},
		{"not-container-mode", "true", "false", "0.0.0.0:8080", isolatedDSHVerifierURL, "dsh_test_captain_a02", false},
		{"wrong-verifier", "true", "true", "0.0.0.0:8080", "http://identity:3302", "dsh_test_captain_a02", false},
		{"different-wildcard-port", "true", "true", "0.0.0.0:8081", isolatedDSHVerifierURL, "dsh_test_captain_a02", false},
		{"protected-schema", "true", "true", "0.0.0.0:8080", isolatedDSHVerifierURL, "dsh", false},
		{"loopback-development", "true", "false", "127.0.0.1:3301", isolatedDSHVerifierURL, "dsh_test_captain_a02", true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("DSH_ENABLE_ISOLATED_CAPTAIN_STANDING", "true")
			t.Setenv("DSH_ENABLE_ISOLATED_CAPTAIN_INTEREST", "false")
			t.Setenv("BTHWANI_ISOLATED_TEST_MODE", tc.testMode)
			t.Setenv("BTHWANI_ISOLATED_CONTAINER_MODE", tc.containerMode)
			t.Setenv("DSH_LISTEN_ADDR", tc.listen)
			t.Setenv("DSH_IDENTITY_VERIFIER_URL", tc.verifier)
			public := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) })
			handler, err := isolatedCaptainStandingHandler(&sql.DB{}, tc.schema, public, nil)
			if !tc.allow {
				if err == nil {
					t.Fatal("unsafe Captain transport was admitted")
				}
				return
			}
			if err != nil {
				t.Fatalf("verified isolated transport rejected: %v", err)
			}
			w := httptest.NewRecorder()
			handler.ServeHTTP(w, httptest.NewRequest(http.MethodGet, captainstanding.CaptainStandingPath, nil))
			if w.Code != http.StatusUnauthorized {
				t.Fatalf("unauthenticated Captain route must deny, received %d", w.Code)
			}
		})
	}
}

func TestCaptainStandingRoutesRemainOffUnlessIsolatedAndLoopback(t *testing.T) {
	t.Setenv("DSH_ENABLE_ISOLATED_CAPTAIN_STANDING", "false")
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
