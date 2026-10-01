package postgres

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/bthwani2-boop/samrim/services/wlt/backend/internal/opsafety"
)

func TestFieldAcquisitionEntitlementPostgresLifecycle(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("WLT_TEST_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("WLT_TEST_DATABASE_URL is not configured")
	}
	if _, err := opsafety.RequireExpectedDatabaseTarget(databaseURL, os.Getenv); err != nil {
		t.Fatalf("refuse non-dedicated WLT test database: %v", err)
	}

	db, err := Open(databaseURL)
	if err != nil {
		t.Fatalf("open WLT test database: %v", err)
	}
	t.Cleanup(func() {
		if err := db.Close(); err != nil {
			t.Errorf("close WLT test database: %v", err)
		}
	})
	db.SetMaxOpenConns(4)
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	t.Cleanup(cancel)
	if err := db.PingContext(ctx); err != nil {
		t.Fatalf("connect WLT test database: %v", err)
	}

	migrationDir := filepath.Clean(filepath.Join("..", "..", "..", "..", "database", "migrations"))
	records, statements, err := LoadMigrations(migrationDir)
	if err != nil {
		t.Fatalf("load canonical WLT migrations: %v", err)
	}
	if err := Migrate(ctx, db, records, statements); err != nil {
		t.Fatalf("migrate dedicated WLT test database: %v", err)
	}
	if err := VerifySchema(ctx, db, records); err != nil {
		t.Fatalf("verify canonical WLT test schema: %v", err)
	}

	suffix := fmt.Sprintf("%d", time.Now().UTC().UnixNano())
	scopeID := "field-acquisition-test-" + suffix
	policyKey := "field-policy-test-" + suffix
	policyRetryKey := "field-policy-retry-" + suffix
	caseOne := "field-case-one-" + suffix
	caseTwo := "field-case-two-" + suffix
	storeOne := "field-store-one-" + suffix
	storeTwo := "field-store-two-" + suffix
	actorID := "field-actor-" + suffix
	caseOneKey := "field-award-one-" + suffix
	caseTwoKey := "field-award-two-" + suffix
	policyID := ""
	t.Cleanup(func() {
		if policyID == "" {
			return
		}
		if _, err := db.ExecContext(context.Background(), `DELETE FROM wlt.field_acquisition_entitlements WHERE joining_case_id IN ($1,$2)`, caseOne, caseTwo); err != nil {
			t.Errorf("remove test entitlements: %v", err)
			return
		}
		if _, err := db.ExecContext(context.Background(), `DELETE FROM wlt.ledger_entries WHERE transaction_id IN (SELECT id FROM wlt.ledger_transactions WHERE source_id IN ($1,$2))`, caseOne, caseTwo); err != nil {
			t.Errorf("remove test ledger entries: %v", err)
			return
		}
		if _, err := db.ExecContext(context.Background(), `DELETE FROM wlt.ledger_transactions WHERE source_id IN ($1,$2)`, caseOne, caseTwo); err != nil {
			t.Errorf("remove test ledger transactions: %v", err)
			return
		}
		if _, err := db.ExecContext(context.Background(), `DELETE FROM wlt.field_acquisition_reward_policies WHERE scope_id=$1`, scopeID); err != nil {
			t.Errorf("remove test reward policy: %v", err)
		}
	})

	policyInput := CreateFieldAcquisitionRewardPolicyInput{
		ScopeType: " store_type ", ScopeID: " " + scopeID + " ", RewardMinor: 1250,
		RoundingUnitMinor: 50, CreatedBy: " field-operator ", IdempotencyKey: policyKey,
		CorrelationID: "field-correlation-" + suffix, ExpectedVersion: 0, Reason: "  initial   field reward policy  ",
	}
	if _, _, err := CreateFieldAcquisitionRewardPolicy(ctx, db, CreateFieldAcquisitionRewardPolicyInput{}); !errors.Is(err, ErrFieldAcquisitionRewardPolicyInvalidInput) {
		t.Fatalf("invalid policy input error = %v", err)
	}
	policy, replayed, err := CreateFieldAcquisitionRewardPolicy(ctx, db, policyInput)
	if err != nil || replayed || policy.Version != 1 || policy.State != "ACTIVE" || policy.ScopeID != scopeID {
		t.Fatalf("create field reward policy = %+v, replayed=%v, error=%v", policy, replayed, err)
	}
	policyID = policy.ID
	policyRetry := policyInput
	policyRetry.IdempotencyKey = policyRetryKey
	policyRetry.ExpectedVersion = 1
	policyRetry.Reason = "policy version two"
	updatedPolicy, replayed, err := CreateFieldAcquisitionRewardPolicy(ctx, db, policyRetry)
	if err != nil || replayed || updatedPolicy.Version != 2 || updatedPolicy.State != "ACTIVE" {
		t.Fatalf("replace field reward policy = %+v, replayed=%v, error=%v", updatedPolicy, replayed, err)
	}
	policyID = updatedPolicy.ID
	if _, _, err := CreateFieldAcquisitionRewardPolicy(ctx, db, policyRetry); err != nil {
		t.Fatalf("idempotent policy retry: %v", err)
	}
	conflictingPolicy := policyRetry
	conflictingPolicy.RewardMinor++
	if _, _, err := CreateFieldAcquisitionRewardPolicy(ctx, db, conflictingPolicy); !errors.Is(err, ErrIdempotencyConflict) {
		t.Fatalf("changed policy request error = %v", err)
	}
	stalePolicy := policyRetry
	stalePolicy.IdempotencyKey = "field-policy-stale-" + suffix
	stalePolicy.ExpectedVersion = 0
	if _, _, err := CreateFieldAcquisitionRewardPolicy(ctx, db, stalePolicy); !errors.Is(err, ErrVersionConflict) {
		t.Fatalf("stale policy version error = %v", err)
	}
	activePolicy, err := ReadActiveFieldAcquisitionRewardPolicyByScope(ctx, db, " store_type ", scopeID)
	if err != nil || activePolicy.ID != updatedPolicy.ID || activePolicy.Version != 2 {
		t.Fatalf("active policy readback = %+v, error=%v", activePolicy, err)
	}
	if _, err := ReadActiveFieldAcquisitionRewardPolicyByScope(ctx, db, "STORE_TYPE", "missing-"+suffix); !errors.Is(err, ErrFieldAcquisitionRewardPolicyNotFound) {
		t.Fatalf("missing active policy error = %v", err)
	}
	var retiredState string
	var retiredAt sql.NullTime
	if err := db.QueryRowContext(ctx, `SELECT state,retired_at FROM wlt.field_acquisition_reward_policies WHERE id=$1`, policy.ID).Scan(&retiredState, &retiredAt); err != nil || retiredState != "RETIRED" || !retiredAt.Valid {
		t.Fatalf("previous policy retirement readback state=%q retiredAt=%v error=%v", retiredState, retiredAt, err)
	}

	award := FinalizeFieldAcquisitionRewardInput{
		JoiningCaseID: caseOne, StoreID: storeOne, PartnerActorID: "partner-one-" + suffix,
		FieldActorID: actorID, VerticalID: "grocery", CommercialStoreTypeID: scopeID,
		IdempotencyKey: caseOneKey, CorrelationID: "field-award-correlation-" + suffix,
	}
	if _, _, err := FinalizeFieldAcquisitionReward(ctx, db, FinalizeFieldAcquisitionRewardInput{}); !errors.Is(err, ErrFieldAcquisitionEntitlementInvalid) {
		t.Fatalf("invalid award input error = %v", err)
	}
	if _, _, err := FinalizeFieldAcquisitionReward(ctx, db, FinalizeFieldAcquisitionRewardInput{
		JoiningCaseID: caseOne, StoreID: storeOne, PartnerActorID: award.PartnerActorID,
		FieldActorID: actorID, VerticalID: "grocery", CommercialStoreTypeID: "unconfigured-" + suffix,
		IdempotencyKey: "field-award-no-policy-" + suffix, CorrelationID: award.CorrelationID,
	}); !errors.Is(err, ErrFieldAcquisitionRewardPolicyNotFound) {
		t.Fatalf("missing award policy error = %v", err)
	}
	firstAward, replayed, err := FinalizeFieldAcquisitionReward(ctx, db, award)
	if err != nil || replayed || firstAward.RewardMinor != 1250 || firstAward.PolicyVersion != 2 || firstAward.Currency != "YER" {
		t.Fatalf("post field entitlement = %+v, replayed=%v, error=%v", firstAward, replayed, err)
	}
	retryWithDifferentStore := award
	retryWithDifferentStore.StoreID = "different-store-on-same-acquisition"
	retriedAward, replayed, err := FinalizeFieldAcquisitionReward(ctx, db, retryWithDifferentStore)
	if err != nil || !replayed || retriedAward.StoreID != storeOne || retriedAward.LedgerTransactionID != firstAward.LedgerTransactionID {
		t.Fatalf("idempotent award readback = %+v, replayed=%v, error=%v", retriedAward, replayed, err)
	}
	conflictingAward := award
	conflictingAward.FieldActorID = "different-field-actor"
	if _, _, err := FinalizeFieldAcquisitionReward(ctx, db, conflictingAward); !errors.Is(err, ErrIdempotencyConflict) {
		t.Fatalf("changed award request error = %v", err)
	}
	conflictingCaseRetry := award
	conflictingCaseRetry.IdempotencyKey = "field-award-case-conflict-" + suffix
	conflictingCaseRetry.FieldActorID = "different-field-actor"
	if _, _, err := FinalizeFieldAcquisitionReward(ctx, db, conflictingCaseRetry); !errors.Is(err, ErrIdempotencyConflict) {
		t.Fatalf("same joining case with different request error = %v", err)
	}
	byStore, err := ReadFieldAcquisitionEntitlement(ctx, db, storeOne)
	if err != nil || byStore.JoiningCaseID != caseOne || byStore.PolicyID != updatedPolicy.ID {
		t.Fatalf("store entitlement readback = %+v, error=%v", byStore, err)
	}
	byCase, err := ReadFieldAcquisitionEntitlementByJoiningCase(ctx, db, caseOne)
	if err != nil || byCase.LedgerTransactionID != firstAward.LedgerTransactionID {
		t.Fatalf("joining case entitlement readback = %+v, error=%v", byCase, err)
	}
	if _, err := ReadFieldAcquisitionEntitlement(ctx, db, "missing-store-"+suffix); !errors.Is(err, ErrFieldAcquisitionEntitlementInvalid) {
		t.Fatalf("missing store entitlement error = %v", err)
	}
	if _, err := ReadFieldAcquisitionEntitlementByJoiningCase(ctx, db, "missing-case-"+suffix); !errors.Is(err, ErrFieldAcquisitionEntitlementInvalid) {
		t.Fatalf("missing joining case entitlement error = %v", err)
	}

	secondAward := award
	secondAward.JoiningCaseID = caseTwo
	secondAward.StoreID = storeTwo
	secondAward.PartnerActorID = "partner-two-" + suffix
	secondAward.IdempotencyKey = caseTwoKey
	secondAward.CorrelationID = "field-award-second-correlation-" + suffix
	secondRecord, replayed, err := FinalizeFieldAcquisitionReward(ctx, db, secondAward)
	if err != nil || replayed || secondRecord.JoiningCaseID != caseTwo {
		t.Fatalf("second field entitlement = %+v, replayed=%v, error=%v", secondRecord, replayed, err)
	}

	summary, err := ReadFieldFinancialSummary(ctx, db, actorID)
	if err != nil || summary.Currency != "YER" || summary.EarnedMinor != 2500 || summary.EntitlementMinor != 2500 || summary.PartnerCount != 2 || summary.LastEarningAt == nil {
		t.Fatalf("field financial summary = %+v, error=%v", summary, err)
	}
	emptySummary, err := ReadFieldFinancialSummary(ctx, db, "empty-field-"+suffix)
	if err != nil || emptySummary.EarnedMinor != 0 || emptySummary.PartnerCount != 0 || emptySummary.LastEarningAt != nil {
		t.Fatalf("empty field financial summary = %+v, error=%v", emptySummary, err)
	}

	firstPage, err := ListFieldAcquisitionEntitlements(ctx, db, actorID, nil, "", 1)
	if err != nil || len(firstPage.Entitlements) != 1 || firstPage.NextCursor == "" {
		t.Fatalf("first entitlement page = %+v, error=%v", firstPage, err)
	}
	cursorAt, cursorCase, ok := strings.Cut(firstPage.NextCursor, "|")
	if !ok {
		t.Fatalf("pagination cursor has no joining-case separator: %q", firstPage.NextCursor)
	}
	before, err := time.Parse(time.RFC3339Nano, cursorAt)
	if err != nil {
		t.Fatalf("parse entitlement pagination cursor: %v", err)
	}
	secondPage, err := ListFieldAcquisitionEntitlements(ctx, db, actorID, &before, cursorCase, 1)
	if err != nil || len(secondPage.Entitlements) != 1 || secondPage.NextCursor != "" || secondPage.Entitlements[0].JoiningCaseID == firstPage.Entitlements[0].JoiningCaseID {
		t.Fatalf("second entitlement page = %+v, error=%v", secondPage, err)
	}
	if _, err := ListFieldAcquisitionEntitlements(ctx, db, actorID, &before, "", 1); !errors.Is(err, ErrFieldAcquisitionEntitlementInvalid) {
		t.Fatalf("incomplete pagination cursor error = %v", err)
	}
	if _, err := ListFieldAcquisitionEntitlements(ctx, db, actorID, nil, cursorCase, 1); !errors.Is(err, ErrFieldAcquisitionEntitlementInvalid) {
		t.Fatalf("unexpected pagination cursor error = %v", err)
	}
	if _, err := ListFieldAcquisitionEntitlements(ctx, db, actorID, nil, "", 101); !errors.Is(err, ErrFieldAcquisitionEntitlementInvalid) {
		t.Fatalf("oversized entitlement page error = %v", err)
	}
}
