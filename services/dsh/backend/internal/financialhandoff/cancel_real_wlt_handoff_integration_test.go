package financialhandoff

import (
	"context"
	"database/sql"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	wlt "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/wlt"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

// Cancel through the actual authenticated DSH client endpoint, then let the
// canonical financial outbox cancel WLT and release reserved wallet funds.
// WLT is real HTTP backed by its own isolated migrated PostgreSQL database.
func verifyRealCancelMixedSettlement(t *testing.T, ctx context.Context, db *sql.DB,
	mux *http.ServeMux, payment *wlt.Client, handoff *Service, store, city string) {
	t.Helper()
	orderID := os.Getenv("WLT_FINANCIAL_PROOF_CANCEL_ORDER_ID")
	intentID := os.Getenv("WLT_FINANCIAL_PROOF_CANCEL_PAYMENT_ID")
	customer := os.Getenv("WLT_FINANCIAL_PROOF_CANCEL_CLIENT_ID")
	if orderID == "" || intentID == "" || customer == "" {
		t.Fatal("parent WLT did not pass cancellation identities")
	}
	const cartID = "proof-cancel-cart"
	const cancelKey = "proof-cancel-client-key"
	if _, err := db.ExecContext(ctx, `INSERT INTO dsh.commerce_carts(id,client_actor_id,store_id,state,version)
		VALUES($1,$2,$3,'checked_out',1)`, cartID, customer, store); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO dsh.commerce_orders(
		id,client_actor_id,store_id,cart_id,service_city_id,serviceability_store_version,
		state,total_amount_minor,currency,version,payment_intent_id,payment_method,payment_state,
		fulfillment_mode,payment_cash_amount_minor,cancellation_mode,cancellation_policy_version)
		VALUES($1,$2,$3,$4,$5,1,'CREATED',1500,'YER',1,$6,'CASH_AT_STORE',
		'REQUIRES_COLLECTION','CUSTOMER_PICKUP',300,'CLIENT_BEFORE_ACCEPTANCE',1)`,
		orderID, customer, store, cartID, city, intentID); err != nil {
		t.Fatal(err)
	}
	runCancel := func(token string) *httptest.ResponseRecorder {
		t.Helper()
		request := httptest.NewRequest(http.MethodPost, "/dsh/orders/"+orderID+"/cancel", nil)
		request.Header.Set("Authorization", "Bearer "+token)
		request.Header.Set("X-Expected-Version", "1")
		request.Header.Set("Idempotency-Key", cancelKey)
		request.Header.Set("X-Correlation-ID", "proof-cancel-client-correlation")
		result := httptest.NewRecorder()
		mux.ServeHTTP(result, request)
		return result
	}
	other := runCancel("proof-other-session")
	if other.Code != http.StatusNotFound {
		t.Fatalf("foreign account cancellation not rejected: HTTP %d %s", other.Code, other.Body.String())
	}
	first := runCancel("proof-cancel-client-session")
	if first.Code != http.StatusCreated || !strings.Contains(first.Body.String(), orderID) {
		t.Fatalf("owner cancellation did not persist: HTTP %d %s", first.Code, first.Body.String())
	}
	replay := runCancel("proof-cancel-client-session")
	if replay.Code != http.StatusOK || !strings.Contains(replay.Body.String(), `"idempotentReplay":true`) {
		t.Fatalf("cancel replay did not preserve identity: HTTP %d %s", replay.Code, replay.Body.String())
	}
	pending, err := postgres.ListPendingFinancialHandoffs(ctx, db, 10)
	if err != nil || len(pending) != 1 || pending[0].OrderID != orderID ||
		pending[0].PaymentIntentID != intentID || pending[0].EffectType != "PAYMENT_CANCEL" ||
		pending[0].Reason != "client_cancelled" {
		t.Fatalf("client cancellation did not create one real financial outbox: %+v err=%v", pending, err)
	}
	if err := handoff.Reconcile(ctx); err != nil {
		t.Fatalf("DSH -> WLT real mixed cancellation failed: %v", err)
	}
	if err := handoff.Reconcile(ctx); err != nil {
		t.Fatalf("idempotent WLT cancellation replay failed: %v", err)
	}
	item, err := postgres.ReadOrder(ctx, db, orderID)
	if err != nil || item.State != "CANCELLED" || item.PaymentState != "CANCELLED" {
		t.Fatalf("DSH order/payment cancellation states diverged: %+v err=%v", item, err)
	}
	record, err := payment.Read(ctx, intentID)
	if err != nil || record.State != "CANCELLED" {
		t.Fatalf("WLT did not persist cancellation: %+v err=%v", record, err)
	}
	if pending, err = postgres.ListPendingFinancialHandoffs(ctx, db, 10); err != nil || len(pending) != 0 {
		t.Fatalf("cancelled outbox was left pending: %+v err=%v", pending, err)
	}
	var audit, posted int
	if err := db.QueryRowContext(ctx, "SELECT count(*) FROM dsh.commerce_order_payment_audit WHERE order_id=$1 AND event_type='payment_cancelled'", orderID).Scan(&audit); err != nil || audit != 1 {
		t.Fatalf("cancellation ledger handoff audit=%d err=%v", audit, err)
	}
	if err := db.QueryRowContext(ctx, "SELECT count(*) FROM dsh.commerce_financial_handoff_outbox WHERE order_id=$1 AND state='POSTED'", orderID).Scan(&posted); err != nil || posted != 1 {
		t.Fatalf("posted cancellation outbox=%d err=%v", posted, err)
	}
	t.Logf("real client HTTP cancellation -> DSH outbox -> WLT cancellation -> DSH CANCELLED: %s", orderID)
}
