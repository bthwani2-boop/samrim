package financialhandoff

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	wlt "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/wlt"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/opsafety"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	_ "github.com/lib/pq"
)

// An externally launched real WLT HTTP server, backed by its own dedicated
// migrated database, is mandatory. No fake WLT handler or shared runtime.
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
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	// A source projection with exactly the columns used by the real DSH
	// canonical order reader. This proves a two-database adapter boundary, not
	// the entire DSH checkout/order-write lifecycle.
	if _, err := db.ExecContext(ctx, "CREATE SCHEMA dsh"); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, "CREATE TABLE dsh.commerce_orders(id text PRIMARY KEY,payment_intent_id text NOT NULL,total_amount_minor bigint NOT NULL,payment_cash_amount_minor bigint NOT NULL)"); err != nil {
		t.Fatal(err)
	}
	orderID := os.Getenv("WLT_FINANCIAL_PROOF_ORDER_ID")
	intentID := os.Getenv("WLT_FINANCIAL_PROOF_PAYMENT_ID")
	partner := os.Getenv("WLT_FINANCIAL_PROOF_PARTNER_ID")
	if orderID == "" || intentID == "" || partner == "" {
		t.Fatal("incomplete immutable WLT proof identities")
	}
	if _, err := db.ExecContext(ctx, "INSERT INTO dsh.commerce_orders(id,payment_intent_id,total_amount_minor,payment_cash_amount_minor) VALUES($1,$2,1500,300)", orderID, intentID); err != nil {
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
	item := postgres.FinancialHandoffOutbox{
		EffectType: "STORE_PICKUP_COLLECTION", OrderID: orderID, PaymentIntentID: intentID,
		PartnerActorID: partner, AmountMinor: 300,
		SourceRef:      orderID + "-picked-up",
		IdempotencyKey: orderID + "-collection-key", CorrelationID: orderID + "-correlation",
	}
	for i := 0; i < 2; i++ {
		if err := service.apply(ctx, item); err != nil {
			t.Fatalf("real WLT collection and partner earning, attempt %d: %v", i+1, err)
		}
	}
	record, err := client.Read(ctx, intentID)
	if err != nil || record.State != "COLLECTED" || record.CustomerPaymentAllocation == nil ||
		record.CustomerPaymentAllocation.CustomerPayableMinor != 1500 ||
		record.CustomerPaymentAllocation.CashAmountMinor != 300 ||
		record.CollectedByActorID == nil || *record.CollectedByActorID != partner {
		t.Fatalf("real WLT owner readback wrong: %+v err=%v", record, err)
	}
	bad := item
	bad.AmountMinor = 301
	if err := service.apply(ctx, bad); err == nil {
		t.Fatal("wrong DSH cash amount must never replay real WLT settlement")
	}
	t.Log(fmt.Sprintf("real DSH order read -> real WLT HTTP -> WLT collected state verified: order=%s", orderID))
}
