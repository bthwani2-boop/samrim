package identityclient

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestParseEndpointRequiresExactAuthorizedHost(t *testing.T) {
	if _, err := ParseEndpoint("https://identity.example.com", nil); err == nil {
		t.Fatal("endpoint without an authorized host was accepted")
	}
	if _, err := ParseEndpoint("https://identity.example.com", []string{"other.example.com"}); err == nil {
		t.Fatal("endpoint outside the authorized host list was accepted")
	}
	if _, err := ParseEndpoint("https://identity.example.com?redirect=http://internal", []string{"identity.example.com"}); err == nil {
		t.Fatal("endpoint with a query was accepted")
	}
	endpoint, err := ParseEndpoint("https://identity.example.com/", []string{"identity.example.com"})
	if err != nil {
		t.Fatal(err)
	}
	if got := endpoint.String(); got != "https://identity.example.com" {
		t.Fatalf("endpoint = %q", got)
	}
}

func TestClientKeepsRequestOnAuthorizedIdentityOrigin(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/identity/readiness" {
			t.Fatalf("request path = %q", r.URL.Path)
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	defer server.Close()

	endpoint, err := ParseEndpoint(server.URL, []string{"127.0.0.1"})
	if err != nil {
		t.Fatal(err)
	}
	client, err := New(endpoint, "identity-service-token-123456789")
	if err != nil {
		t.Fatal(err)
	}
	if err := client.Readiness(context.Background()); err != nil {
		t.Fatal(err)
	}

	if _, err := client.requestURL("//attacker.invalid/identity/readiness"); err == nil || !strings.Contains(err.Error(), "request path is invalid") {
		t.Fatalf("absolute-path override was accepted: %v", err)
	}
}
