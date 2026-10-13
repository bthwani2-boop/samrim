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

	wlt "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/wlt"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/opsafety"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	_ "github.com/lib/pq"
)

// This targeted contract fixture covers ReadOrderPaymentAmounts -> financial
// handoff -> the real WLT HTTP client. WLT HTTP replies are simulated; the
// canonical DSH amount reader executes against an owned isolated PostgreSQL.
// Full DSH/WLT service-to-service persistence is a separate lead integration.
func TestHandoffPassesCustomerPayableWhileCollectingOnlyCash(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("DSH_FINANCIAL_HANDOFF_TEST_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("isolated DSH financial-handoff database is not configured")
	}
	if os.Getenv("BTHWANI_ENV") != "test" || os.Getenv("BTHWANI_FINANCIAL_PROOF_ISOLATED") != "1" {
		t.Fatal("refuse financial proof without test mode and explicit isolated DB")
	}
	if _, err := opsafety.RequireExpectedDatabaseTarget(databaseURL, os.Getenv); err != nil {
		t.Fatalf("refuse non-owned DB target: %v", err)
	}
	db, err := sql.Open("postgres", databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	// The only table this handoff reads. Refuse to reuse any existing schema
	// rather than mutate adopted orders or shared development data.
	if _, err := db.ExecContext(ctx, "CREATE SCHEMA dsh"); err != nil {
		t.Fatalf("refuse nonempty/reused test database: %v", err)
	}
	if _, err := db.ExecContext(ctx, "CREATE TABLE dsh.commerce_orders (id text PRIMARY KEY, payment_intent_id text NOT NULL, total_amount_minor bigint NOT NULL, payment_cash_amount_minor bigint NOT NULL)"); err != nil {
		t.Fatal(err)
	}

	cases := []struct {
		name      string
		effect    string
		payable   int64
		cash      int64
		method    string
		collector string
		finishes  int
	}{
		{"delivery-mixed", "DELIVERY_SETTLEMENT", 1500, 300, "CASH_ON_DELIVERY", "captain-test", 2},
		{"delivery-balance", "DELIVERY_SETTLEMENT", 1500, 0, "CASH_ON_DELIVERY", "", 1},
		{"pickup-mixed", "STORE_PICKUP_COLLECTION", 1500, 300, "CASH_AT_STORE", "partner-test", 1},
		{"partner-captain-mixed", "PARTNER_CAPTAIN_STORE_CASH_COLLECTION", 1500, 300, "CASH_AT_STORE", "partner-test", 1},
		{"partner-captain-balance", "PARTNER_CAPTAIN_BALANCE_SETTLEMENT", 1500, 0, "CASH_AT_STORE", "", 1},
	}
	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			orderID, intentID := "proof-order-"+tt.name, "proof-intent-"+tt.name
			if _, err := db.ExecContext(ctx, "INSERT INTO dsh.commerce_orders(id,payment_intent_id,total_amount_minor,payment_cash_amount_minor) VALUES($1,$2,$3,$4)", orderID, intentID, tt.payable, tt.cash); err != nil {
				t.Fatal(err)
			}
			collectCalls, finalCalls := 0, 0
			handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				path := "/wlt/v1/payment-intents/" + intentID
				if r.Method == http.MethodGet && r.URL.Path == path {
					_ = json.NewEncoder(w).Encode(map[string]any{"paymentIntent": map[string]any{
						"id": intentID, "state": "REQUIRES_COLLECTION", "method": tt.method,
						"version": 1, "amountMinor": tt.cash, "currency": "YER",
						"customerPaymentAllocation": map[string]any{
							"orderId": orderID, "customerPayableMinor": tt.payable,
							"cashAmountMinor": tt.cash, "internalBalanceAmountMinor": tt.payable - tt.cash,
						},
					}})
					return
				}
				if r.Method == http.MethodPost && r.URL.Path == path+"/collect" {
					var body struct {
						Amount    int64  `json:"collectedAmountMinor"`
						Actor     string `json:"collectedByActorId"`
						Reference string `json:"collectionReference"`
					}
					if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
						t.Errorf("decode WLT collection: %v", err)
					}
					if body.Amount != tt.cash || body.Actor != tt.collector || (tt.cash == 0 && body.Reference != "") {
						t.Errorf("cash collection mismatch: %+v, cash=%d actor=%s", body, tt.cash, tt.collector)
					}
					collectCalls++
					collected := map[string]any{
						"id": intentID, "state": "COLLECTED", "method": tt.method,
						"version": 2, "amountMinor": tt.cash, "currency": "YER",
						"collectedAmountMinor": tt.cash,
						"customerPaymentAllocation": map[string]any{
							"orderId": orderID, "customerPayableMinor": tt.payable,
							"cashAmountMinor": tt.cash, "internalBalanceAmountMinor": tt.payable - tt.cash,
						},
					}
					if tt.cash > 0 {
						collected["collectedByActorId"] = tt.collector
					}
					_ = json.NewEncoder(w).Encode(map[string]any{"paymentIntent": collected})
					return
				}
				if r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/finalize") {
					finalCalls++
					_ = json.NewEncoder(w).Encode(map[string]any{
						"reservation": map[string]any{}, "earning": map[string]any{}, "commission": map[string]any{},
					})
					return
				}
				http.Error(w, fmt.Sprintf("unexpected WLT request %s %s", r.Method, r.URL.Path), http.StatusNotFound)
			})
			server := httptest.NewServer(handler)
			defer server.Close()
			client, err := wlt.New(server.URL, "test", "test-financial-handoff-token")
			if err != nil {
				t.Fatal(err)
			}
			service, err := New(db, client)
			if err != nil {
				t.Fatal(err)
			}
			item := postgres.FinancialHandoffOutbox{
				EffectType: tt.effect, SourceRef: "source-" + tt.name,
				OrderID: orderID, PaymentIntentID: intentID,
				PartnerActorID: "partner-test", CaptainActorID: "captain-test",
				AmountMinor: tt.cash, IdempotencyKey: "proof-collection-" + tt.name,
				CorrelationID: "proof-correlation-" + tt.name,
			}
			if err := service.apply(ctx, item); err != nil {
				t.Fatalf("handoff failed despite matching payable and cash allocations: %v", err)
			}
			if collectCalls != 1 || finalCalls != tt.finishes {
				t.Fatalf("WLT calls: collect=%d finalize=%d, want 1/%d", collectCalls, finalCalls, tt.finishes)
			}
		})
	}
}
