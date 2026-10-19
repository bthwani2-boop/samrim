package postgres

import (
	"strings"
	"testing"
)

func TestOrderAdjustmentReconciliationCaseListScopesCanonicalPayer(t *testing.T) {
	for _, required := range []string{
		"JOIN wlt.customer_payment_allocations allocation",
		"allocation.order_id=reconciliation.order_id",
		"allocation.payment_intent_id=reconciliation.payment_intent_id",
		"JOIN wlt.payment_intents intent",
		"intent.payer_actor_id=reconciliation.customer_actor_id",
		"intent.payer_actor_id=$2",
	} {
		if !strings.Contains(listOrderAdjustmentCasesByOrderSQL, required) {
			t.Fatalf("order adjustment case list is missing canonical payer scope %q", required)
		}
	}
}
