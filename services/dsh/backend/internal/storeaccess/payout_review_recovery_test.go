package storeaccess

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	wltintegration "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/wlt"
)

func TestStoreGrantPayoutReviewFailsClosedAndRecovers(t *testing.T) {
	tests := []struct {
		name        string
		getStatus   int
		getCode     string
		state       string
		beneficiary string
		postStatus  int
		wantError   bool
		wantPosts   int
	}{
		{name: "only explicit missing assignment is harmless", getStatus: http.StatusNotFound, getCode: "NOT_FOUND"},
		{name: "unknown 404 is not missing assignment", getStatus: http.StatusNotFound, getCode: "WRONG_ROUTE", wantError: true},
		{name: "WLT outage does not bypass review", getStatus: http.StatusServiceUnavailable, getCode: "UNAVAILABLE", wantError: true},
		{name: "WLT authorization error does not bypass review", getStatus: http.StatusForbidden, getCode: "FORBIDDEN", wantError: true},
		{name: "matching staff is put under review", getStatus: http.StatusOK, state: wltintegration.StorePayoutRecipientStateSelectedStaff, beneficiary: "staff-1", wantPosts: 1},
		{name: "other staff is unchanged", getStatus: http.StatusOK, state: wltintegration.StorePayoutRecipientStateSelectedStaff, beneficiary: "staff-2"},
		{name: "already under review is unchanged", getStatus: http.StatusOK, state: wltintegration.StorePayoutRecipientStateReviewRequired, beneficiary: "staff-1"},
		{name: "WLT review write failure is returned to caller for replay", getStatus: http.StatusOK, state: wltintegration.StorePayoutRecipientStateSelectedStaff, beneficiary: "staff-1", postStatus: http.StatusServiceUnavailable, wantPosts: 1, wantError: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			posts := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				switch {
				case r.Method == http.MethodGet && r.URL.Path == "/wlt/v1/partners/owner-1/store-payout-recipients/store-1":
					if tt.getStatus != http.StatusOK {
						w.WriteHeader(tt.getStatus)
						_, _ = fmt.Fprintf(w, `{"error":{"code":%q,"message":"test recipient read error"}}`, tt.getCode)
						return
					}
					_, _ = fmt.Fprintf(w, `{"storeId":"store-1","state":%q,"beneficiaryActorId":%q,"version":2}`, tt.state, tt.beneficiary)
				case r.Method == http.MethodPost && r.URL.Path == "/wlt/v1/store-payout-recipients/store-1/review-required":
					posts++
					if r.Header.Get("X-Correlation-ID") != "corr-store-access-revoke" {
						t.Errorf("review call lost original correlation")
					}
					if tt.postStatus != 0 {
						w.WriteHeader(tt.postStatus)
						_, _ = w.Write([]byte(`{"error":{"code":"UNAVAILABLE","message":"review failed"}}`))
						return
					}
					_, _ = w.Write([]byte(`{"state":"RECIPIENT_REVIEW_REQUIRED","applied":true}`))
				default:
					t.Errorf("unexpected WLT request %s %s", r.Method, r.URL.Path)
					w.WriteHeader(http.StatusNotFound)
				}
			}))
			defer server.Close()
			client, err := wltintegration.New(server.URL, "test", "fake-token")
			if err != nil {
				t.Fatalf("create isolated WLT client: %v", err)
			}
			s := &Service{wlt: client}
			err = s.markPayoutRecipientReviewIfNeeded(context.Background(), "store-1", "owner-1", "staff-1", "revoked", "corr-store-access-revoke")
			if (err != nil) != tt.wantError {
				t.Errorf("review error = %v, wantError = %v", err, tt.wantError)
			}
			if posts != tt.wantPosts {
				t.Errorf("WLT review writes = %d, want %d", posts, tt.wantPosts)
			}
		})
	}
}

func TestStoreGrantPayoutReviewRecoversAfterWLTWriteFailure(t *testing.T) {
	posts := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			_, _ = w.Write([]byte(`{"storeId":"store-1","state":"SELECTED_VERIFIED_STAFF","beneficiaryActorId":"staff-1","version":2}`))
		case http.MethodPost:
			posts++
			if posts == 1 {
				w.WriteHeader(http.StatusServiceUnavailable)
				_, _ = w.Write([]byte(`{"error":{"code":"UNAVAILABLE","message":"temporary WLT outage"}}`))
				return
			}
			_, _ = w.Write([]byte(`{"state":"RECIPIENT_REVIEW_REQUIRED","applied":true}`))
		default:
			t.Errorf("unexpected HTTP method %s", r.Method)
		}
	}))
	defer server.Close()

	client, err := wltintegration.New(server.URL, "test", "fake-token")
	if err != nil {
		t.Fatal(err)
	}
	s := &Service{wlt: client}
	const correlation = "corr-store-access-revoke"
	if err := s.markPayoutRecipientReviewIfNeeded(context.Background(), "store-1", "owner-1", "staff-1", "revoked", correlation); err == nil {
		t.Fatal("first WLT review write failure must not be treated as success")
	}
	if err := s.markPayoutRecipientReviewIfNeeded(context.Background(), "store-1", "owner-1", "staff-1", "revoked", correlation); err != nil {
		t.Fatalf("a repeated review must recover after the WLT outage: %v", err)
	}
	if posts != 2 {
		t.Fatalf("WLT review write attempts = %d, want 2", posts)
	}
}
