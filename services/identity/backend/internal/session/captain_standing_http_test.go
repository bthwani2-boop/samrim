package session

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
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
