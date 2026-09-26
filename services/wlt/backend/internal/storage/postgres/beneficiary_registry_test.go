package postgres

import "testing"

func TestBeneficiaryRegistrySortAndActorAllowLists(t *testing.T) {
	for _, value := range []string{
		"actor_asc", "actor_desc", "available_asc", "available_desc",
		"held_asc", "held_desc", "payout_amount_asc", "payout_amount_desc",
	} {
		if !ValidBeneficiaryRegistrySort(value) {
			t.Errorf("expected registry sort %q to be accepted", value)
		}
	}
	for _, value := range []string{"", "customer", "available;DROP TABLE wlt.ledger_entries", "unknown"} {
		if ValidBeneficiaryRegistrySort(value) {
			t.Errorf("expected registry sort %q to be rejected", value)
		}
	}
	for _, value := range []string{"partner", "captain", "field"} {
		if !ValidPayoutRegistryActor(value) {
			t.Errorf("expected payout registry actor %q to be accepted", value)
		}
	}
	if ValidPayoutRegistryActor("customer") {
		t.Error("customer withdrawal intake must not enter the beneficiary earnings payout registry")
	}
}
