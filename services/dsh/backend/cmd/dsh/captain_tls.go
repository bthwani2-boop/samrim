package main

import (
	"crypto/tls"
	"errors"
	"net/http"
	"time"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/captainstanding"
)

// The private reverse owner read uses the same authenticated standing handler.
// It cannot expose application, Operator mutation, or other DSH routes.
func isolatedCaptainTLS(schema string, getenv func(string) string, standing http.Handler) (*http.Server, error) {
	certPath, keyPath := getenv("DSH_ISOLATED_CAPTAIN_TLS_CERT"), getenv("DSH_ISOLATED_CAPTAIN_TLS_KEY")
	if certPath == "" && keyPath == "" {
		return nil, nil
	}
	if getenv("BTHWANI_ISOLATED_TEST_MODE") != "true" ||
		getenv("BTHWANI_ISOLATED_CONTAINER_MODE") != "true" ||
		getenv("DSH_ENABLE_ISOLATED_CAPTAIN_STANDING") != "true" ||
		getenv("DSH_LISTEN_ADDR") != "0.0.0.0:8080" ||
		getenv("DSH_IDENTITY_VERIFIER_URL") != isolatedDSHVerifierURL ||
		!isolatedDSHSchema.MatchString(schema) || certPath == "" || keyPath == "" || standing == nil {
		return nil, errors.New("Captain TLS requires the admitted isolated DSH container and both certificate files")
	}
	pair, err := tls.LoadX509KeyPair(certPath, keyPath)
	if err != nil {
		return nil, errors.New("Captain TLS certificate or key invalid")
	}
	routes := http.NewServeMux()
	routes.Handle("GET "+captainstanding.CaptainEligibilityPath, standing)
	// Never cache private responses, including mux-generated 404/405 errors.
	private := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		routes.ServeHTTP(w, r)
	})
	return &http.Server{
		Addr: "0.0.0.0:3344", Handler: private,
		TLSConfig:         &tls.Config{MinVersion: tls.VersionTLS12, Certificates: []tls.Certificate{pair}},
		ReadHeaderTimeout: 4 * time.Second, ReadTimeout: 6 * time.Second,
		WriteTimeout: 6 * time.Second, IdleTimeout: 20 * time.Second, MaxHeaderBytes: 8192,
	}, nil
}
