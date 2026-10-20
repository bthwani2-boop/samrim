package financialhandoff

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	identityintegration "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/identity"
	wlt "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/wlt"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/opsafety"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	transporthttp "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/transport/http"
	_ "github.com/lib/pq"
)

// The parent process starts real WLT HTTP against its own migrated PostgreSQL.
// This child requires a separate pristine DSH database. It verifies one OrderId
// from a migrated canonical order through client/partner HTTP and WLT settlement.
// Identity session responses are test-scoped; this is not a mobile UI proof.
func TestRealWLTStorePickupMixedFundingReconcilesAcrossDatabases(t *testing.T) {
	dshURL := strings.TrimSpace(os.Getenv("DSH_FINANCIAL_HANDOFF_TEST_DATABASE_URL"))
	wltURL := strings.TrimSpace(os.Getenv("WLT_FINANCIAL_HANDOFF_REAL_URL"))
	if dshURL == "" || wltURL == "" {
		t.Skip("dedicated DSH database and real test-owned WLT server required")
	}
	if os.Getenv("BTHWANI_ENV") != "test" || os.Getenv("BTHWANI_FINANCIAL_PROOF_ISOLATED") != "1" {
		t.Fatal("refuse non-isolated financial handoff")
	}
	if _, err := opsafety.RequireExpectedDatabaseTarget(dshURL, os.Getenv); err != nil {
		t.Fatal(err)
	}
	db, err := sql.Open("postgres", dshURL)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	var fresh bool
	if err := db.QueryRowContext(ctx, "SELECT to_regclass('dsh.schema_migrations') IS NULL").Scan(&fresh); err != nil || !fresh {
		t.Fatalf("refuse reused DSH database: fresh=%t err=%v", fresh, err)
	}
	proofKeys, err := postgres.NewDeliveryProofKeyring("test-v1", map[string]string{
		"test-v1": "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=",
	})
	if err != nil {
		t.Fatal(err)
	}
	records, migrations, err := postgres.LoadMigrations()
	if err != nil {
		t.Fatal(err)
	}
	if err := postgres.Migrate(ctx, db, records, migrations, proofKeys); err != nil {
		t.Fatalf("migrate canonical DSH schema: %v", err)
	}
	orderID := os.Getenv("WLT_FINANCIAL_PROOF_ORDER_ID")
	intentID := os.Getenv("WLT_FINANCIAL_PROOF_PAYMENT_ID")
	partner := os.Getenv("WLT_FINANCIAL_PROOF_PARTNER_ID")
	if orderID == "" || intentID == "" || partner == "" {
		t.Fatal("incomplete immutable WLT proof identities")
	}
	const customer = "proof-pickup-customer"
	const store = "proof-pickup-store"
	const city = "proof-pickup-city"
	const cart = "proof-pickup-cart"
	if _, err := db.ExecContext(ctx, "INSERT INTO dsh.service_cities(id,display_name_ar,active) VALUES($1,'Test City',true)", city); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, "INSERT INTO dsh.commerce_verticals(id,name_ar,name_en) VALUES('proof-pickup-vertical','Test Vertical','Test Vertical')"); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, "INSERT INTO dsh.commercial_store_types(id,vertical_id,name_ar,name_en) VALUES('proof-pickup-type','proof-pickup-vertical','Test Store Type','Test Store Type')"); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO dsh.stores(id,partner_actor_id,name,service_city_id,primary_vertical_id,commercial_store_type_id,publication_state,fulfillment_modes)
		VALUES($1,$2,'Test Pickup Store',$3,'proof-pickup-vertical','proof-pickup-type','unpublished',ARRAY['CUSTOMER_PICKUP'])`, store, partner, city); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, "INSERT INTO dsh.commerce_carts(id,client_actor_id,store_id,state,version) VALUES($1,$2,$3,'checked_out',1)", cart, customer, store); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO dsh.commerce_orders
		(id,client_actor_id,store_id,cart_id,service_city_id,serviceability_store_version,
		state,total_amount_minor,currency,version,payment_intent_id,
		payment_method,payment_state,fulfillment_mode,payment_cash_amount_minor)
		VALUES($1,$2,$3,$4,$5,1,'READY_FOR_PICKUP',1500,'YER',1,$6,
		'CASH_AT_STORE','REQUIRES_COLLECTION','CUSTOMER_PICKUP',300)`,
		orderID, customer, store, cart, city, intentID); err != nil {
		t.Fatal(err)
	}
	const pickupCode = "123456"
	keyID, ciphertext, err := proofKeys.Encrypt(orderID, pickupCode)
	if err != nil {
		t.Fatal(err)
	}
	verifier, err := proofKeys.ProofVerifier(orderID, keyID, pickupCode)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO dsh.commerce_order_delivery_proofs
		(order_id,client_actor_id,proof_type,state,code_key_id,code_verifier,code_ciphertext)
		VALUES($1,$2,'STORE_PICKUP','PENDING',$3,$4,$5)`, orderID, customer, keyID, verifier, ciphertext); err != nil {
		t.Fatal(err)
	}
	client, err := wlt.New(wltURL, "test", os.Getenv("WLT_FINANCIAL_PROOF_SERVICE_TOKEN"))
	if err != nil {
		t.Fatal(err)
	}
	service, err := New(db, client)
	if err != nil {
		t.Fatal(err)
	}
	// The same canonical OrderId is visible to its authorized client and partner.
	sessions := map[string]struct{ subject, role, surface string }{
		"proof-client-session":        {customer, "client", "app-client"},
		"proof-partner-session":       {partner, "partner", "app-partner"},
		"proof-other-session":         {"foreign-client", "client", "app-client"},
		"proof-other-partner-session": {"foreign-partner", "partner", "app-partner"},
	}
	identityServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if strings.HasSuffix(r.URL.Path, "/roles/operator") {
			actorID := "proof-operator"
			if strings.Contains(r.URL.Path, "proof-denied") {
				actorID = "proof-denied"
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"actorId": actorID, "role": "operator", "enabled": true,
				"securityEnabled": true, "activatedAt": "2026-01-01T00:00:00Z",
			})
			return
		}
		if strings.HasSuffix(r.URL.Path, "/permissions/operations") {
			actorID := "proof-operator"
			enabled := true
			if strings.Contains(r.URL.Path, "proof-denied") {
				actorID, enabled = "proof-denied", false
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"actorId": actorID, "permission": "operations",
				"enabled": enabled, "version": 1,
			})
			return
		}
		if r.URL.Path != "/auth/session" {
			http.NotFound(w, r)
			return
		}
		identity, ok := sessions[strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")]
		if !ok {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"subject": identity.subject, "role": identity.role, "surface": identity.surface,
			"expiresAt": time.Now().Add(time.Hour).UTC(),
		})
	}))
	defer identityServer.Close()
	endpoint, err := identityintegration.ResolveBaseURL(identityServer.URL, "test")
	if err != nil {
		t.Fatal(err)
	}
	identityClient, err := identityintegration.New(endpoint, "test-owned-identity-service-token")
	if err != nil {
		t.Fatal(err)
	}
	orders, err := transporthttp.NewOrder(identityClient, "test-owned-dsh-service-token", db, client, proofKeys)
	if err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	orders.Register(mux)
	// The client retrieves the encrypted pickup code through the real
	// actor-scoped HTTP route; neither the partner nor a foreign client may read it.
	readClientProof := func(token string, status int) *httptest.ResponseRecorder {
		t.Helper()
		request := httptest.NewRequest(http.MethodGet, "/dsh/orders/"+orderID+"/delivery-proof", nil)
		request.Header.Set("Authorization", "Bearer "+token)
		response := httptest.NewRecorder()
		mux.ServeHTTP(response, request)
		if response.Code != status {
			t.Fatalf("pickup proof read for %s got %d want %d: %s", token, response.Code, status, response.Body.String())
		}
		return response
	}
	clientProof := readClientProof("proof-client-session", http.StatusOK)
	var proof struct {
		Code string `json:"code"`
	}
	if err := json.Unmarshal(clientProof.Body.Bytes(), &proof); err != nil || proof.Code != pickupCode {
		t.Fatalf("client did not receive its own valid pickup code: err=%v", err)
	}
	readClientProof("proof-other-session", http.StatusNotFound)
	readClientProof("proof-partner-session", http.StatusForbidden)
	// The partner supplies the client's observed code only to the canonical
	// transition endpoint. A wrong code cannot settle money.
	transitionPathPrefix := "/dsh/stores/" + store + "/orders/" + orderID + "/transition"
	callPickup := func(code string) *httptest.ResponseRecorder {
		t.Helper()
		request := httptest.NewRequest(http.MethodPost, transitionPathPrefix,
			strings.NewReader(fmt.Sprintf(`{"state":"PICKED_UP","code":%q}`, code)))
		request.Header.Set("Authorization", "Bearer proof-partner-session")
		request.Header.Set("Content-Type", "application/json")
		request.Header.Set("X-Expected-Version", "1")
		request.Header.Set("X-Correlation-ID", "proof-pickup-transition-correlation")
		request.Header.Set("Idempotency-Key", "proof-pickup-transition-key")
		response := httptest.NewRecorder()
		mux.ServeHTTP(response, request)
		return response
	}
	badPickup := callPickup("000000")
	if badPickup.Code != http.StatusConflict || !strings.Contains(badPickup.Body.String(), "DELIVERY_PROOF_INVALID") {
		t.Fatalf("wrong pickup code was not rejected: %d %s", badPickup.Code, badPickup.Body.String())
	}
	if pending, err := postgres.ListPendingFinancialHandoffs(ctx, db, 10); err != nil || len(pending) != 0 {
		t.Fatalf("bad proof created financial event: %d %v", len(pending), err)
	}
	complete := callPickup(proof.Code)
	if complete.Code != http.StatusOK || !strings.Contains(complete.Body.String(), orderID) {
		t.Fatalf("partner pickup transition failed: %d %s", complete.Code, complete.Body.String())
	}
	replay := callPickup(proof.Code)
	if replay.Code != http.StatusOK || !strings.Contains(replay.Body.String(), `"idempotentReplay":true`) {
		t.Fatalf("identical partner pickup retry failed: %d %s", replay.Code, replay.Body.String())
	}
	pending, err := postgres.ListPendingFinancialHandoffs(ctx, db, 10)
	if err != nil || len(pending) != 1 || pending[0].OrderID != orderID ||
		pending[0].PaymentIntentID != intentID || pending[0].EffectType != "STORE_PICKUP_COLLECTION" {
		t.Fatalf("canonical order transition did not produce one financial handoff: %+v err=%v", pending, err)
	}
	bad := pending[0]
	bad.AmountMinor++
	if err := service.apply(ctx, bad); err == nil {
		t.Fatal("mismatched DSH cash allocation was accepted by WLT")
	}
	// This processes the actual outbox from partner fulfillment. Posting it
	// atomically updates DSH payment_state after WLT confirms collection.
	if err := service.Reconcile(ctx); err != nil {
		t.Fatalf("reconcile actual DSH outbox to WLT: %v", err)
	}
	if err := service.Reconcile(ctx); err != nil {
		t.Fatalf("re-run posted outbox without double settlement: %v", err)
	}
	if pending, err := postgres.ListPendingFinancialHandoffs(ctx, db, 10); err != nil || len(pending) != 0 {
		t.Fatalf("settlement outbox was not posted: %+v err=%v", pending, err)
	}
	canonicalOrder, err := postgres.ReadOrder(ctx, db, orderID)
	if err != nil || canonicalOrder.State != "PICKED_UP" || canonicalOrder.PaymentState != "COLLECTED" {
		t.Fatalf("DSH completion and payment state mismatch: %+v err=%v", canonicalOrder, err)
	}
	record, err := client.Read(ctx, intentID)
	if err != nil || record.State != "COLLECTED" || record.CustomerPaymentAllocation == nil ||
		record.CustomerPaymentAllocation.CustomerPayableMinor != 1500 ||
		record.CustomerPaymentAllocation.CashAmountMinor != 300 ||
		record.CollectedByActorID == nil || *record.CollectedByActorID != partner {
		t.Fatalf("real WLT owner readback wrong: %+v err=%v", record, err)
	}
	var paymentAuditCount int
	if err := db.QueryRowContext(ctx, "SELECT count(*) FROM dsh.commerce_order_payment_audit WHERE order_id=$1 AND event_type='payment_collected'", orderID).Scan(&paymentAuditCount); err != nil || paymentAuditCount != 1 {
		t.Fatalf("financial audit duplication: %d err=%v", paymentAuditCount, err)
	}
	for _, view := range []struct {
		token string
		want  int
	}{
		{"proof-client-session", 200},
		{"proof-partner-session", 200},
		{"proof-other-session", 404},
		{"invalid-session", 401},
	} {
		request := httptest.NewRequest(http.MethodGet, "/dsh/orders/"+orderID, nil)
		request.Header.Set("Authorization", "Bearer "+view.token)
		response := httptest.NewRecorder()
		mux.ServeHTTP(response, request)
		if response.Code != view.want {
			t.Fatalf("same OrderId %s got HTTP %d expected %d body=%s", view.token, response.Code, view.want, response.Body.String())
		}
		if view.want == 200 && (!strings.Contains(response.Body.String(), orderID) ||
			!strings.Contains(response.Body.String(), intentID)) {
			t.Fatalf("canonical DSH Order/PaymentIntent mismatched for %s: %s", view.token, response.Body.String())
		}
	}
	// These are the partner store and Control Panel's real DSH API surfaces,
	// not additional copies of the order record.
	for _, view := range []struct {
		path, token, acting string
		want                int
	}{
		{"/dsh/stores/" + store + "/orders/" + orderID, "proof-partner-session", "", 200},
		{"/dsh/stores/" + store + "/orders/" + orderID, "proof-other-partner-session", "", 403},
		{"/dsh/operator/operations/" + orderID, "test-owned-dsh-service-token", "proof-operator", 200},
		{"/dsh/operator/operations/" + orderID, "test-owned-dsh-service-token", "proof-denied", 403},
	} {
		request := httptest.NewRequest(http.MethodGet, view.path, nil)
		request.Header.Set("Authorization", "Bearer "+view.token)
		if view.acting != "" {
			request.Header.Set("X-Acting-Actor-ID", view.acting)
		}
		response := httptest.NewRecorder()
		mux.ServeHTTP(response, request)
		if response.Code != view.want {
			t.Fatalf("partner/operator OrderId %s as %s got %d want %d body=%s",
				view.path, view.acting, response.Code, view.want, response.Body.String())
		}
		if view.want == 200 && !strings.Contains(response.Body.String(), orderID) {
			t.Fatalf("partner/operator canonical read lost OrderId: %s", response.Body.String())
		}
	}
	payable, cash, err := postgres.ReadOrderPaymentAmounts(ctx, db, orderID, intentID)
	if err != nil || payable != record.CustomerPaymentAllocation.CustomerPayableMinor ||
		cash != record.CustomerPaymentAllocation.CashAmountMinor {
		t.Fatalf("DSH/WLT payable or cash diverged: DSH %d/%d WLT %+v err=%v",
			payable, cash, record.CustomerPaymentAllocation, err)
	}
	t.Log(fmt.Sprintf("client proof HTTP -> partner pickup HTTP -> DSH outbox POSTED -> real WLT COLLECTED -> DSH payment COLLECTED; client/partner/operator share order=%s", orderID))
}
