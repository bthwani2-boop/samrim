package main

import (
	"database/sql"
	"fmt"
	"net"
	"net/http"
	"os"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/captainstanding"
)

// This owner-backed API is unavailable unless a separately isolated local
// development database and a loopback listener are explicitly configured.
func isolatedCaptainStandingHandler(db *sql.DB, schema string, next http.Handler, origins map[string]bool) (http.Handler, error) {
	if os.Getenv("DSH_ENABLE_ISOLATED_CAPTAIN_STANDING") != "true" {
		return next, nil
	}
	listen := os.Getenv("DSH_LISTEN_ADDR")
	host, _, err := net.SplitHostPort(listen)
	loopback := err == nil && (host == "127.0.0.1" || host == "::1")
	// The only permitted container variant is the existing isolated DSH
	// runtime, whose host port is published on Lenovo loopback by Compose.
	container := os.Getenv("BTHWANI_ISOLATED_CONTAINER_MODE") == "true" &&
		listen == "0.0.0.0:8080" &&
		os.Getenv("DSH_IDENTITY_VERIFIER_URL") == isolatedDSHVerifierURL
	if os.Getenv("BTHWANI_ISOLATED_TEST_MODE") != "true" ||
		!isolatedDSHSchema.MatchString(schema) || (!loopback && !container) {
		return nil, fmt.Errorf("Captain standing requires isolated DSH schema and verified transport")
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
	private := privateOwnerCORS(handler, origins, http.MethodGet, http.MethodPost, http.MethodPatch)
	mux := http.NewServeMux()
	// One-way public intake is an independent, explicit isolated opt-in.
	// Existing authenticated Captain standing must not expose it implicitly.
	if os.Getenv("DSH_ENABLE_ISOLATED_CAPTAIN_INTEREST") == "true" {
		interestRepo, err := captainstanding.NewPostgresInterestRepository(db, schema)
		if err != nil {
			return nil, err
		}
		interest := privateOwnerCORS(
			captainstanding.NewInterestHTTPHandler(captainstanding.NewInterestService(identity, interestRepo)), origins, http.MethodGet, http.MethodPost, http.MethodPatch)
		mux.Handle(captainstanding.CaptainInterestPath, interest)
		mux.Handle(captainstanding.OperatorCaptainInterestPath, interest)
		mux.Handle(captainstanding.OperatorCaptainInterestPath+"/", interest)
	}
	mux.Handle(captainstanding.CaptainStandingPath, private)
	mux.Handle(captainstanding.CaptainEligibilityPath, private)
	mux.Handle(captainstanding.CaptainApplicationPath, private)
	mux.Handle(captainstanding.OperatorCaptainsPath, private)
	mux.Handle("/v1/operators/captains/", private)
	mux.Handle("/", next)
	return mux, nil
}
