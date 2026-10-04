package postgres

import (
	"errors"
	"testing"
)

func TestOfficialWalletDestinationIsSuspendedWhenCurrentIdentityChanges(t *testing.T) {
	scenario := newFieldAcquisitionScenario(t)
	facts := validIdentityFactsFixture()
	facts.ActorID = "identity-stale-test-" + scenario.suffix
	actorID := facts.ActorID
	cipher, err := NewDestinationCipher("MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=")
	if err != nil {
		t.Fatalf("create destination cipher: %v", err)
	}
	destination, replayed, err := CreateOfficialWalletDestination(scenario.ctx, scenario.db, cipher, CreateOfficialWalletDestinationInput{
		ActorType: "partner", ActorID: actorID, ProviderKey: "YEMEN_MOBILE_WALLET", IdentityFacts: facts,
		ChangeReason: "initial official destination", VerificationEvidenceReference: "identity-stale-verification-" + scenario.suffix,
		ChangeEvidenceReference: "identity-stale-change-" + scenario.suffix, SubmittedBy: "partner-operator",
		IdempotencyKey: "identity-stale-create-" + scenario.suffix, CorrelationID: "identity-stale-create-correlation-" + scenario.suffix,
	})
	if err != nil || replayed || destination.Status != "CANDIDATE" || destination.Version != 1 {
		t.Fatalf("create official destination = %+v, replayed=%v, error=%v", destination, replayed, err)
	}
	t.Cleanup(func() {
		if _, err := scenario.db.ExecContext(scenario.ctx, "DELETE FROM wlt.official_wallet_destination_transitions WHERE destination_id=$1", destination.ID); err != nil {
			t.Errorf("delete stale destination transitions: %v", err)
		}
		if _, err := scenario.db.ExecContext(scenario.ctx, "DELETE FROM wlt.official_wallet_destinations WHERE id=$1", destination.ID); err != nil {
			t.Errorf("delete stale test destination: %v", err)
		}
	})
	verified, err := VerifyOfficialWalletDestination(scenario.ctx, scenario.db, cipher, destination.ID, "finance-verifier", "verified-evidence-"+scenario.suffix,
		facts, "identity-stale-verify-"+scenario.suffix, "identity-stale-verify-correlation-"+scenario.suffix)
	if err != nil || verified.Status != "PENDING_APPROVAL" || verified.VerificationStatus != "VERIFIED" {
		t.Fatalf("verify destination = %+v, error=%v", verified, err)
	}
	active, err := ActivateOfficialWalletDestination(scenario.ctx, scenario.db, cipher, destination.ID, "finance-approver", facts,
		"identity-stale-activate-"+scenario.suffix, "identity-stale-activate-correlation-"+scenario.suffix)
	if err != nil || active.Status != "ACTIVE_FOR_PAYOUT" || active.Version != 1 {
		t.Fatalf("activate destination = %+v, error=%v", active, err)
	}
	changedFacts := facts
	changedFacts.PhoneE164 = "+967777000002"
	changedFacts.ActorVersion++
	if _, _, err := CreatePayoutIntent(scenario.ctx, scenario.db, cipher, PayoutIntentInput{
		ActorType: "partner", ActorID: actorID, AmountMode: "FULL_AVAILABLE", IdentityFacts: changedFacts,
		IdempotencyKey: "identity-stale-payout-" + scenario.suffix, CorrelationID: "identity-stale-payout-correlation-" + scenario.suffix,
	}); !errors.Is(err, ErrReverificationRequired) {
		t.Fatalf("payout with changed official wallet identity error = %v, want reverification required", err)
	}
	stored, err := ReadOfficialWalletDestinationByID(scenario.ctx, scenario.db, destination.ID)
	if err != nil || stored.Status != "SUSPENDED" || stored.VerificationStatus != "STALE" || stored.Version != active.Version+1 {
		t.Fatalf("stale official wallet destination = %+v, error=%v", stored, err)
	}
	var staleTransitions int
	if err := scenario.db.QueryRowContext(scenario.ctx, "SELECT count(*) FROM wlt.official_wallet_destination_transitions WHERE destination_id=$1 AND operation='IDENTITY_STALE'", destination.ID).Scan(&staleTransitions); err != nil {
		t.Fatalf("read identity stale transition count: %v", err)
	}
	if staleTransitions != 1 {
		t.Fatalf("identity stale transition count = %d, want exactly one", staleTransitions)
	}
}
