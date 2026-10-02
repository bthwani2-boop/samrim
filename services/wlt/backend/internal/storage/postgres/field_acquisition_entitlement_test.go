package postgres

import (
	"context"
	"errors"
	"testing"
)

func TestFieldAcquisitionStorageRejectsInvalidInputsWithoutDatabaseAccess(t *testing.T) {
	ctx := context.Background()
	validPolicy := CreateFieldAcquisitionRewardPolicyInput{
		ScopeType: "STORE_TYPE", ScopeID: "type-1", RewardMinor: 100,
		RoundingUnitMinor: 50, CreatedBy: "operator-1", IdempotencyKey: "policy-key-1",
		CorrelationID: "policy-correlation-1", Reason: "valid policy reason",
	}
	validReward := FinalizeFieldAcquisitionRewardInput{
		JoiningCaseID: "case-1", StoreID: "store-1", PartnerActorID: "partner-1",
		FieldActorID: "field-1", VerticalID: "vertical-1", CommercialStoreTypeID: "type-1",
		IdempotencyKey: "reward-key-1", CorrelationID: "reward-correlation-1",
	}
	tests := []struct {
		name string
		err  error
	}{
		{name: "reward policy requires database and complete valid policy", err: func() error {
			_, _, err := CreateFieldAcquisitionRewardPolicy(ctx, nil, validPolicy)
			return err
		}()},
		{name: "policy lookup requires a canonical store type scope", err: func() error {
			_, err := ReadActiveFieldAcquisitionRewardPolicyByScope(ctx, nil, "PARTNER", "")
			return err
		}()},
		{name: "reward finalization requires a database and complete business identity", err: func() error {
			_, _, err := FinalizeFieldAcquisitionReward(ctx, nil, validReward)
			return err
		}()},
		{name: "entitlement read requires a store", err: func() error {
			_, err := ReadFieldAcquisitionEntitlement(ctx, nil, " ")
			return err
		}()},
		{name: "joining case entitlement read requires a case", err: func() error {
			_, err := ReadFieldAcquisitionEntitlementByJoiningCase(ctx, nil, " ")
			return err
		}()},
		{name: "field summary requires an actor", err: func() error {
			_, err := ReadFieldFinancialSummary(ctx, nil, " ")
			return err
		}()},
		{name: "entitlement pagination requires a matching cursor pair", err: func() error {
			_, err := ListFieldAcquisitionEntitlements(ctx, nil, "field-1", nil, "case-1", 20)
			return err
		}()},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if !errors.Is(tc.err, ErrFieldAcquisitionEntitlementInvalid) && !errors.Is(tc.err, ErrFieldAcquisitionRewardPolicyInvalidInput) {
				t.Fatalf("invalid input error = %v", tc.err)
			}
		})
	}
}

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
	if HashFinalizeFieldAcquisitionReward(otherCase) == baseHash {
		t.Fatal("a different partner acquisition shared the same idempotency hash")
	}

	otherField := base
	otherField.FieldActorID = "field-2"
	if HashFinalizeFieldAcquisitionReward(otherField) == baseHash {
		t.Fatal("a different field owner shared the same idempotency hash")
	}

	otherType := base
	otherType.CommercialStoreTypeID = "fish-shop"
	if HashFinalizeFieldAcquisitionReward(otherType) == baseHash {
		t.Fatal("a different commercial store type shared the same idempotency hash")
	}
}
