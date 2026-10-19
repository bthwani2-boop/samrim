package postgres

import "testing"

func TestPartnerPayoutRetryIdentifiesBusinessIntentRatherThanCurrentIdentity(t *testing.T) {
	facts := validIdentityFactsFixture()
	input := PartnerPayoutRequestInput{PartnerActorID: "partner-1", ScopeMode: "FULL_AVAILABLE", RequestedStoreIDs: []string{"store-a"}, BeneficiaryFacts: map[string]IdentityFacts{"partner-1": facts}}
	want := HashPartnerPayoutRequest(input)
	facts.ActorVersion++
	input.BeneficiaryFacts["partner-1"] = facts
	if HashPartnerPayoutRequest(input) != want {
		t.Fatal("retry of a committed intent changed identity when current beneficiary facts changed")
	}
	input.RequestedStoreIDs = []string{"store-b"}
	if HashPartnerPayoutRequest(input) == want {
		t.Fatal("different Store scope reused the same intent identity")
	}
}
