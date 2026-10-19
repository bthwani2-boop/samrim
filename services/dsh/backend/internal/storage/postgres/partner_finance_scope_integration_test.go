package postgres_test

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	identityintegration "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/identity"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/wlt"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	transporthttp "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/transport/http"
)

func TestPartnerFinanceAndPayoutStoreAuthorityBoundary(t *testing.T) {
	url := os.Getenv("DSH_DATABASE_URL")
	if url == "" {
		t.Skip("DSH_DATABASE_URL is required for the isolated finance scope proof")
	}
	root, err := sql.Open("postgres", url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = root.Close() })
	withFreshDatabase(t, root, url, func(ctx context.Context, db *sql.DB, records []postgres.MigrationRecord, statements []string) {
		if err := postgres.Migrate(ctx, db, records, statements, testDeliveryProofKeyring(t)); err != nil {
			t.Fatal(err)
		}
		const owner, reader, requester, hybrid = "finance-owner", "finance-reader", "finance-requester", "finance-hybrid"
		const a, b, x = "finance-store-a", "finance-store-b", "finance-store-x"
		for _, store := range []canonicalStoreFixture{{ID: a, PartnerActorID: owner, Name: "Store A"}, {ID: b, PartnerActorID: owner, Name: "Store B"}, {ID: x, PartnerActorID: hybrid, Name: "Store X"}} {
			insertCanonicalStoreFixture(t, ctx, db, store)
		}
		var requesterGrant postgres.StoreAccessGrant
		for _, grant := range []struct{ actor, permission string }{{reader, "finance_read"}, {requester, "payout_request"}, {hybrid, "payout_request"}} {
			g, _, err := postgres.CreateStoreAccessInvitation(ctx, db, a, owner, grant.actor, []string{grant.permission}, "invite-"+grant.actor, "invite-correlation-"+grant.actor)
			if err != nil {
				t.Fatal(err)
			}
			activateGrantDirectly(t, ctx, db, g, owner)
			if grant.actor == requester {
				requesterGrant, err = postgres.ReadStoreAccessGrant(ctx, db, g.ID)
				if err != nil {
					t.Fatal(err)
				}
			}
		}
		identityServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			if r.URL.Path == "/auth/session" {
				actor := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
				_ = json.NewEncoder(w).Encode(map[string]any{"subject": actor, "role": "partner", "surface": "app-partner", "expiresAt": time.Now().Add(time.Hour)})
				return
			}
			parts := strings.Split(r.URL.Path, "/")
			actor := parts[3]
			if strings.HasSuffix(r.URL.Path, "/verified-legal-name") {
				_ = json.NewEncoder(w).Encode(map[string]any{"actorId": actor, "givenName": "Canonical", "secondName": "Finance", "thirdName": "Proof", "familyName": "Actor", "status": "VERIFIED", "version": 1})
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"actorId": actor, "role": "partner", "phoneE164": "+967777000001", "actorVersion": 1, "roleVersion": 1, "enabled": true, "securityEnabled": true, "activatedAt": time.Now()})
		}))
		defer identityServer.Close()
		endpoint, err := identityintegration.ResolveBaseURL(identityServer.URL, "test")
		if err != nil {
			t.Fatal(err)
		}
		identity, err := identityintegration.New(endpoint, strings.Repeat("i", 32))
		if err != nil {
			t.Fatal(err)
		}
		payoutCalls := 0
		incomplete := false
		wltServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			if strings.HasSuffix(r.URL.Path, "/financial-summary") {
				rows := []wlt.PartnerStoreFinance{}
				parts := strings.Split(r.URL.Path, "/")
				walletOwner := parts[4]
				for _, id := range r.URL.Query()["storeId"] {
					amount := int64(100)
					if id == b {
						amount = 200
					}
					rows = append(rows, wlt.PartnerStoreFinance{StoreID: id, PartnerActorID: walletOwner, Currency: "YER", EarnedMinor: amount, EligibleAvailableMinor: amount, PayoutReady: true, AttributionComplete: !incomplete})
				}
				// Deliberately unrelated owner-wide amounts must never reach delegates.
				_ = json.NewEncoder(w).Encode(map[string]any{"summary": map[string]any{"partnerActorId": walletOwner, "currency": "YER", "eligibleAvailableMinor": 250, "heldMinor": 50, "earnedMinor": 300, "outstandingCommissionReceivableMinor": 888888, "settlementPeriod": "WEEKLY", "stores": rows}})
				return
			}
			if strings.HasSuffix(r.URL.Path, "/store-payout-recipients") {
				_ = json.NewEncoder(w).Encode(map[string]any{"recipients": []any{}, "reviewStores": []any{}})
				return
			}
			if r.Method == "GET" && strings.HasSuffix(r.URL.Path, "/payout-requests") {
				key := r.URL.Query().Get("idempotencyKey")
				if key == "missing-request" {
					w.WriteHeader(404)
					_ = json.NewEncoder(w).Encode(map[string]any{"error": map[string]any{"code": "NOT_FOUND"}})
					return
				}
				id := a
				if key == "other-store-request" {
					id = b
				}
				items := []wlt.PartnerPayoutStoreAllocation{{StoreID: id, AmountMinor: 100, BeneficiaryActorID: owner, Currency: "YER"}}
				if key == "unattributed-request" {
					items = nil
				}
				_ = json.NewEncoder(w).Encode(map[string]any{"request": wlt.PartnerPayoutRequest{ID: "request-canonical", TotalAmountMinor: 100, Currency: "YER", Stores: items}})
				return
			}
			if r.Method == "POST" && strings.HasSuffix(r.URL.Path, "/payout-requests") {
				payoutCalls++
				var input wlt.PartnerPayoutRequestInput
				if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
					t.Error(err)
				}
				if len(input.StoreIDs) != 1 || input.StoreIDs[0] != a || !strings.Contains(r.URL.Path, "/partners/"+owner+"/") {
					t.Errorf("mutation widened or changed wallet scope: %s %+v", r.URL.Path, input)
				}
				w.WriteHeader(201)
				_ = json.NewEncoder(w).Encode(map[string]any{"request": wlt.PartnerPayoutRequest{ID: "request-canonical", TotalAmountMinor: 100, Currency: "YER", Stores: []wlt.PartnerPayoutStoreAllocation{{StoreID: a, AmountMinor: 100, BeneficiaryActorID: owner, Currency: "YER"}}}})
				return
			}
			http.NotFound(w, r)
		}))
		defer wltServer.Close()
		payment, err := wlt.New(wltServer.URL, "test", strings.Repeat("w", 32))
		if err != nil {
			t.Fatal(err)
		}
		finance, err := transporthttp.NewPartnerFinance(identity, strings.Repeat("d", 32), payment, db)
		if err != nil {
			t.Fatal(err)
		}
		payout, err := transporthttp.NewBeneficiaryFinance(identity, strings.Repeat("d", 32), payment, db)
		if err != nil {
			t.Fatal(err)
		}
		access, err := transporthttp.NewStoreAccess(identity, strings.Repeat("d", 32), db, payment)
		if err != nil {
			t.Fatal(err)
		}
		mux := http.NewServeMux()
		finance.Register(mux)
		payout.Register(mux)
		access.Register(mux)
		call := func(actor, method, path, body string, status int) *httptest.ResponseRecorder {
			t.Helper()
			req := httptest.NewRequest(method, path, strings.NewReader(body))
			req.Header.Set("Authorization", "Bearer "+actor)
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("Idempotency-Key", "request-key-"+actor)
			req.Header.Set("X-Correlation-ID", "request-correlation-"+actor)
			res := httptest.NewRecorder()
			mux.ServeHTTP(res, req)
			if res.Code != status {
				t.Fatalf("%s %s as %s: status=%d want=%d body=%s", method, path, actor, res.Code, status, res.Body.String())
			}
			return res
		}
		res := call(owner, "GET", "/dsh/partners/me/financial-summary", "", 200)
		var summary struct {
			Summary struct {
				EarnedMinor            int64                     `json:"earnedMinor"`
				EligibleAvailableMinor int64                     `json:"eligibleAvailableMinor"`
				HeldMinor              int64                     `json:"heldMinor"`
				AttributionComplete    bool                      `json:"attributionComplete"`
				Stores                 []wlt.PartnerStoreFinance `json:"stores"`
			}
		}
		if err := json.Unmarshal(res.Body.Bytes(), &summary); err != nil || summary.Summary.EarnedMinor != 300 || len(summary.Summary.Stores) != 2 {
			t.Fatalf("owner all-Store canonical totals: %s %v", res.Body.String(), err)
		}
		res = call(reader, "GET", "/dsh/partners/me/financial-summary", "", 200)
		if err := json.Unmarshal(res.Body.Bytes(), &summary); err != nil || summary.Summary.EarnedMinor != 100 || len(summary.Summary.Stores) != 1 || summary.Summary.Stores[0].StoreID != a || strings.Contains(res.Body.String(), "888888") {
			t.Fatalf("delegate leaked wallet-wide finance: %s %v", res.Body.String(), err)
		}
		call(reader, "GET", "/dsh/partners/me/financial-summary?storeId="+b, "", 403)
		call(requester, "GET", "/dsh/partners/me/financial-summary", "", 403)
		call(reader, "GET", "/dsh/partners/me/payout-summary", "", 403)
		res = call(requester, "GET", "/dsh/partners/me/payout-summary", "", 200)
		if strings.Contains(res.Body.String(), "earnedMinor") || strings.Contains(res.Body.String(), b) {
			t.Fatalf("payout_request implied financial reports or another Store: %s", res.Body.String())
		}
		call(requester, "GET", "/dsh/partners/me/payout-summary?storeId="+b, "", 403)
		for _, actor := range []string{reader, requester, owner} {
			call(actor, "POST", "/dsh/me/payout-intents", `{"amountMode":"FULL_AVAILABLE"}`, 403)
		}
		call(reader, "POST", "/dsh/partner/payout-requests", `{"scopeMode":"FULL_AVAILABLE"}`, 403)
		call(requester, "POST", "/dsh/partner/payout-requests", `{"scopeMode":"FULL_AVAILABLE","storeIds":["finance-store-a","finance-store-b"]}`, 403)
		call(requester, "POST", "/dsh/partner/payout-requests", `{"scopeMode":"SPECIFIED","storeAmounts":[{"storeId":"finance-store-b","amountMinor":1}]}`, 403)
		call(requester, "POST", "/dsh/partner/payout-requests", `{"scopeMode":"FULL_AVAILABLE"}`, 201)
		call(hybrid, "POST", "/dsh/partner/payout-requests", `{"scopeMode":"FULL_AVAILABLE","storeIds":["finance-store-a"]}`, 201)
		call(hybrid, "POST", "/dsh/partner/payout-requests", `{"scopeMode":"FULL_AVAILABLE"}`, 400)
		for _, actor := range []string{reader, requester} {
			call(actor, "POST", "/dsh/partner/stores/"+a+"/payout-recipient/revert", `{"reason":"delegated actor must not route"}`, 403)
		}

		call(requester, "GET", "/dsh/partner/payout-requests/"+owner+"?idempotencyKey=committed-request", "", 200)
		call(requester, "GET", "/dsh/partner/payout-requests/foreign-wallet?idempotencyKey=committed-request", "", 403)
		call(reader, "GET", "/dsh/partner/payout-requests/"+owner+"?idempotencyKey=committed-request", "", 403)
		call(requester, "GET", "/dsh/partner/payout-requests/"+owner+"?idempotencyKey=other-store-request", "", 403)
		call(owner, "GET", "/dsh/partner/payout-requests/"+owner+"?idempotencyKey=unattributed-request", "", 403)
		call(requester, "GET", "/dsh/partner/payout-requests/"+owner+"?idempotencyKey=missing-request", "", 404)
		incomplete = true
		res = call(owner, "GET", "/dsh/partners/me/financial-summary", "", 200)
		if err = json.Unmarshal(res.Body.Bytes(), &summary); err != nil || summary.Summary.EligibleAvailableMinor != 250 || summary.Summary.HeldMinor != 50 || summary.Summary.AttributionComplete {
			t.Fatalf("owner must retain canonical wallet totals with explicit history gap: %s %v", res.Body.String(), err)
		}
		res = call(reader, "GET", "/dsh/partners/me/financial-summary", "", 200)
		if err = json.Unmarshal(res.Body.Bytes(), &summary); err != nil || summary.Summary.EligibleAvailableMinor != 100 || summary.Summary.HeldMinor != 0 || summary.Summary.AttributionComplete {
			t.Fatalf("delegate exposed wallet totals during history gap: %s %v", res.Body.String(), err)
		}
		scopes, err := postgres.ListPartnerFinanceStores(ctx, db, requester, "payout_request")
		if err != nil {
			t.Fatal(err)
		}
		lock, err := db.BeginTx(ctx, nil)
		if err != nil {
			t.Fatal(err)
		}
		if err = postgres.LockPartnerPayoutStores(ctx, lock, requester, scopes); err != nil {
			t.Fatal(err)
		}
		deadline, cancel := context.WithTimeout(ctx, 150*time.Millisecond)
		_, _, err = postgres.UpdateStoreAccessGrantPermissions(deadline, db, a, owner, requesterGrant.ID, []string{"finance_read"}, requesterGrant.Version, "concurrent-permission-change", "concurrent-permission-corr")
		cancel()
		if err == nil {
			t.Fatal("payout grant changed while canonical mutation authority was locked")
		}
		if err = lock.Rollback(); err != nil {
			t.Fatal(err)
		}
		if _, _, err = postgres.UpdateStoreAccessGrantPermissions(ctx, db, a, owner, requesterGrant.ID, []string{"finance_read"}, requesterGrant.Version, "concurrent-permission-change", "concurrent-permission-corr"); err != nil {
			t.Fatal(err)
		}
		call(requester, "POST", "/dsh/partner/payout-requests", `{"scopeMode":"FULL_AVAILABLE","storeIds":["finance-store-a"]}`, 403)
		if payoutCalls != 2 {
			t.Fatalf("denied mutations reached WLT: %d calls", payoutCalls)
		}
	})
}
