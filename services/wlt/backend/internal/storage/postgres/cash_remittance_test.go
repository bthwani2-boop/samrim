package postgres

import (
	"reflect"
	"strings"
	"testing"
	"time"

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

func TestCashLiabilityRegistryUsesScopedSearchAndStableSortCursor(t *testing.T) {
	filter, filterArgs := cashLiabilityRegistryFilter("AB%_")
	if !strings.Contains(filter, "p.state='COLLECTED'") || !strings.Contains(filter, "p.method=$1") || !strings.Contains(filter, "r.id IS NULL") || !strings.Contains(filter, "external_reference") || !strings.Contains(filter, "collected_by_actor_id") {
		t.Fatalf("cash custody registry lost a canonical filter: %s", filter)
	}
	if !reflect.DeepEqual(filterArgs, []any{domain.MethodCashOnDelivery, `ab\%\_%`}) {
		t.Fatalf("cash custody registry search arguments = %#v", filterArgs)
	}

	collectedAt := time.Date(2026, 9, 25, 12, 30, 0, 0, time.UTC)
	query, args := cashLiabilityRegistryQuery(filter, filterArgs, "collected_desc", &collectedAt, "payment-9", 51)
	if !strings.Contains(query, `(p.collected_at, p.id) < ($3, $4)`) || !strings.Contains(query, "ORDER BY p.collected_at DESC, p.id DESC LIMIT $5") {
		t.Fatalf("cash custody registry cursor or order is invalid: %s", query)
	}
	wantArgs := []any{domain.MethodCashOnDelivery, `ab\%\_%`, collectedAt, "payment-9", 51}
	if !reflect.DeepEqual(args, wantArgs) {
		t.Fatalf("cash custody registry SQL arguments = %#v; want %#v", args, wantArgs)
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
