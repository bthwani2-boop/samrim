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
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	transporthttp "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/transport/http"
)

// The payment and COD reservation are created by the parent on real WLT.
// This part exercises DSH's actual Captain HTTP completion, canonical outbox,
// real WLT settlement, and final DSH audit, on a separate migrated database.
func verifyRealCourierMixedSettlement(t *testing.T, ctx context.Context, db *sql.DB,
	mux *http.ServeMux, identity *identityintegration.Client, payment *wlt.Client,
	keys *postgres.DeliveryProofKeyring, handoff *Service, partner, store, city string) {
	t.Helper()
	orderID := os.Getenv("WLT_FINANCIAL_PROOF_COURIER_ORDER_ID")
	intentID := os.Getenv("WLT_FINANCIAL_PROOF_COURIER_PAYMENT_ID")
	captainID := os.Getenv("WLT_FINANCIAL_PROOF_COURIER_CAPTAIN_ID")
	if orderID == "" || intentID == "" || captainID == "" {
		t.Fatal("missing courier identities from real WLT parent")
	}
	const customerID = "proof-courier-customer"
	const cartID = "proof-courier-cart"
	const offerID = "proof-courier-offer"
	const assignmentID = "proof-courier-assignment"
	const proofCode = "654321"
	const completeKey = "proof-courier-complete-key"
	now := time.Now().UTC()
	if _, err := db.ExecContext(ctx, `INSERT INTO dsh.captain_admissions(id,actor_id,full_name_ar,state,availability_state,requires_profile_review,version)
		VALUES('proof-courier-admission',$1,'Courier Test','eligible','unavailable',false,1)`, captainID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, "INSERT INTO dsh.commerce_carts(id,client_actor_id,store_id,state,version) VALUES($1,$2,$3,'checked_out',1)", cartID, customerID, store); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO dsh.commerce_orders
		(id,client_actor_id,store_id,cart_id,address_id,address_version,address_text,address_latitude,address_longitude,
		service_city_id,serviceability_policy_version,serviceability_status,serviceability_store_version,
		serviceability_address_version,state,total_amount_minor,currency,version,payment_intent_id,
		payment_method,payment_state,fulfillment_mode,payment_cash_amount_minor)
		VALUES($1,$2,$3,$4,'proof-courier-address',1,'Test Delivery Address',15.3694457,44.1910064,
		$5,'CITY_SCOPE_V1','SERVICEABLE',1,1,'IN_CUSTODY',1500,'YER',1,$6,
		'CASH_ON_DELIVERY','REQUIRES_COLLECTION','BTHWANI_CAPTAIN',300)`,
		orderID, customerID, store, cartID, city, intentID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO dsh.captain_dispatch_offers(id,order_id,captain_actor_id,state,expires_at,version,idempotency_key,request_hash)
		VALUES($1,$2,$3,'accepted',$4,2,'proof-courier-offer-key','proof-courier-offer-hash')`,
		offerID, orderID, captainID, now.Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO dsh.captain_assignments
		(id,order_id,captain_actor_id,accepted_offer_id,state,version,custody_started_at)
		VALUES($1,$2,$3,$4,'in_custody',1,$5)`,
		assignmentID, orderID, captainID, offerID, now); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO dsh.captain_handoffs
		(assignment_id,order_id,store_id,state,version,store_confirmed_at,captain_picked_up_at)
		VALUES($1,$2,$3,'completed',3,$4,$4)`,
		assignmentID, orderID, store, now); err != nil {
		t.Fatal(err)
	}
	proofKeyID, ciphertext, err := keys.Encrypt(orderID, proofCode)
	if err != nil {
		t.Fatal(err)
	}
	verifier, err := keys.ProofVerifier(orderID, proofKeyID, proofCode)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO dsh.commerce_order_delivery_proofs
		(order_id,client_actor_id,proof_type,state,code_ciphertext,code_verifier,code_key_id)
		VALUES($1,$2,'DELIVERY','PENDING',$3,$4,$5)`, orderID, customerID, ciphertext, verifier, proofKeyID); err != nil {
		t.Fatal(err)
	}
	captains, err := transporthttp.NewCaptain(identity, "test-owned-dsh-service-token", db, payment, keys)
	if err != nil {
		t.Fatal(err)
	}
	captains.Register(mux)
	clientReq := httptest.NewRequest(http.MethodGet, "/dsh/orders/"+orderID+"/delivery-proof", nil)
	clientReq.Header.Set("Authorization", "Bearer proof-courier-client-session")
	clientView := httptest.NewRecorder()
	mux.ServeHTTP(clientView, clientReq)
	var received struct {
		Code string `json:"code"`
	}
	if err := json.Unmarshal(clientView.Body.Bytes(), &received); err != nil || clientView.Code != 200 || received.Code != proofCode {
		t.Fatalf("courier client's proof read invalid: HTTP %d err=%v", clientView.Code, err)
	}
	complete := func(actorToken, code string, collected int64) *httptest.ResponseRecorder {
		t.Helper()
		request := httptest.NewRequest(http.MethodPost,
			"/dsh/captains/me/assignments/"+assignmentID+"/complete",
			strings.NewReader(fmt.Sprintf(`{"result":"delivered","collectedAmountMinor":%d,"deliveryProofCode":%q}`, collected, code)))
		request.Header.Set("Authorization", "Bearer "+actorToken)
		request.Header.Set("X-Expected-Version", "1")
		request.Header.Set("Idempotency-Key", completeKey)
		request.Header.Set("X-Correlation-ID", "proof-courier-completion-correlation")
		request.Header.Set("Content-Type", "application/json")
		reply := httptest.NewRecorder()
		mux.ServeHTTP(reply, request)
		return reply
	}
	foreign := complete("proof-partner-session", received.Code, 300)
	if foreign.Code == http.StatusOK {
		t.Fatalf("partner identity completed Captain's delivery: %s", foreign.Body.String())
	}
	wrongAmount := complete("proof-courier-captain-session", received.Code, 299)
	if wrongAmount.Code == http.StatusOK {
		t.Fatal("captain completed with a wrong cash amount")
	}
	first := complete("proof-courier-captain-session", received.Code, 300)
	if first.Code != http.StatusOK || !strings.Contains(first.Body.String(), assignmentID) {
		t.Fatalf("actual Captain HTTP completion failed: HTTP %d %s", first.Code, first.Body.String())
	}
	again := complete("proof-courier-captain-session", received.Code, 300)
	if again.Code != http.StatusOK || !strings.Contains(again.Body.String(), `"idempotentReplay":true`) {
		t.Fatalf("Captain replay was not safe: HTTP %d %s", again.Code, again.Body.String())
	}
	items, err := postgres.ListPendingFinancialHandoffs(ctx, db, 10)
	if err != nil || len(items) != 1 || items[0].OrderID != orderID ||
		items[0].EffectType != "DELIVERY_SETTLEMENT" || items[0].AmountMinor != 300 ||
		items[0].CaptainActorID != captainID || items[0].PaymentIntentID != intentID {
		t.Fatalf("Captain completion outbox mismatch: %+v err=%v", items, err)
	}
	// WLT performs actual mixed collection, COD hold finalization and partner earning.
	if err := handoff.Reconcile(ctx); err != nil {
		t.Fatalf("real Captain delivery financial reconciliation failed: %v", err)
	}
	if err := handoff.Reconcile(ctx); err != nil {
		t.Fatalf("Captain delivery replay reconciliation failed: %v", err)
	}
	order, err := postgres.ReadOrder(ctx, db, orderID)
	if err != nil || order.State != "DELIVERED" || order.PaymentState != "COLLECTED" {
		t.Fatalf("DSH persisted courier delivery/payment mismatch: %+v err=%v", order, err)
	}
	// Completion must cut the Captain's access to the customer's address.
	taskReq := httptest.NewRequest(http.MethodGet,
		"/dsh/captains/me/assignments/"+assignmentID+"/delivery-task", nil)
	taskReq.Header.Set("Authorization", "Bearer proof-courier-captain-session")
	taskView := httptest.NewRecorder()
	mux.ServeHTTP(taskView, taskReq)
	if taskView.Code != http.StatusNotFound || strings.Contains(taskView.Body.String(), "Test Delivery Address") {
		t.Fatalf("completed Captain still has delivery address: HTTP %d %s", taskView.Code, taskView.Body.String())
	}
	// The customer's verified code must be consumed and no longer revealed.
	clientReq = httptest.NewRequest(http.MethodGet, "/dsh/orders/"+orderID+"/delivery-proof", nil)
	clientReq.Header.Set("Authorization", "Bearer proof-courier-client-session")
	clientView = httptest.NewRecorder()
	mux.ServeHTTP(clientView, clientReq)
	received = struct {
		Code string `json:"code"`
	}{}
	if err := json.Unmarshal(clientView.Body.Bytes(), &received); err != nil ||
		clientView.Code != http.StatusOK || received.Code != "" {
		t.Fatalf("completed proof code remained available: HTTP %d err=%v", clientView.Code, err)
	}
	paymentIntent, err := payment.Read(ctx, intentID)
	if err != nil || paymentIntent.State != "COLLECTED" || paymentIntent.CustomerPaymentAllocation == nil ||
		paymentIntent.CustomerPaymentAllocation.OrderID != orderID ||
		paymentIntent.CustomerPaymentAllocation.InternalBalanceAmountMinor != 1200 ||
		paymentIntent.CustomerPaymentAllocation.CashAmountMinor != 300 {
		t.Fatalf("WLT courier order/payment split mismatch: %+v err=%v", paymentIntent, err)
	}
	var posted, audit, completed int
	if err := db.QueryRowContext(ctx, "SELECT count(*) FROM dsh.commerce_financial_handoff_outbox WHERE order_id=$1 AND state='POSTED'", orderID).Scan(&posted); err != nil || posted != 1 {
		t.Fatalf("DSH courier outbox posted=%d err=%v", posted, err)
	}
	if err := db.QueryRowContext(ctx, "SELECT count(*) FROM dsh.commerce_order_payment_audit WHERE order_id=$1 AND event_type='payment_collected'", orderID).Scan(&audit); err != nil || audit != 1 {
		t.Fatalf("DSH courier payment audit=%d err=%v", audit, err)
	}
	if err := db.QueryRowContext(ctx, "SELECT count(*) FROM dsh.captain_audit WHERE order_id=$1 AND event_type='delivery_completed'", orderID).Scan(&completed); err != nil || completed != 1 {
		t.Fatalf("Captain completion audit=%d err=%v", completed, err)
	}
	for _, view := range []struct {
		token, path string
		status      int
	}{
		{"proof-courier-client-session", "/dsh/orders/" + orderID, 200},
		{"proof-partner-session", "/dsh/stores/" + store + "/orders/" + orderID, 200},
		{"proof-other-session", "/dsh/orders/" + orderID, 404},
		{"proof-other-partner-session", "/dsh/stores/" + store + "/orders/" + orderID, 403},
	} {
		req := httptest.NewRequest(http.MethodGet, view.path, nil)
		req.Header.Set("Authorization", "Bearer "+view.token)
		response := httptest.NewRecorder()
		mux.ServeHTTP(response, req)
		if response.Code != view.status || (view.status == 200 && !strings.Contains(response.Body.String(), orderID)) {
			t.Fatalf("courier OrderId actor visibility: %s HTTP %d body=%s", view.token, response.Code, response.Body.String())
		}
	}
	t.Logf("real Captain HTTP delivery -> DSH outbox -> real WLT COD collection -> DSH payment COLLECTED: %s", orderID)
}
