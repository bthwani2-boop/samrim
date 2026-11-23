package main

import (
	"crypto/tls"
	"crypto/x509"
	"encoding/pem"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestIsolatedCaptainTLSOnlyAllowsReadOnAdmittedContainer(t *testing.T) {
	seed := httptest.NewTLSServer(http.NotFoundHandler())
	defer seed.Close()
	pair := seed.TLS.Certificates[0]
	dir := t.TempDir()
	cert, key := filepath.Join(dir, "server.pem"), filepath.Join(dir, "server-key.pem")
	if err := os.WriteFile(cert, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: pair.Certificate[0]}), 0600); err != nil {
		t.Fatal(err)
	}
	keyBytes, err := x509.MarshalPKCS8PrivateKey(pair.PrivateKey)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(key, pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: keyBytes}), 0600); err != nil {
		t.Fatal(err)
	}
	env := map[string]string{
		"BTHWANI_ISOLATED_TEST_MODE": "true", "BTHWANI_ISOLATED_CONTAINER_MODE": "true",
		"DSH_ENABLE_ISOLATED_CAPTAIN_STANDING": "true", "DSH_LISTEN_ADDR": "0.0.0.0:8080",
		"DSH_IDENTITY_VERIFIER_URL":     isolatedDSHVerifierURL,
		"DSH_ISOLATED_CAPTAIN_TLS_CERT": cert, "DSH_ISOLATED_CAPTAIN_TLS_KEY": key,
	}
	get := func(name string) string { return env[name] }
	owner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusUnauthorized) })
	server, err := isolatedCaptainTLS("dsh_test_captain", get, owner)
	if err != nil || server == nil || server.Addr != "0.0.0.0:3344" || server.TLSConfig.MinVersion != tls.VersionTLS12 {
		t.Fatalf("valid isolated listener: %v", err)
	}
	for _, c := range []struct {
		method, path string
		want         int
	}{
		{"GET", "/v1/actors/me/captain-eligibility", 401},
		{"POST", "/v1/actors/me/captain-eligibility", 405},
		{"GET", "/v1/operators/captains", 404},
		{"POST", "/v1/actors/me/captain-application", 404},
	} {
		w := httptest.NewRecorder()
		server.Handler.ServeHTTP(w, httptest.NewRequest(c.method, c.path, nil))
		if w.Code != c.want {
			t.Fatalf("%s %s got %d", c.method, c.path, w.Code)
		}
	}
	for _, k := range []string{"BTHWANI_ISOLATED_TEST_MODE", "BTHWANI_ISOLATED_CONTAINER_MODE", "DSH_ENABLE_ISOLATED_CAPTAIN_STANDING", "DSH_LISTEN_ADDR", "DSH_IDENTITY_VERIFIER_URL", "DSH_ISOLATED_CAPTAIN_TLS_KEY"} {
		previous := env[k]
		env[k] = ""
		if _, err := isolatedCaptainTLS("dsh_test_captain", get, owner); err == nil {
			t.Fatalf("unsafe missing %s accepted", k)
		}
		env[k] = previous
	}
	if _, err := isolatedCaptainTLS("public", get, owner); err == nil {
		t.Fatal("non-isolated schema accepted")
	}
	delete(env, "DSH_ISOLATED_CAPTAIN_TLS_CERT")
	delete(env, "DSH_ISOLATED_CAPTAIN_TLS_KEY")
	if server, err := isolatedCaptainTLS("dsh_test_captain", get, owner); err != nil || server != nil {
		t.Fatal("default listener not disabled")
	}
}
