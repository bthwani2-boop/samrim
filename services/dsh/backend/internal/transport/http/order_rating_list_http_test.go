package transporthttp

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/auth"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

func TestStoreRatingsRoutesRejectUntrustedRequestsBeforeDataRead(t *testing.T) {
	authorizer, err := auth.NewServiceToken("test-rating-service-token")
	if err != nil {
		t.Fatal(err)
	}
	s := &OrderServer{auth: authorizer}
	mux := http.NewServeMux()
	s.Register(mux)
	for _, path := range []string{"/dsh/partner/stores/store-a/ratings", "/dsh/operator/stores/store-a/ratings"} {
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, httptest.NewRequest(http.MethodGet, path, nil))
		if w.Code != http.StatusUnauthorized {
			t.Fatalf("%s without authentication: %d", path, w.Code)
		}
	}
	for _, suffix := range []string{"?limit=51", "?limit=0", "?limit=bad"} {
		req := httptest.NewRequest(http.MethodGet, "/dsh/partner/stores/store-a/ratings"+suffix, nil)
		req.Header.Set("Authorization", "Bearer unverified-test")
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, req)
		if w.Code != http.StatusBadRequest {
			t.Fatalf("invalid partner limit %s: %d", suffix, w.Code)
		}
	}
	req := httptest.NewRequest(http.MethodGet, "/dsh/partner/stores/store-a/ratings", nil)
	req.Header.Set("Authorization", "Bearer unverified-test")
	req.Header.Set("X-Actor-ID", "victim")
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("untrusted client actor header accepted: %d", w.Code)
	}
	for _, limit := range []string{"51", "not-a-number"} {
		req := httptest.NewRequest(http.MethodGet, "/dsh/operator/stores/store-a/ratings?limit="+limit, nil)
		req.Header.Set("Authorization", "Bearer test-rating-service-token")
		req.Header.Set("X-Acting-Actor-ID", "operator-a")
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, req)
		if w.Code != http.StatusBadRequest {
			t.Fatalf("invalid operator limit %s: %d", limit, w.Code)
		}
	}
}

func TestStoreRatingsTransportNeverExposesCustomerActorIdentity(t *testing.T) {
	created := time.Date(2026, 10, 31, 12, 0, 0, 0, time.UTC)
	page := postgres.StoreOrderRatingPage{Ratings: []postgres.OrderRatingRecord{{
		OrderID: "order-a", StoreID: "store-a", ClientActorID: "sensitive-client-actor",
		Rating: 5, Review: "جيد", CreatedAt: created,
	}}}
	out := toStoreOrderRatingList(page)
	bytes, err := json.Marshal(out)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(bytes), "sensitive-client-actor") || strings.Contains(string(bytes), "clientActorId") {
		t.Fatal("private customer actor leaked in ratings JSON")
	}
	if len(out.Ratings) != 1 || out.Ratings[0].StoreID != "store-a" {
		t.Fatalf("incorrect scoped rating: %+v", out)
	}
}

func TestOperatorStoreSummaryRejectsUnauthenticatedAndMalformedQueries(t *testing.T) {
	authorizer, err := auth.NewServiceToken("test-summary-service-token")
	if err != nil {
		t.Fatal(err)
	}
	server := &OrderServer{auth: authorizer}
	mux := http.NewServeMux()
	server.Register(mux)
	tests := []struct {
		url            string
		serviceAuth    bool
		actorID        string
		untrustedActor string
		want           int
	}{
		{"/dsh/operator/stores/store-a/orders/summary", false, "", "", http.StatusUnauthorized},
		{"/dsh/operator/stores/store-a/orders/summary", true, "", "", http.StatusBadRequest},
		{"/dsh/operator/stores/store-a/orders/summary", true, "operator-a", "spoofed-client", http.StatusBadRequest},
		{"/dsh/operator/stores/store-a/orders/summary?period=tomorrow", true, "operator-a", "", http.StatusBadRequest},
		{"/dsh/operator/stores/store-a/orders/summary?period=7d", true, strings.Repeat("x", 129), "", http.StatusBadRequest},
	}
	for _, tt := range tests {
		req := httptest.NewRequest(http.MethodGet, tt.url, nil)
		if tt.serviceAuth {
			req.Header.Set("Authorization", "Bearer test-summary-service-token")
		}
		if tt.actorID != "" {
			req.Header.Set("X-Acting-Actor-ID", tt.actorID)
		}
		if tt.untrustedActor != "" {
			req.Header.Set("X-Actor-ID", tt.untrustedActor)
		}
		writer := httptest.NewRecorder()
		mux.ServeHTTP(writer, req)
		if writer.Code != tt.want {
			t.Errorf("operator Store summary %s => %d, want %d", tt.url, writer.Code, tt.want)
		}
	}
}
