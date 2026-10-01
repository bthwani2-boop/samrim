package postgres

import "testing"

func TestFieldAcquisitionEntitlementIdempotencyIsPerJoiningCase(t *testing.T) {
	base := FinalizeFieldAcquisitionRewardInput{
		JoiningCaseID:         "joining-case-1",
		StoreID:               "store-1",
		PartnerActorID:        "partner-1",
		FieldActorID:          "field-1",
		VerticalID:            "vertical-1",
		CommercialStoreTypeID: "butcher-shop",
	}
	baseHash := HashFinalizeFieldAcquisitionReward(base)

	otherStore := base
	otherStore.StoreID = "store-2"
	if got := HashFinalizeFieldAcquisitionReward(otherStore); got != baseHash {
		t.Fatalf("store retry changed acquisition idempotency hash: got %s, want %s", got, baseHash)
	}

	otherCase := base
	otherCase.JoiningCaseID = "joining-case-2"
	if got := HashFinalizeFieldAcquisitionReward(otherCase); got == baseHash {
		t.Fatal("a different partner acquisition shared the same idempotency hash")
	}

	otherField := base
	otherField.FieldActorID = "field-2"
	if got := HashFinalizeFieldAcquisitionReward(otherField); got == baseHash {
		t.Fatal("a different field owner shared the same idempotency hash")
	}

	otherType := base
	otherType.CommercialStoreTypeID = "fish-shop"
	if got := HashFinalizeFieldAcquisitionReward(otherType); got == baseHash {
		t.Fatal("a different commercial store type shared the same idempotency hash")
	}
}
