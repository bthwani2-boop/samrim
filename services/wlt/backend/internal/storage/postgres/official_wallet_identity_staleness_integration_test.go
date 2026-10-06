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
	facts.ActorType = "field"
	facts.ActorID = "identity-stale-test-" + scenario.suffix
	actorID := facts.ActorID
	cipher, err := NewDestinationCipher("MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=")
	if err != nil {
		t.Fatalf("create destination cipher: %v", err)
	}
	destination, replayed, err := CreateOfficialWalletDestination(scenario.ctx, scenario.db, cipher, CreateOfficialWalletDestinationInput{
		ActorType: "field", ActorID: actorID, ProviderKey: "YEMEN_MOBILE_WALLET", IdentityFacts: facts,
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
		ActorType: "field", ActorID: actorID, AmountMode: "FULL_AVAILABLE", IdentityFacts: changedFacts,
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

func TestLegacyPayoutSnapshotsResumeOnlyAfterSameDestinationReverification(t *testing.T) {
	scenario := newFieldAcquisitionScenario(t)
	scenario.registerCleanup(t)
	scenario.activePolicy = scenario.createAndReplacePolicy(t)
	scenario.firstAward = scenario.createAndReplayFirstAward(t)

	facts := validIdentityFactsFixture()
	facts.ActorType = "field"
	facts.ActorID = scenario.actorID
	cipher, err := NewDestinationCipher("MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=")
	if err != nil {
		t.Fatalf("create destination cipher: %v", err)
	}
	destination, _, err := CreateOfficialWalletDestination(scenario.ctx, scenario.db, cipher, CreateOfficialWalletDestinationInput{
		ActorType: "field", ActorID: scenario.actorID, ProviderKey: "YEMEN_MOBILE_WALLET", IdentityFacts: facts,
		ChangeReason: "legacy payout cutover fixture", VerificationEvidenceReference: "legacy-payout-cutover-verification-" + scenario.suffix,
		ChangeEvidenceReference: "legacy-payout-cutover-change-" + scenario.suffix, SubmittedBy: "finance-wallet-submitter",
		IdempotencyKey: "legacy-payout-cutover-destination-" + scenario.suffix, CorrelationID: "legacy-payout-cutover-destination-correlation-" + scenario.suffix,
	})
	if err != nil {
		t.Fatalf("create payout destination: %v", err)
	}
	firstVerified, err := VerifyOfficialWalletDestination(scenario.ctx, scenario.db, cipher, destination.ID, "finance-wallet-verifier",
		"legacy payout cutover initial verification", facts, "legacy-payout-cutover-verify-"+scenario.suffix, "legacy-payout-cutover-verify-correlation-"+scenario.suffix)
	if err != nil || firstVerified.Status != "PENDING_APPROVAL" {
		t.Fatalf("verify payout destination: %+v err=%v", firstVerified, err)
	}
	active, err := ActivateOfficialWalletDestination(scenario.ctx, scenario.db, cipher, destination.ID, "finance-wallet-approver", facts,
		"legacy-payout-cutover-activate-"+scenario.suffix, "legacy-payout-cutover-activate-correlation-"+scenario.suffix)
	if err != nil || active.Status != "ACTIVE_FOR_PAYOUT" {
		t.Fatalf("activate payout destination: %+v err=%v", active, err)
	}

	cleanupPayoutIDs := make([]string, 0, 2)
	batchID := ""
	t.Cleanup(func() {
		for _, payoutID := range cleanupPayoutIDs {
			if _, err := scenario.db.ExecContext(scenario.ctx, "DELETE FROM wlt.payout_audit_events WHERE payout_id=$1", payoutID); err != nil {
				t.Errorf("remove payout audit events %s: %v", payoutID, err)
			}
		}
		if batchID != "" {
			if _, err := scenario.db.ExecContext(scenario.ctx, "DELETE FROM wlt.payout_audit_events WHERE batch_id=$1", batchID); err != nil {
				t.Errorf("remove settlement batch audit events %s: %v", batchID, err)
			}
			if _, err := scenario.db.ExecContext(scenario.ctx, "DELETE FROM wlt.settlement_batch_items WHERE batch_id=$1", batchID); err != nil {
				t.Errorf("remove settlement batch items %s: %v", batchID, err)
			}
			if _, err := scenario.db.ExecContext(scenario.ctx, "DELETE FROM wlt.settlement_batches WHERE id=$1", batchID); err != nil {
				t.Errorf("remove settlement batch %s: %v", batchID, err)
			}
		}
		for _, payoutID := range cleanupPayoutIDs {
			for _, query := range []string{
				"DELETE FROM wlt.approved_payout_snapshots WHERE payout_id=$1",
				"DELETE FROM wlt.payout_holds WHERE payout_id=$1",
				"DELETE FROM wlt.payout_requests WHERE id=$1",
			} {
				if _, err := scenario.db.ExecContext(scenario.ctx, query, payoutID); err != nil {
					t.Errorf("remove payout fixture %s: %v", payoutID, err)
				}
			}
		}
		if _, err := scenario.db.ExecContext(scenario.ctx, "DELETE FROM wlt.official_wallet_destination_transitions WHERE destination_id=$1", destination.ID); err != nil {
			t.Errorf("remove destination transitions %s: %v", destination.ID, err)
		}
		if _, err := scenario.db.ExecContext(scenario.ctx, "DELETE FROM wlt.official_wallet_destinations WHERE id=$1", destination.ID); err != nil {
			t.Errorf("remove payout destination %s: %v", destination.ID, err)
		}
	})

	oneMinor := int64(1)
	createIntent := func(key string) PayoutRequestRecord {
		created, replayed, err := CreatePayoutIntent(scenario.ctx, scenario.db, cipher, PayoutIntentInput{
			ActorType: "field", ActorID: scenario.actorID, AmountMode: "SPECIFIED", AmountMinor: &oneMinor, IdentityFacts: facts,
			IdempotencyKey: key + "-" + scenario.suffix, CorrelationID: key + "-correlation-" + scenario.suffix,
		})
		if err != nil || replayed || created.Status != "HELD" {
			t.Fatalf("create payout intent %s: %+v replayed=%t err=%v", key, created, replayed, err)
		}
		cleanupPayoutIDs = append(cleanupPayoutIDs, created.ID)
		return created
	}
	prepare := func(payout PayoutRequestRecord, key string) PayoutRequestRecord {
		prepared, err := PreparePayout(scenario.ctx, scenario.db, cipher, PreparePayoutInput{
			PayoutID: payout.ID, ActorID: "finance-payout-preparer", Reason: "prepare cutover payout", Evidence: "cutover payout preparation evidence",
			IdentityFacts: facts, IdempotencyKey: key + "-" + scenario.suffix, CorrelationID: key + "-correlation-" + scenario.suffix,
		})
		if err != nil || prepared.Status != "PREPARED" {
			t.Fatalf("prepare payout %s: %+v err=%v", payout.ID, prepared, err)
		}
		return prepared
	}
	approve := func(payout PayoutRequestRecord, key string) PayoutRequestRecord {
		approved, err := ApprovePayout(scenario.ctx, scenario.db, cipher, ApprovePayoutInput{
			PayoutID: payout.ID, ActorID: "finance-payout-approver", Reason: "approve cutover payout", IdentityFacts: facts,
			IdempotencyKey: key + "-" + scenario.suffix, CorrelationID: key + "-correlation-" + scenario.suffix,
		})
		if err != nil || approved.Status != "APPROVED" {
			t.Fatalf("approve payout %s: %+v err=%v", payout.ID, approved, err)
		}
		return approved
	}

	first := prepare(createIntent("legacy-payout-one"), "legacy-payout-one-prepare")
	first = approve(first, "legacy-payout-one-approve")
	second := prepare(createIntent("legacy-payout-two"), "legacy-payout-two-prepare")

	batch, err := CreateSettlementBatch(scenario.ctx, scenario.db, CreateSettlementBatchInput{
		PayoutIDs: []string{first.ID}, ActorID: "finance-batch-preparer", IdentityFactsByBeneficiary: []IdentityFacts{facts}, DestinationCipher: cipher,
		IdempotencyKey: "legacy-payout-batch-create-" + scenario.suffix, CorrelationID: "legacy-payout-batch-create-correlation-" + scenario.suffix,
	})
	if err != nil || batch.Status != "PREPARED" {
		t.Fatalf("create settlement batch before identity cutover: %+v err=%v", batch, err)
	}
	batchID = batch.ID
	batch, err = ApproveSettlementBatch(scenario.ctx, scenario.db, BatchActionInput{
		BatchID: batch.ID, ActorID: "finance-batch-approver", Reason: "approve cutover batch", IdentityFactsByBeneficiary: []IdentityFacts{facts}, DestinationCipher: cipher,
		IdempotencyKey: "legacy-payout-batch-approve-" + scenario.suffix, CorrelationID: "legacy-payout-batch-approve-correlation-" + scenario.suffix,
	})
	if err != nil || batch.Status != "APPROVED" {
		t.Fatalf("approve settlement batch before identity cutover: %+v err=%v", batch, err)
	}
	var originalSnapshotHash string
	if err := scenario.db.QueryRowContext(scenario.ctx, "SELECT snapshot_hash FROM wlt.approved_payout_snapshots WHERE payout_id=$1", first.ID).Scan(&originalSnapshotHash); err != nil {
		t.Fatalf("read immutable payout snapshot hash: %v", err)
	}

	if _, err := scenario.db.ExecContext(scenario.ctx, `UPDATE wlt.official_wallet_destinations
		SET status='SUSPENDED',verification_status='STALE',identity_actor_version=NULL,identity_role_version=NULL,role_enabled=NULL,security_enabled=NULL,official_name_status=NULL
		WHERE id=$1`, destination.ID); err != nil {
		t.Fatalf("model migration 039 legacy destination: %v", err)
	}
	for _, payoutID := range cleanupPayoutIDs {
		if _, err := scenario.db.ExecContext(scenario.ctx, `UPDATE wlt.approved_payout_snapshots
			SET identity_actor_version_snapshot=NULL,identity_role_version_snapshot=NULL,role_enabled_snapshot=NULL,security_enabled_snapshot=NULL,official_name_status_snapshot=NULL
			WHERE payout_id=$1`, payoutID); err != nil {
			t.Fatalf("model migration 039 legacy payout snapshot %s: %v", payoutID, err)
		}
	}
	if _, err := ApprovePayout(scenario.ctx, scenario.db, cipher, ApprovePayoutInput{
		PayoutID: second.ID, ActorID: "finance-payout-approver", Reason: "approve cutover payout", IdentityFacts: facts,
		IdempotencyKey: "legacy-payout-two-blocked-" + scenario.suffix, CorrelationID: "legacy-payout-two-blocked-correlation-" + scenario.suffix,
	}); !errors.Is(err, ErrReverificationRequired) {
		t.Fatalf("legacy prepared payout approval before same-destination reverification error=%v, want reverification required", err)
	}
	if _, err := FreezeSettlementBatch(scenario.ctx, scenario.db, BatchActionInput{
		BatchID: batch.ID, ActorID: "finance-batch-freezer", Reason: "freeze cutover batch", IdentityFactsByBeneficiary: []IdentityFacts{facts}, DestinationCipher: cipher,
		IdempotencyKey: "legacy-payout-batch-blocked-" + scenario.suffix, CorrelationID: "legacy-payout-batch-blocked-correlation-" + scenario.suffix,
	}); !errors.Is(err, ErrReverificationRequired) {
		t.Fatalf("legacy approved batch freeze before same-destination reverification error=%v, want reverification required", err)
	}

	changedFacts := facts
	changedFacts.PhoneE164 = "+967777000008"
	changedFacts.ActorVersion++
	if _, err := VerifyOfficialWalletDestination(scenario.ctx, scenario.db, cipher, destination.ID, "finance-wallet-reverifier",
		"reject changed identity for preserved payout", changedFacts, "legacy-payout-reverify-mismatch-"+scenario.suffix, "legacy-payout-reverify-mismatch-correlation-"+scenario.suffix); !errors.Is(err, ErrReverificationRequired) {
		t.Fatalf("legacy destination verification with changed identity error=%v, want reverification required", err)
	}
	reverified, err := VerifyOfficialWalletDestination(scenario.ctx, scenario.db, cipher, destination.ID, "finance-wallet-reverifier",
		"reverify unchanged identity for preserved payout", facts, "legacy-payout-reverify-"+scenario.suffix, "legacy-payout-reverify-correlation-"+scenario.suffix)
	if err != nil || reverified.Status != "PENDING_APPROVAL" || reverified.Version != active.Version {
		t.Fatalf("reverify unchanged legacy destination: %+v err=%v", reverified, err)
	}
	reactivated, err := ActivateOfficialWalletDestination(scenario.ctx, scenario.db, cipher, destination.ID, "finance-wallet-reapprover", facts,
		"legacy-payout-reactivate-"+scenario.suffix, "legacy-payout-reactivate-correlation-"+scenario.suffix)
	if err != nil || reactivated.Status != "ACTIVE_FOR_PAYOUT" || reactivated.Version != active.Version {
		t.Fatalf("reactivate same legacy destination without changing its identity: %+v err=%v", reactivated, err)
	}
	second = approve(second, "legacy-payout-two-approve")
	batch, err = FreezeSettlementBatch(scenario.ctx, scenario.db, BatchActionInput{
		BatchID: batch.ID, ActorID: "finance-batch-freezer", Reason: "freeze cutover batch", IdentityFactsByBeneficiary: []IdentityFacts{facts}, DestinationCipher: cipher,
		IdempotencyKey: "legacy-payout-batch-freeze-" + scenario.suffix, CorrelationID: "legacy-payout-batch-freeze-correlation-" + scenario.suffix,
	})
	if err != nil || batch.Status != "FROZEN" {
		t.Fatalf("freeze existing approved batch after same-destination reverification: %+v err=%v", batch, err)
	}
	var finalSnapshotHash string
	if err := scenario.db.QueryRowContext(scenario.ctx, "SELECT snapshot_hash FROM wlt.approved_payout_snapshots WHERE payout_id=$1", first.ID).Scan(&finalSnapshotHash); err != nil || finalSnapshotHash != originalSnapshotHash {
		t.Fatalf("legacy payout snapshot changed during reverification: hash=%q original=%q err=%v", finalSnapshotHash, originalSnapshotHash, err)
	}
	if first.DestinationID != destination.ID || second.DestinationID != destination.ID || first.DestinationVersion != active.Version || second.DestinationVersion != active.Version {
		t.Fatalf("legacy payout intents no longer reference their original destination: first=%+v second=%+v destination=%+v", first, second, active)
	}
}
