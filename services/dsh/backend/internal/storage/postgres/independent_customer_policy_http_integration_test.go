package postgres_test

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	identityintegration "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/identity"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/wlt"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	transporthttp "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/transport/http"
)

// This is invoked ONLY from the existing guarded disposable PostGIS QA.
// The session endpoint is a deliberately synthetic Identity response: it
// tests DSH's HTTP/Identity client boundary, not the real Identity service.
func exerciseIndependentPolicyHTTPOnIsolatedDB(t *testing.T, ctx context.Context, db *sql.DB, storeA, storeB, ownerA string) {
	t.Helper()
	identityServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		switch r.Header.Get("Authorization") {
		case "Bearer qa-owner-a-session":
			_ = json.NewEncoder(w).Encode(map[string]any{"subject": ownerA, "role": "partner", "surface": "app-partner"})
		case "Bearer qa-owner-b-session":
			_ = json.NewEncoder(w).Encode(map[string]any{"subject": "direct-owner-b", "role": "partner", "surface": "app-partner"})
		case "Bearer qa-customer-session":
			_ = json.NewEncoder(w).Encode(map[string]any{"subject": "qa-client", "role": "client", "surface": "app-client"})
		default:
			w.WriteHeader(http.StatusUnauthorized)
			_, _ = w.Write([]byte(`{"error":{"code":"UNAUTHENTICATED"}}`))
		}
	}))
	defer identityServer.Close()

	endpoint, err := identityintegration.ResolveBaseURL(identityServer.URL, "test")
	if err != nil {
		t.Fatal(err)
	}
	identityClient, err := identityintegration.New(endpoint, "qa-dsh-identity-boundary-token")
	if err != nil {
		t.Fatal(err)
	}
	// The draft-only route has no WLT operation. Keep that dependency inert;
	// this test must not issue financial API requests.
	server, err := transporthttp.NewStoreAccess(identityClient, "qa-dsh-operator-service-token", db, &wlt.Client{})
	if err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	server.Register(mux)

	request := func(method, token, storeID, body, key string) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequestWithContext(ctx, method,
			"/dsh/partner/stores/"+storeID+"/independent-customer-policy/draft", strings.NewReader(body))
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		if method == http.MethodPut {
			req.Header.Set("Idempotency-Key", key)
			req.Header.Set("X-Correlation-ID", "qa-independent-policy-http")
		}
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)
		if !strings.Contains(rec.Header().Get("Cache-Control"), "no-store") ||
			rec.Header().Get("X-Robots-Tag") != "noindex, nofollow" {
			t.Fatalf("policy response leaked cacheability: method=%s status=%d headers=%v", method, rec.Code, rec.Header())
		}
		return rec
	}

	readRecord := func(rec *httptest.ResponseRecorder, wantStatus int) (postgres.IndependentCustomerPolicyRecord, bool) {
		t.Helper()
		if rec.Code != wantStatus {
			t.Fatalf("policy HTTP status=%d want=%d body=%s", rec.Code, wantStatus, rec.Body.String())
		}
		var result struct {
			Policy           postgres.IndependentCustomerPolicyRecord `json:"policy"`
			DraftOnly        bool                                     `json:"draftOnly"`
			IdempotentReplay bool                                     `json:"idempotentReplay"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
		if !result.DraftOnly || result.Policy.StoreID != storeA || result.Policy.ReviewState != "NOT_CHECKED" {
			t.Fatalf("private policy must remain owner-scoped, unapproved and draft only: %+v", result)
		}
		return result.Policy, result.IdempotentReplay
	}

	initial, _ := readRecord(request(http.MethodGet, "qa-owner-a-session", storeA, "", ""), http.StatusOK)
	if initial.Version != 3 || initial.PolicyVersion != "v3" {
		t.Fatalf("expected committed v3 policy before HTTP update: %+v", initial)
	}
	for _, other := range []struct {
		token, store string
		want         int
	}{
		{"qa-owner-b-session", storeA, http.StatusNotFound},
		{"qa-customer-session", storeA, http.StatusForbidden},
		{"", storeA, http.StatusForbidden},
		{"qa-owner-a-session", storeB, http.StatusNotFound},
	} {
		rec := request(http.MethodGet, other.token, other.store, "", "")
		if rec.Code != other.want || strings.Contains(rec.Body.String(), initial.CancellationTerms) {
			t.Fatalf("unauthorized policy GET status=%d want=%d body=%s", rec.Code, other.want, rec.Body.String())
		}
	}
	const draft = `{"expectedVersion":3,"cancellationTerms":"QA cancel terms v4","returnsTerms":"QA return terms v4","fulfillmentTerms":"Pickup at store v4","collectionTerms":"Pay merchant at pickup v4"}`
	const idem = "qa-independent-policy-http-attempt-0001"
	if rec := request(http.MethodPut, "qa-owner-b-session", storeA, draft, idem+"-foreign"); rec.Code != http.StatusNotFound {
		t.Fatalf("foreign owner policy mutation should be 404: %d %s", rec.Code, rec.Body.String())
	}
	saved, replayed := readRecord(request(http.MethodPut, "qa-owner-a-session", storeA, draft, idem), http.StatusOK)
	if replayed || saved.Version != 4 || saved.PolicyVersion != "v4" || saved.CancellationTerms != "QA cancel terms v4" {
		t.Fatalf("valid owner policy edit was not persisted exactly once: %+v replay=%v", saved, replayed)
	}
	savedAgain, replayed := readRecord(request(http.MethodPut, "qa-owner-a-session", storeA, draft, idem), http.StatusOK)
	if !replayed || savedAgain.Version != saved.Version || savedAgain.PolicyVersion != saved.PolicyVersion {
		t.Fatalf("same mutation key should replay immutable receipt: %+v replay=%v", savedAgain, replayed)
	}
	// A reused attempt key cannot silently overwrite a committed draft or
	// consume a second audit event, even when the caller is its real owner.
	const changedFactsSameKey = `{"expectedVersion":3,"cancellationTerms":"QA different cancellation terms","returnsTerms":"QA return terms v4","fulfillmentTerms":"Pickup at store v4","collectionTerms":"Pay merchant at pickup v4"}`
	conflictingReplay := request(http.MethodPut, "qa-owner-a-session", storeA, changedFactsSameKey, idem)
	if conflictingReplay.Code != http.StatusConflict || !strings.Contains(conflictingReplay.Body.String(), "IDEMPOTENCY_CONFLICT") {
		t.Fatalf("different draft facts under same key must conflict without mutation: %d %s", conflictingReplay.Code, conflictingReplay.Body.String())
	}
	// An untrusted or foreign actor cannot reuse the legitimate owner's
	// key to infer the saved private terms or acquire an idempotent receipt.
	for _, forbidden := range []struct {
		token string
		want  int
	}{
		{"qa-owner-b-session", http.StatusNotFound},
		{"qa-customer-session", http.StatusForbidden},
	} {
		rec := request(http.MethodPut, forbidden.token, storeA, draft, idem)
		if rec.Code != forbidden.want || strings.Contains(rec.Body.String(), saved.CancellationTerms) {
			t.Fatalf("nonowner replay leaked private draft: %d want=%d %s", rec.Code, forbidden.want, rec.Body.String())
		}
	}
	readBack, _ := readRecord(request(http.MethodGet, "qa-owner-a-session", storeA, "", ""), http.StatusOK)
	if readBack.Version != 4 || readBack.CancellationTerms != saved.CancellationTerms {
		t.Fatalf("owner GET must reflect canonical updated policy: %+v", readBack)
	}
	if rec := request(http.MethodPut, "qa-owner-a-session", storeA, draft, idem+"-stale"); rec.Code != http.StatusConflict {
		t.Fatalf("stale expectedVersion should conflict: %d %s", rec.Code, rec.Body.String())
	}
	var auditCount int
	if err := db.QueryRowContext(ctx, `SELECT count(*) FROM dsh.independent_store_customer_policy_audit
		WHERE store_id=$1`, storeA).Scan(&auditCount); err != nil || auditCount != 4 {
		t.Fatalf("HTTP edit/replay should yield one additional canonical audit: count=%d err=%v", auditCount, err)
	}
}
