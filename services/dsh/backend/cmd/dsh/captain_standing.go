package main

import (
	"database/sql"
	"fmt"
	"net"
	"net/http"
	"os"
	"strings"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/captainstanding"
)

// This owner-backed API is unavailable unless a separately isolated local
// development database and a loopback listener are explicitly configured.
func isolatedCaptainStandingHandler(db *sql.DB, schema string, next http.Handler, origins map[string]bool) (http.Handler, error) {
	if os.Getenv("DSH_ENABLE_ISOLATED_CAPTAIN_STANDING") != "true" {
		return next, nil
	}
	host, _, err := net.SplitHostPort(os.Getenv("DSH_LISTEN_ADDR"))
	if os.Getenv("BTHWANI_ISOLATED_TEST_MODE") != "true" || (host != "127.0.0.1" && host != "::1") || err != nil {
		return nil, fmt.Errorf("Captain standing endpoint requires isolated loopback development")
	}
	repo, err := captainstanding.NewPostgresRepository(db, schema)
	if err != nil {
		return nil, err
	}
	identity, err := captainstanding.NewIdentityAdapter(os.Getenv("DSH_IDENTITY_VERIFIER_URL"))
	if err != nil {
		return nil, err
	}
	handler := captainstanding.NewHTTPHandler(captainstanding.NewService(identity, repo))
	private := captainStandingCORS(handler, origins)
	mux := http.NewServeMux()
	mux.Handle(captainstanding.CaptainStandingPath, private)
	mux.Handle(captainstanding.CaptainEligibilityPath, private)
	mux.Handle(captainstanding.CaptainApplicationPath, private)
	mux.Handle(captainstanding.OperatorCaptainsPath, private)
	mux.Handle("/v1/operators/captains/", private)
	mux.Handle("/", next)
	return mux, nil
}

// No wildcard CORS or cookie credentials: every request uses an Identity
// bearer and gets authorization checked again inside the current DSH owner.
func captainStandingCORS(next http.Handler, origins map[string]bool) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Vary", "Origin, Access-Control-Request-Method, Access-Control-Request-Headers")
		origin := r.Header.Get("Origin")
		if origin == "" {
			next.ServeHTTP(w, r)
			return
		}
		if origin == "null" || !origins[origin] {
			w.WriteHeader(http.StatusForbidden)
			return
		}
		w.Header().Set("Access-Control-Allow-Origin", origin)
		if r.Method != http.MethodOptions {
			next.ServeHTTP(w, r)
			return
		}
		method := r.Header.Get("Access-Control-Request-Method")
		if method != http.MethodGet && method != http.MethodPost && method != http.MethodPatch {
			w.WriteHeader(http.StatusForbidden)
			return
		}
		for _, key := range strings.Split(r.Header.Get("Access-Control-Request-Headers"), ",") {
			normalized := strings.ToLower(strings.TrimSpace(key))
			if normalized != "" && normalized != "authorization" && normalized != "content-type" {
				w.WriteHeader(http.StatusForbidden)
				return
			}
		}
		w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PATCH")
		w.WriteHeader(http.StatusNoContent)
	})
}
