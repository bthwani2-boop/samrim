package postgres

import (
	"errors"
	"strings"
	"testing"
)

func TestLegacyRequestedCustomerWithdrawalReverifiesAndCapturesCurrentIdentity(t *testing.T) {
	scenario := newFieldAcquisitionScenario(t)
	actorID := "legacy-withdrawal-customer-" + scenario.suffix
	facts := validIdentityFactsFixture()
	facts.ActorType = "customer"
	facts.ActorID = actorID
	cipher, err := NewDestinationCipher("MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=")
	if err != nil {
		t.Fatalf("create destination cipher: %v", err)
	}
	evidenceID := "legacy-withdrawal-evidence-" + scenario.suffix
	evidenceKey := "legacy-withdrawal-evidence-key-" + scenario.suffix
	if _, err := scenario.db.ExecContext(scenario.ctx, `INSERT INTO wlt.finance_evidence_documents(
		id,purpose,original_filename,content_type,content_sha256,content_ciphertext,content_size_bytes,uploaded_by,idempotency_key,request_hash,correlation_id
	) VALUES($1,'CUSTOMER_WITHDRAWAL_REQUEST','request.png','image/png',$2,$3,32,$4,$5,$6,$7)`,
		evidenceID, strings.Repeat("a", 64), []byte(strings.Repeat("c", 32)), "finance-operator", evidenceKey, "evidence-request-hash", "legacy-withdrawal-evidence-correlation-"+scenario.suffix); err != nil {
		t.Fatalf("create isolated customer withdrawal evidence fixture: %v", err)
	}
	intake, _, err := CreateCustomerWithdrawalIntake(scenario.ctx, scenario.db, cipher, CustomerWithdrawalIntakeInput{
		CustomerActorID: actorID, ProviderKey: "YEMEN_MOBILE_WALLET", IdentityFacts: facts,
		RequestReason: "legacy request identity cutover proof", RequestEvidenceDocumentID: evidenceID, RequestedBy: "finance-operator",
		IdempotencyKey: "legacy-withdrawal-intake-" + scenario.suffix, CorrelationID: "legacy-withdrawal-intake-correlation-" + scenario.suffix,
	})
	if err != nil || intake.Status != "REQUESTED" {
		t.Fatalf("create canonical customer withdrawal intake: %+v err=%v", intake, err)
	}
	destinationID := ""
	t.Cleanup(func() {
		if intake.ID != "" {
			_, _ = scenario.db.ExecContext(scenario.ctx, `UPDATE wlt.customer_manual_withdrawal_intakes
				SET status='REQUESTED',destination_id=NULL,finance_actor_id=NULL,resolved_at=NULL,resolution_reason=NULL WHERE id=$1`, intake.ID)
			_, _ = scenario.db.ExecContext(scenario.ctx, "DELETE FROM wlt.customer_manual_withdrawal_events WHERE intake_id=$1", intake.ID)
		}
		if destinationID != "" {
			_, _ = scenario.db.ExecContext(scenario.ctx, "DELETE FROM wlt.official_wallet_destination_transitions WHERE destination_id=$1", destinationID)
			_, _ = scenario.db.ExecContext(scenario.ctx, "DELETE FROM wlt.official_wallet_destinations WHERE id=$1", destinationID)
		}
		if intake.ID != "" {
			_, _ = scenario.db.ExecContext(scenario.ctx, "DELETE FROM wlt.customer_manual_withdrawal_intakes WHERE id=$1", intake.ID)
		}
		_, _ = scenario.db.ExecContext(scenario.ctx, "DELETE FROM wlt.finance_evidence_documents WHERE id=$1", evidenceID)
	})
	if _, err := scenario.db.ExecContext(scenario.ctx, `UPDATE wlt.customer_manual_withdrawal_intakes
		SET identity_actor_version=NULL,identity_role_version=NULL,role_enabled=NULL,security_enabled=NULL,official_name_status=NULL
		WHERE id=$1 AND status='REQUESTED'`, intake.ID); err != nil {
		t.Fatalf("model a preserved pre-migration REQUESTED intake without identity snapshots: %v", err)
	}
	changedFacts := facts
	changedFacts.PhoneE164 = "+967777000009"
	changedFacts.ActorVersion++
	if _, err := PrepareCustomerWithdrawalDestination(scenario.ctx, scenario.db, cipher, intake.ID, "finance-reviewer",
		"reject changed current customer identity", changedFacts,
		"legacy-withdrawal-rejected-"+scenario.suffix, "legacy-withdrawal-rejected-correlation-"+scenario.suffix); !errors.Is(err, ErrReverificationRequired) {
		t.Fatalf("destination preparation with changed current identity error=%v; want reverification required", err)
	}
	var unchangedLegacyRequest bool
	if err := scenario.db.QueryRowContext(scenario.ctx, `SELECT status='REQUESTED' AND identity_actor_version IS NULL
		AND identity_role_version IS NULL AND role_enabled IS NULL AND security_enabled IS NULL AND official_name_status IS NULL
		FROM wlt.customer_manual_withdrawal_intakes WHERE id=$1`, intake.ID).Scan(&unchangedLegacyRequest); err != nil || !unchangedLegacyRequest {
		t.Fatalf("changed identity altered the preserved legacy request: unchanged=%v err=%v", unchangedLegacyRequest, err)
	}
	destination, err := PrepareCustomerWithdrawalDestination(scenario.ctx, scenario.db, cipher, intake.ID, "finance-reviewer",
		"reverify preserved request against current verified customer Identity facts", facts,
		"legacy-withdrawal-destination-"+scenario.suffix, "legacy-withdrawal-destination-correlation-"+scenario.suffix)
	if err != nil || destination.ID == "" || destination.ActorID != actorID {
		t.Fatalf("prepare destination from reverified legacy request: %+v err=%v", destination, err)
	}
	destinationID = destination.ID
	var actorVersion, roleVersion int
	var roleEnabled, securityEnabled bool
	var nameStatus string
	if err := scenario.db.QueryRowContext(scenario.ctx, `SELECT identity_actor_version,identity_role_version,role_enabled,security_enabled,official_name_status
		FROM wlt.customer_manual_withdrawal_intakes WHERE id=$1`, intake.ID).Scan(&actorVersion, &roleVersion, &roleEnabled, &securityEnabled, &nameStatus); err != nil {
		t.Fatalf("read back captured legacy request identity facts: %v", err)
	}
	if actorVersion != facts.ActorVersion || roleVersion != facts.RoleVersion || !roleEnabled || !securityEnabled || nameStatus != "VERIFIED" {
		t.Fatalf("captured current identity snapshot = actor %d role %d enabled %v/%v name %q; want %+v", actorVersion, roleVersion, roleEnabled, securityEnabled, nameStatus, facts)
	}
}

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
