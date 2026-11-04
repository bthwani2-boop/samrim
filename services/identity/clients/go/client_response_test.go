package identityclient

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"
)

func newResponseTestClient(t *testing.T, server *httptest.Server) *Client {
	t.Helper()
	parsed, err := url.Parse(server.URL)
	if err != nil {
		t.Fatal(err)
	}
	endpoint, err := ParseEndpoint(server.URL, []string{parsed.Hostname()})
	if err != nil {
		t.Fatal(err)
	}
	client, err := New(endpoint, "isolated-identity-client-test-token")
	if err != nil {
		t.Fatal(err)
	}
	return client
}

func TestErrorResponseStalledBodyPreservesDeadline(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
		w.(http.Flusher).Flush()
		<-r.Context().Done() // headers are 404, but body never finishes
	}))
	defer server.Close()
	client := newResponseTestClient(t, server)
	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()
	err := client.do(ctx, http.MethodGet, "/missing", "", nil, nil)
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("timeout after 404 headers must not become actor-not-found: %v", err)
	}
}

func TestCompletedIdentity404RemainsNotFound(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte(`{"error":{"code":"NOT_FOUND","message":"missing"}}`))
	}))
	defer server.Close()
	client := newResponseTestClient(t, server)
	err := client.do(context.Background(), http.MethodGet, "/missing", "", nil, nil)
	var status *Error
	if !errors.As(err, &status) || status.Status != http.StatusNotFound || status.Code != "NOT_FOUND" {
		t.Fatalf("completed 404 must retain its canonical error: %v", err)
	}
}
