package session

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/pem"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
)

func TestCaptainDSHApprovalIsCheckedAgainstVerifiedActor(t *testing.T) {
	status, actorID := "APPROVED", "identity-actor"
	allowed := 0
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/actors/me/captain-eligibility" ||
			r.Header.Get("Authorization") != "Bearer verified-opaque-customer" ||
			r.Header.Get("Cache-Control") != "no-store" {
			w.WriteHeader(http.StatusForbidden)
			return
		}
		allowed++
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprintf(w, `{"actorId":"%s","status":"%s","version":1}`, actorID, status)
	}))
	defer s.Close()
	reader, err := NewCaptainStandingHTTP(s.URL)
	if err != nil {
		t.Fatal(err)
	}
	if err = reader.Approved(context.Background(), "verified-opaque-customer", "identity-actor"); err != nil || allowed != 1 {
		t.Fatalf("valid owner standing not accepted: %v, calls=%d", err, allowed)
	}
	actorID = "different-person"
	if err = reader.Approved(context.Background(), "verified-opaque-customer", "identity-actor"); err == nil {
		t.Fatal("DSH cross-actor standing permitted Identity Captain admission")
	}
	actorID = "identity-actor"
	status = "SUSPENDED"
	if err = reader.Approved(context.Background(), "verified-opaque-customer", "identity-actor"); err == nil {
		t.Fatal("DSH suspended standing permitted Identity Captain admission")
	}
}
func TestCaptainDSHOwnerURLFailsClosed(t *testing.T) {
	for _, value := range []string{"http://example.com", "http://localhost:1234/path", "http://user:pass@localhost:3000", "file:///tmp/approval"} {
		if _, err := NewCaptainStandingHTTP(value); err == nil {
			t.Fatalf("unsafe standing URL accepted: %q", value)
		}
	}
}

func TestCaptainDSHOutageIsUnavailableRatherThanAStandingDenial(t *testing.T) {
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer s.Close()
	client, err := NewCaptainStandingHTTP(s.URL)
	if err != nil {
		t.Fatal(err)
	}
	if got := client.Approved(context.Background(), "customer-bearer", "verified-id"); !errors.Is(got, ErrCaptainStandingOwnerUnavailable) {
		t.Fatalf("DSH outage must be 503-like owner uncertainty, got %v", got)
	}
}

func TestCaptainDSHTransportFailureIsOwnerUnavailable(t *testing.T) {
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"actorId":"verified-id","status":"APPROVED","version":1}`))
	}))
	client, err := NewCaptainStandingHTTP(s.URL)
	if err != nil {
		t.Fatal(err)
	}
	s.Close()
	if got := client.Approved(context.Background(), "customer-bearer", "verified-id"); !errors.Is(got, ErrCaptainStandingOwnerUnavailable) {
		t.Fatalf("transport outage incorrectly treated as an eligibility denial: %v", got)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if got := client.Approved(ctx, "customer-bearer", "verified-id"); !errors.Is(got, ErrCaptainStandingOwnerUnavailable) {
		t.Fatalf("cancelled owner read incorrectly treated as an eligibility denial: %v", got)
	}
}

func TestCaptainContainerPeerAndDedicatedTLSRoots(t *testing.T) {
	s := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		fmt.Fprint(w, "{\"actorId\":\"verified-id\",\"status\":\"APPROVED\",\"version\":1}")
	}))
	defer s.Close()
	dir := t.TempDir()
	ca := filepath.Join(dir, "ca.pem")
	if err := os.WriteFile(ca, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: s.Certificate().Raw}), 0600); err != nil {
		t.Fatal(err)
	}
	for _, origin := range []string{"http://dsh:3344", "https://other:3344", "https://dsh:3344/path", "http://127.0.0.1:3344", "https://dsh:3345"} {
		if _, err := NewContainerCaptainStandingHTTP(origin, ca); err == nil {
			t.Fatalf("unsafe origin accepted: %s", origin)
		}
	}
	for _, path := range []string{"", filepath.Join(dir, "absent")} {
		if _, err := NewContainerCaptainStandingHTTP("https://dsh:3344", path); err == nil {
			t.Fatal("missing CA accepted")
		}
	}
	peer, err := NewContainerCaptainStandingHTTP("https://dsh:3344", ca)
	if err != nil {
		t.Fatal(err)
	}
	transport, ok := peer.client.Transport.(*http.Transport)
	if !ok || transport.TLSClientConfig.InsecureSkipVerify || transport.TLSClientConfig.MinVersion < tls.VersionTLS12 || transport.Proxy != nil {
		t.Fatal("insecure container transport")
	}
	// Exercise the same transport against a real TLS server, including hostname
	// and trust failures; the public constructor above pins the container origin.
	trusted, err := newCaptainStandingHTTP(s.URL, transport.TLSClientConfig)
	if err != nil {
		t.Fatal(err)
	}
	if err = trusted.Approved(context.Background(), "opaque-bearer", "verified-id"); err != nil {
		t.Fatal(err)
	}
	wrongRoots, _ := newCaptainStandingHTTP(s.URL, &tls.Config{MinVersion: tls.VersionTLS12, RootCAs: x509.NewCertPool()})
	if err = wrongRoots.Approved(context.Background(), "opaque-bearer", "verified-id"); !errors.Is(err, ErrCaptainStandingOwnerUnavailable) {
		t.Fatalf("untrusted peer accepted: %v", err)
	}
	wrongName, _ := newCaptainStandingHTTP(s.URL, &tls.Config{MinVersion: tls.VersionTLS12, RootCAs: transport.TLSClientConfig.RootCAs, ServerName: "wrong.invalid"})
	if err = wrongName.Approved(context.Background(), "opaque-bearer", "verified-id"); !errors.Is(err, ErrCaptainStandingOwnerUnavailable) {
		t.Fatalf("wrong peer name accepted: %v", err)
	}
}

func TestCaptainStandingRejectsAmbiguousOwnerDocuments(t *testing.T) {
	const ok = `{"actorId":"verified-id","status":"APPROVED","version":1}`
	for _, tc := range []struct {
		name, body, media, cache, encoding string
		code                               int
		allow                              bool
	}{
		{"valid", ok, "application/json", "no-store", "", 200, true},
		{"duplicate status", `{"actorId":"verified-id","status":"REVOKED","status":"APPROVED","version":1}`, "application/json", "no-store", "", 200, false},
		{"duplicate actor", `{"actorId":"other","actorId":"verified-id","status":"APPROVED","version":1}`, "application/json", "no-store", "", 200, false},
		{"wrong case", `{"ActorId":"verified-id","Status":"APPROVED","Version":1}`, "application/json", "no-store", "", 200, false},
		{"unknown", `{"actorId":"verified-id","status":"APPROVED","version":1,"role":"captain"}`, "application/json", "no-store", "", 200, false},
		{"trailing", ok + "{}", "application/json", "no-store", "", 200, false},
		{"missing version", `{"actorId":"verified-id","status":"APPROVED"}`, "application/json", "no-store", "", 200, false},
		{"null version", `{"actorId":"verified-id","status":"APPROVED","version":null}`, "application/json", "no-store", "", 200, false},
		{"cacheable", ok, "application/json", "max-age=3600", "", 200, false},
		{"no cache header", ok, "application/json", "", "", 200, false},
		{"encoded", ok, "application/json", "no-store", "br", 200, false},
		{"wrong charset", ok, "application/json; charset=latin1", "no-store", "", 200, false},
		{"oversized", ok + strings.Repeat(" ", 4096), "application/json", "no-store", "", 200, false},
		{"redirect", ok, "application/json", "no-store", "", 302, false},
		{"unavailable", ok, "application/json", "no-store", "", 503, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var calls atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				if r.URL.Path != "/v1/actors/me/captain-eligibility" || r.Header.Get("Authorization") != "Bearer opaque-bearer" || r.Header.Get("Cache-Control") != "no-store" {
					t.Error("unexpected owner request")
				}
				w.Header().Set("Content-Type", tc.media)
				if tc.cache != "" {
					w.Header().Set("Cache-Control", tc.cache)
				}
				if tc.encoding != "" {
					w.Header().Set("Content-Encoding", tc.encoding)
				}
				if tc.code == 302 {
					w.Header().Set("Location", "/redirected")
				}
				w.WriteHeader(tc.code)
				fmt.Fprint(w, tc.body)
			}))
			defer server.Close()
			verifier, err := NewCaptainStandingHTTP(server.URL)
			if err != nil {
				t.Fatal(err)
			}
			err = verifier.Approved(t.Context(), "opaque-bearer", "verified-id")
			if (err == nil) != tc.allow || calls.Load() != 1 {
				t.Fatalf("approval=%v want=%v calls=%d", err == nil, tc.allow, calls.Load())
			}
		})
	}
}

func TestCaptainStandingRestrictsLocalPeer(t *testing.T) {
	for _, origin := range []string{"https://example.com:443", "https://dsh:3344", "http://127.0.0.1:0", "http://127.0.0.1:65536", "http://127.0.0.1:1234?", "http://127.0.0.1:1234#"} {
		if _, err := NewCaptainStandingHTTP(origin); err == nil {
			t.Errorf("unsafe local origin admitted: %s", origin)
		}
	}
}

func TestCaptainStandingRequiresCompleteRepresentationMetadata(t *testing.T) {
	const body = `{"actorId":"verified-id","status":"APPROVED","version":1}`
	for _, tc := range []struct {
		name, field, value string
		announced, allow   bool
	}{
		{"cache trailer", "Cache-Control", "public", true, false},
		{"type trailer", "Content-Type", "text/html", true, false},
		{"encoding trailer", "Content-Encoding", "gzip", true, false},
		{"unannounced cache trailer", "Cache-Control", "public", false, false},
		{"unannounced type trailer", "Content-Type", "text/html", false, false},
		{"unannounced encoding trailer", "Content-Encoding", "gzip", false, false},
		{"benign trailer", "X-Processing-Time", "1", true, true},
		{"benign unannounced", "X-Processing-Time", "1", false, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Cache-Control", "no-store")
				w.Header().Set("Content-Type", "application/json")
				if tc.announced {
					w.Header().Set("Trailer", tc.field)
				}
				w.WriteHeader(http.StatusOK)
				w.(http.Flusher).Flush()
				fmt.Fprint(w, body)
				key := tc.field
				if !tc.announced {
					key = http.TrailerPrefix + key
				}
				w.Header().Set(key, tc.value)
			}))
			defer server.Close()
			v, err := NewCaptainStandingHTTP(server.URL)
			if err != nil {
				t.Fatal(err)
			}
			err = v.Approved(t.Context(), "opaque-bearer", "verified-id")
			if (err == nil) != tc.allow {
				t.Fatalf("approval=%v want=%v", err == nil, tc.allow)
			}
		})
	}
}

func TestCaptainStandingRejectsIncompleteOrAmbiguousInitialMetadata(t *testing.T) {
	const body = `{"actorId":"verified-id","status":"APPROVED","version":1}`
	for _, tc := range []struct {
		name, header, value string
		duplicate           bool
		want                error
	}{
		{"duplicate type", "Content-Type", "application/json", true, ErrCaptainStandingNotApproved},
		{"duplicate cache", "Cache-Control", "no-store", true, ErrCaptainStandingNotApproved},
		{"declared oversize", "Content-Length", "4097", false, ErrCaptainStandingNotApproved},
		{"truncated", "Content-Length", "100", false, ErrCaptainStandingOwnerUnavailable},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Header.Get("Accept-Encoding") != "identity" {
					t.Error("missing explicit representation negotiation")
				}
				w.Header().Set("Cache-Control", "no-store")
				w.Header().Set("Content-Type", "application/json")
				if tc.duplicate {
					w.Header().Add(tc.header, tc.value)
				} else {
					w.Header().Set(tc.header, tc.value)
				}
				fmt.Fprint(w, body)
			}))
			defer s.Close()
			v, e := NewCaptainStandingHTTP(s.URL)
			if e != nil {
				t.Fatal(e)
			}
			if e = v.Approved(t.Context(), "opaque-bearer", "verified-id"); !errors.Is(e, tc.want) {
				t.Fatalf("got %v want %v", e, tc.want)
			}
		})
	}
}
