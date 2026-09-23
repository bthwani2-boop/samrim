package postgres

import (
	"strings"
	"testing"

	"github.com/bthwani2-boop/samrim/services/wlt/backend/internal/domain"
)

func TestCashLiabilityQueryIsScopedToCOD(t *testing.T) {
	query, args := cashLiabilityQuery("", 100)
	if !strings.Contains(query, "p.method=$1") {
		t.Fatal("cash custody query must filter by payment method")
	}
	if len(args) != 2 || args[0] != domain.MethodCashOnDelivery || args[1] != 100 {
		t.Fatalf("unexpected all-captain cash custody parameters: %#v", args)
	}

	query, args = cashLiabilityQuery("captain-1", 25)
	if !strings.Contains(query, "p.method=$1") || !strings.Contains(query, "p.collected_by_actor_id=$2") {
		t.Fatal("captain cash custody query must preserve the COD and captain filters")
	}
	if len(args) != 3 || args[0] != domain.MethodCashOnDelivery || args[1] != "captain-1" || args[2] != 25 {
		t.Fatalf("unexpected captain cash custody parameters: %#v", args)
	}
}

func TestCaptainCashRemittanceRejectsCashAtStore(t *testing.T) {
	collectedBy := "partner-1"
	amount := int64(1500)
	input := RemitCashInput{CaptainActorID: collectedBy, AmountMinor: amount, ExpectedPaymentVersion: 2}
	payment := PaymentIntentRecord{
		Method:               domain.MethodCashOnDelivery,
		State:                "COLLECTED",
		Version:              2,
		CollectedByActorID:   &collectedBy,
		CollectedAmountMinor: &amount,
	}
	if !matchesCaptainCashRemittance(payment, input) {
		t.Fatal("valid COD collection was rejected")
	}

	payment.Method = domain.MethodCashAtStore
	if matchesCaptainCashRemittance(payment, input) {
		t.Fatal("cash collected by the store must not enter captain remittance")
	}
}
