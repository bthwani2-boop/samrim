package main

import (
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/bthwani2-boop/samrim/services/identity/backend/internal/session"
)

func TestIsolatedVerifierTLSRequiresExplicitFilesAndScope(t *testing.T) {
	if cfg, err := isolatedVerifierTLS("", "", "", "", ""); err != nil || cfg != nil {
		t.Fatal("omitting both files must leave the private listener disabled")
	}
	for _, tc := range [][5]string{
		{"true", "true", "identity_test_local", "cert-only", ""},
		{"true", "", "identity_test_local", "cert", "key"},
		{"", "true", "identity_test_local", "cert", "key"},
		{"true", "true", "identity", "cert", "key"},
		{"true", "true", "identity_test_local", "missing-cert", "missing-key"},
	} {
		cfg, err := isolatedVerifierTLS(tc[0], tc[1], tc[2], tc[3], tc[4])
		if err == nil || cfg != nil {
			t.Fatalf("accepted invalid TLS scope or material: %v", tc)
		}
	}
}

func TestIsolatedDevelopmentListenerGate(t *testing.T) {
	for _, tc := range []struct {
		name, address, isolated, container, schema string
		allowed                                    bool
	}{
		{"local default", "127.0.0.1:3302", "true", "", "identity_test_agent03", true},
		{"local custom port", "127.0.0.1:3303", "true", "", "identity_test_agent03", true},
		{"container explicit", "0.0.0.0:3302", "true", "true", "identity_test_agent03", true},
		{"container not opted in", "0.0.0.0:3302", "true", "", "identity_test_agent03", false},
		{"non synthetic", "0.0.0.0:3302", "", "true", "identity_test_agent03", false},
		{"wrong schema", "0.0.0.0:3302", "true", "true", "dsh_test_agent03", false},
		{"empty suffix", "0.0.0.0:3302", "true", "true", "identity_test_", false},
		{"malformed schema", "0.0.0.0:3302", "true", "true", "identity_test_A", false},
		{"non default exposed port", "0.0.0.0:3303", "true", "true", "identity_test_agent03", false},
		{"IPv6 wildcard", "[::]:3302", "true", "true", "identity_test_agent03", false},
		{"hostname", "localhost:3302", "true", "true", "identity_test_agent03", false},
		{"public address", "192.0.2.4:3302", "true", "true", "identity_test_agent03", false},
		{"local without isolation", "127.0.0.1:3302", "", "", "identity_test_agent03", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if actual := allowedDevelopmentListen(tc.address, tc.isolated, tc.container, tc.schema); actual != tc.allowed {
				t.Fatalf("listener gate got %t want %t", actual, tc.allowed)
			}
		})
	}
}

func awaitIdentityTest[T any](t *testing.T, ch <-chan T) T {
	t.Helper()
	select {
	case value := <-ch:
		return value
	case <-time.After(5 * time.Second):
		t.Fatal("listener lifecycle timed out")
		var zero T
		return zero
	}
}

func TestIdentityListenersDrainHTTPAndTLS(t *testing.T) {
	template := httptest.NewTLSServer(http.NotFoundHandler())
	client := template.Client()
	client.Timeout = 5 * time.Second
	tlsConfig := template.TLS.Clone()
	template.Close()
	defer client.CloseIdleConnections()
	entered := make(chan struct{}, 2)
	draining := make(chan struct{}, 2)
	release := make(chan struct{})
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		entered <- struct{}{}
		select {
		case <-release:
			_, _ = io.WriteString(w, "completed")
		case <-r.Context().Done():
		}
	})
	servers := []*http.Server{
		{Addr: "127.0.0.1:0", Handler: handler},
		{Addr: "127.0.0.1:0", Handler: handler, TLSConfig: tlsConfig},
	}
	for _, server := range servers {
		server.RegisterOnShutdown(func() { draining <- struct{}{} })
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	endpoints, err := bindIdentityListeners(ctx, servers)
	if err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() { done <- serveIdentityListeners(ctx, endpoints, 3*time.Second) }()
	type reply struct {
		body string
		err  error
	}
	replies := make(chan reply, 2)
	for i, endpoint := range endpoints {
		scheme := "http://"
		if i == 1 {
			scheme = "https://"
		}
		go func() {
			response, err := client.Get(scheme + endpoint.socket.Addr().String())
			if err != nil {
				replies <- reply{err: err}
				return
			}
			defer response.Body.Close()
			body, err := io.ReadAll(response.Body)
			replies <- reply{body: string(body), err: err}
		}()
	}
	awaitIdentityTest(t, entered)
	awaitIdentityTest(t, entered)
	cancel()
	awaitIdentityTest(t, draining)
	awaitIdentityTest(t, draining)
	for _, endpoint := range endpoints {
		conn, err := net.DialTimeout("tcp", endpoint.socket.Addr().String(), time.Second)
		if err == nil {
			conn.Close()
			t.Fatal("new connection admitted during shutdown")
		}
	}
	select {
	case err := <-done:
		t.Fatalf("returned before active requests finished: %v", err)
	default:
	}
	close(release)
	for range endpoints {
		got := awaitIdentityTest(t, replies)
		if got.err != nil || got.body != "completed" {
			t.Fatalf("active request was interrupted: %+v", got)
		}
	}
	if err := awaitIdentityTest(t, done); err != nil {
		t.Fatal(err)
	}
}

func TestIdentityListenerBindFailureReleasesPriorSocket(t *testing.T) {
	reserved, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	address := reserved.Addr().String()
	reserved.Close()
	servers := []*http.Server{{Addr: address}, {Addr: address}}
	if endpoints, err := bindIdentityListeners(context.Background(), servers); err == nil || endpoints != nil {
		t.Fatal("partial listener bind admitted")
	}
	socket, err := net.Listen("tcp", address)
	if err != nil {
		t.Fatal("first listener leaked after second bind failed:", err)
	}
	socket.Close()
}

func TestIdentityListenerDeadlineClosesActiveConnection(t *testing.T) {
	entered := make(chan struct{})
	cancelled := make(chan struct{})
	server := &http.Server{Addr: "127.0.0.1:0", Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		close(entered)
		<-r.Context().Done()
		close(cancelled)
	})}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	endpoints, err := bindIdentityListeners(ctx, []*http.Server{server})
	if err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() { done <- serveIdentityListeners(ctx, endpoints, 100*time.Millisecond) }()
	client := &http.Client{Timeout: 5 * time.Second}
	defer client.CloseIdleConnections()
	reply := make(chan error, 1)
	go func() {
		response, err := client.Get("http://" + endpoints[0].socket.Addr().String())
		if response != nil {
			response.Body.Close()
		}
		reply <- err
	}()
	awaitIdentityTest(t, entered)
	cancel()
	if err := awaitIdentityTest(t, done); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("deadline failure was not reported: %v", err)
	}
	awaitIdentityTest(t, cancelled)
	if err := awaitIdentityTest(t, reply); err == nil {
		t.Fatal("connection remained open beyond the deadline")
	}
}

func TestIdentityListenerUnexpectedExitClosesPeer(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	endpoints, err := bindIdentityListeners(ctx, []*http.Server{{Addr: "127.0.0.1:0"}, {Addr: "127.0.0.1:0"}})
	if err != nil {
		t.Fatal(err)
	}
	endpoints[1].socket.Close()
	done := make(chan error, 1)
	go func() { done <- serveIdentityListeners(ctx, endpoints, time.Second) }()
	if err := awaitIdentityTest(t, done); err == nil {
		t.Fatal("unexpected listener failure accepted")
	}
	for _, endpoint := range endpoints {
		conn, err := net.DialTimeout("tcp", endpoint.socket.Addr().String(), time.Second)
		if err == nil {
			conn.Close()
			t.Fatal("peer listener leaked after failure")
		}
	}
}
func TestOfflineOperatorTicketAdmission(t *testing.T) {
	policy := session.OperatorPasskeyOriginPolicy{RPID: "localhost", Origins: []string{"http://localhost:13000"}}
	for _, tc := range []struct {
		name                                          string
		args                                          []string
		isolated, container, bootstrap, local, schema string
		want                                          bool
	}{
		{"canonical", []string{"issue-local-dev-root-ticket"}, "true", "true", "true", "true", localDevelopmentOperatorSchema, true},
		{"retired", []string{"issue-synthetic-root-ticket"}, "true", "true", "true", "true", localDevelopmentOperatorSchema, false},
		{"unknown argument", []string{"issue-local-dev-root-ticket", "extra"}, "true", "true", "true", "true", localDevelopmentOperatorSchema, false},
		{"no isolation", []string{"issue-local-dev-root-ticket"}, "", "true", "true", "true", localDevelopmentOperatorSchema, false},
		{"no container", []string{"issue-local-dev-root-ticket"}, "true", "", "true", "true", localDevelopmentOperatorSchema, false},
		{"no bootstrap", []string{"issue-local-dev-root-ticket"}, "true", "true", "", "true", localDevelopmentOperatorSchema, false},
		{"no explicit local owner", []string{"issue-local-dev-root-ticket"}, "true", "true", "true", "", localDevelopmentOperatorSchema, false},
		{"foreign namespace", []string{"issue-local-dev-root-ticket"}, "true", "true", "true", "true", "identity_test_foreign", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := operatorOfflineTicketAdmitted(tc.args, tc.isolated, tc.container, tc.bootstrap, tc.local, tc.schema, policy); got != tc.want {
				t.Fatalf("admitted %t, want %t", got, tc.want)
			}
		})
	}
	if operatorOfflineTicketAdmitted([]string{"issue-local-dev-root-ticket"}, "true", "true", "true", "true", localDevelopmentOperatorSchema, session.OperatorPasskeyOriginPolicy{}) {
		t.Fatal("unverified WebAuthn origin admitted")
	}
	if isLocalDevelopmentFirstOperatorDatabase(context.Background(), nil, localDevelopmentOperatorSchema) {
		t.Fatal("missing database admitted")
	}
}
