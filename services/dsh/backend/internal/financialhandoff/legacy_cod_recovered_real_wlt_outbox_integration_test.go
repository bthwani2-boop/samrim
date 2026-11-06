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

// The parent WLT integration harness has already approved one historical
// COLLECTED Captain COD payment with original evidence and funded cover.
// Reconcile an existing DSH delivery outbox through the real WLT HTTP owner,
// rather than bypassing DSH by directly posting the earning/debit from the test.
func verifyRealLegacyCODOutboxSettlement(t *testing.T, ctx context.Context, db *sql.DB,
	mux *http.ServeMux, payment *wlt.Client, handoff *Service, partner, store, city string) {
	t.Helper()
	orderID := os.Getenv("WLT_FINANCIAL_PROOF_LEGACY_ORDER_ID")
	paymentID := os.Getenv("WLT_FINANCIAL_PROOF_LEGACY_PAYMENT_ID")
	captainID := os.Getenv("WLT_FINANCIAL_PROOF_LEGACY_CAPTAIN_ID")
	if orderID == "" || paymentID == "" || captainID == "" {
		t.Fatal("missing approved historical COD identifiers from isolated WLT parent")
	}
	const customer = "proof-legacy-cod-customer"
	const cash int64 = 5500
	prior, err := payment.Read(ctx, paymentID)
	if err != nil || prior.State != "COLLECTED" || prior.CollectedAmountMinor == nil ||
		*prior.CollectedAmountMinor != cash || prior.CollectedByActorID == nil ||
		*prior.CollectedByActorID != captainID {
		t.Fatalf("pre-existing WLT collector/payment mismatched: %+v err=%v", prior, err)
	}
	if _, err := db.ExecContext(ctx,
		"INSERT INTO dsh.commerce_carts(id,client_actor_id,store_id,state,version) VALUES('proof-legacy-cod-cart',$1,$2,'checked_out',1)",
		customer, store); err != nil {
		t.Fatal(err)
	}
	// This disposable fixture represents an already delivered historical Order
	// whose original financial handoff was interrupted before WLT settlement.
	if _, err := db.ExecContext(ctx, `INSERT INTO dsh.commerce_orders
		(id,client_actor_id,store_id,cart_id,service_city_id,serviceability_store_version,
		state,total_amount_minor,currency,version,payment_intent_id,payment_method,
		payment_state,fulfillment_mode,payment_cash_amount_minor)
		VALUES($1,$2,$3,'proof-legacy-cod-cart',$4,1,'DELIVERED',$5,'YER',2,$6,
		'CASH_ON_DELIVERY','REQUIRES_COLLECTION','BTHWANI_CAPTAIN',$5)`,
		orderID, customer, store, city, cash, paymentID); err != nil {
		t.Fatal(err)
	}
	const outboxID = "proof-legacy-cod-financial-handoff"
	if _, err := db.ExecContext(ctx, `INSERT INTO dsh.commerce_financial_handoff_outbox
		(id,effect_type,source_ref,order_id,payment_intent_id,captain_actor_id,
		partner_actor_id,amount_minor,idempotency_key,correlation_id,acting_actor_id)
		VALUES($1,'DELIVERY_SETTLEMENT','proof-legacy-assignment',$2,$3,$4,$5,$6,
		'proof-legacy-original-delivery','proof-legacy-reconcile-correlation',$4)`,
		outboxID, orderID, paymentID, captainID, partner, cash); err != nil {
		t.Fatal(err)
	}
	pending, err := postgres.ListPendingFinancialHandoffs(ctx, db, 10)
	if err != nil || len(pending) != 1 || pending[0].ID != outboxID ||
		pending[0].PaymentIntentID != paymentID || pending[0].AmountMinor != cash {
		t.Fatalf("historical DSH outbox not preserved: %+v err=%v", pending, err)
	}
	bad := pending[0]
	bad.AmountMinor--
	if err := handoff.apply(ctx, bad); err == nil {
		t.Fatal("altered historical cash amount was accepted for WLT settlement")
	}
	if err := handoff.Reconcile(ctx); err != nil {
		t.Fatalf("reconcile approved legacy COD through actual DSH outbox: %v", err)
	}
	if err := handoff.Reconcile(ctx); err != nil {
		t.Fatalf("replay posted historical outbox: %v", err)
	}
	order, err := postgres.ReadOrder(ctx, db, orderID)
	if err != nil || order.State != "DELIVERED" || order.PaymentState != "COLLECTED" {
		t.Fatalf("historical DSH Order/payment readback failed: %+v err=%v", order, err)
	}
	collected, err := payment.Read(ctx, paymentID)
	if err != nil || collected.State != "COLLECTED" || collected.CollectedByActorID == nil ||
		*collected.CollectedByActorID != captainID {
		t.Fatalf("historical WLT collection identity changed: %+v err=%v", collected, err)
	}
	var posted, paymentAudits int
	if err := db.QueryRowContext(ctx,
		"SELECT COUNT(*) FROM dsh.commerce_financial_handoff_outbox WHERE id=$1 AND state='POSTED'",
		outboxID).Scan(&posted); err != nil || posted != 1 {
		t.Fatalf("original DSH outbox not posted once: count=%d err=%v", posted, err)
	}
	if err := db.QueryRowContext(ctx,
		"SELECT COUNT(*) FROM dsh.commerce_order_payment_audit WHERE order_id=$1 AND event_type='payment_collected'",
		orderID).Scan(&paymentAudits); err != nil || paymentAudits != 1 {
		t.Fatalf("historical payment audit duplicated: count=%d err=%v", paymentAudits, err)
	}
	for _, view := range []struct {
		token string
		want  int
	}{
		{"proof-legacy-cod-client-session", http.StatusOK},
		{"proof-other-session", http.StatusNotFound},
		{"invalid-session", http.StatusUnauthorized},
	} {
		req := httptest.NewRequest(http.MethodGet, "/dsh/orders/"+orderID, nil)
		req.Header.Set("Authorization", "Bearer "+view.token)
		response := httptest.NewRecorder()
		mux.ServeHTTP(response, req)
		if response.Code != view.want || (view.want == http.StatusOK &&
			!strings.Contains(response.Body.String(), paymentID)) {
			t.Fatalf("historical DSH actor scoped Order view %s: HTTP %d body=%s",
				view.token, response.Code, response.Body.String())
		}
	}
	t.Logf("historical WLT COLLECTED -> independent Finance approved cover -> real DSH outbox POSTED -> WLT earning/COD debit -> DSH audit, order=%s", orderID)
}
