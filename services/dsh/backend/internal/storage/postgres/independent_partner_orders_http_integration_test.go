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

// Only called from the disposable PostGIS integration test. Identity is a
// synthetic session responder: this verifies DSH's session boundary and real
// database ACL, not a live Identity or financial service.
func exerciseIndependentPartnerOrderHTTPOnIsolatedDB(t *testing.T, ctx context.Context, db *sql.DB, storeID, marketplaceStoreID, ownerID, orderID string) {
	t.Helper()
	identityServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var subject, role, surface string
		switch r.Header.Get("Authorization") {
		case "Bearer qa-pickup-owner":
			subject, role, surface = ownerID, "partner", "app-partner"
		case "Bearer qa-pickup-staff":
			subject, role, surface = "qa-pickup-staff-actor", "partner", "app-partner"
		case "Bearer qa-pickup-other-owner":
			subject, role, surface = "direct-owner-b", "partner", "app-partner"
		case "Bearer qa-pickup-client":
			subject, role, surface = "qa-pickup-client-actor", "client", "app-client"
		default:
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]string{
			"subject": subject, "role": role, "surface": surface,
		})
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
	// Direct pickup changes do not use WLT. A payment call has no configured
	// dependency and cannot masquerade as a successful financial operation.
	orderServer, err := transporthttp.NewOrder(identity, strings.Repeat("s", 32), db, &wlt.Client{}, testDeliveryProofKeyring(t))
	if err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	orderServer.Register(mux)

	listPath := "/dsh/partner/stores/" + storeID + "/direct-orders"
	patchPath := listPath + "/" + orderID
	call := func(method, token, path, payload, spoofHeader string, expected int) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequestWithContext(ctx, method, path, strings.NewReader(payload))
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		if payload != "" {
			req.Header.Set("Content-Type", "application/json")
		}
		if spoofHeader != "" {
			req.Header.Set(spoofHeader, ownerID)
		}
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)
		if rec.Code != expected {
			t.Fatalf("%s %s token=%s got=%d want=%d body=%s", method, path, token, rec.Code, expected, rec.Body.String())
		}
		if !strings.Contains(rec.Header().Get("Cache-Control"), "no-store") ||
			rec.Header().Get("X-Robots-Tag") != "noindex, nofollow" {
			t.Fatalf("private direct-order response cache policy missing: %d headers=%v", rec.Code, rec.Header())
		}
		return rec
	}
	list := func(token, path string, want int) *httptest.ResponseRecorder {
		return call(http.MethodGet, token, path, "", "", want)
	}
	patch := func(token, payload string, want int) *httptest.ResponseRecorder {
		return call(http.MethodPatch, token, patchPath, payload, "", want)
	}

	owner := list("qa-pickup-owner", listPath+"?limit=100", http.StatusOK)
	var page postgres.IndependentPartnerOrderPage
	if err := json.Unmarshal(owner.Body.Bytes(), &page); err != nil {
		t.Fatal(err)
	}
	found := false
	for _, record := range page.Orders {
		if record.StoreID != storeID {
			t.Fatalf("cross-Store record leaked: %+v", record)
		}
		if record.OrderID == orderID && record.State == "ACCEPTED" && record.Version == 2 {
			found = true
		}
	}
	if !found || strings.Contains(owner.Body.String(), "QA Pickup Buyer") ||
		strings.Contains(owner.Body.String(), "+967700001235") {
		t.Fatalf("owner list missing canonical order or leaked guest private details: %s", owner.Body.String())
	}
	for _, denied := range []struct {
		token, path string
		status      int
	}{
		{"", listPath, http.StatusUnauthorized},
		{"qa-pickup-other-owner", listPath, http.StatusNotFound},
		{"qa-pickup-client", listPath, http.StatusForbidden},
		{"qa-pickup-owner", "/dsh/partner/stores/" + marketplaceStoreID + "/direct-orders", http.StatusNotFound},
	} {
		rec := list(denied.token, denied.path, denied.status)
		if strings.Contains(rec.Body.String(), orderID) {
			t.Fatalf("unauthorized direct-order GET disclosed order %q", orderID)
		}
	}
	call(http.MethodGet, "qa-pickup-owner", listPath, "", "X-Actor-ID", http.StatusBadRequest)
	call(http.MethodPatch, "qa-pickup-owner", patchPath,
		`{"state":"PREPARING","expectedVersion":2}`, "X-Acting-Actor-ID", http.StatusBadRequest)

	// Prove the same real DB grant enforces separate read/fulfillment rights.
	const grantID = "qa-pickup-staff-access"
	if _, err := db.ExecContext(ctx, `INSERT INTO dsh.store_access_grants
      (id,store_id,owner_partner_actor_id,delegate_actor_id,permissions,state,version,expires_at,accepted_at)
      VALUES($1,$2,$3,'qa-pickup-staff-actor',ARRAY['catalog'],'active',1,
             clock_timestamp()+interval '1 day',clock_timestamp())`, grantID, storeID, ownerID); err != nil {
		t.Fatal(err)
	}
	list("qa-pickup-staff", listPath, http.StatusNotFound)
	if _, err := db.ExecContext(ctx, `UPDATE dsh.store_access_grants
        SET permissions=ARRAY['orders'] WHERE id=$1`, grantID); err != nil {
		t.Fatal(err)
	}
	staffList := list("qa-pickup-staff", listPath, http.StatusOK)
	if !strings.Contains(staffList.Body.String(), orderID) {
		t.Fatalf("read-authorized staff cannot see owned order: %s", staffList.Body.String())
	}
	const payload = `{"state":"PREPARING","expectedVersion":2}`
	patch("qa-pickup-staff", payload, http.StatusNotFound)
	if _, err := db.ExecContext(ctx, `UPDATE dsh.store_access_grants
        SET permissions=ARRAY['orders','fulfillment'] WHERE id=$1`, grantID); err != nil {
		t.Fatal(err)
	}
	modified := patch("qa-pickup-staff", payload, http.StatusOK)
	var state postgres.IndependentDirectOrderStatus
	if err := json.Unmarshal(modified.Body.Bytes(), &state); err != nil {
		t.Fatal(err)
	}
	if state.OrderID != orderID || state.StoreID != storeID || state.State != "PREPARING" || state.Version != 3 {
		t.Fatalf("delegated staff HTTP transition returned wrong canonical state: %+v", state)
	}
	replay := patch("qa-pickup-staff", payload, http.StatusOK)
	if !strings.Contains(replay.Body.String(), `"state":"PREPARING"`) {
		t.Fatalf("same-actor retry failed to replay persisted state: %s", replay.Body.String())
	}
	patch("qa-pickup-staff", `{"state":"REJECTED","expectedVersion":2,"reason":"conflict"}`, http.StatusConflict)
	patch("qa-pickup-other-owner", payload, http.StatusNotFound)
	patch("qa-pickup-client", payload, http.StatusForbidden)

	if _, err := db.ExecContext(ctx, `UPDATE dsh.store_access_grants
        SET state='suspended' WHERE id=$1`, grantID); err != nil {
		t.Fatal(err)
	}
	list("qa-pickup-staff", listPath, http.StatusNotFound)
	patch("qa-pickup-staff", payload, http.StatusNotFound)
	readback := list("qa-pickup-owner", listPath, http.StatusOK)
	if !strings.Contains(readback.Body.String(), `"state":"PREPARING"`) {
		t.Fatalf("canonical owner readback lost delegated transition: %s", readback.Body.String())
	}
	var version, events int
	var persisted string
	if err := db.QueryRowContext(ctx, `SELECT state,version FROM dsh.independent_direct_orders
        WHERE store_id=$1 AND id=$2`, storeID, orderID).Scan(&persisted, &version); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRowContext(ctx, `SELECT count(*) FROM dsh.independent_direct_order_audit
        WHERE order_id=$1 AND event_type='partner_transition'`, orderID).Scan(&events); err != nil {
		t.Fatal(err)
	}
	if persisted != "PREPARING" || version != 3 || events != 2 {
		t.Fatalf("HTTP grant/CAS/replay changed durable record incorrectly: %s v%d events=%d", persisted, version, events)
	}
}
