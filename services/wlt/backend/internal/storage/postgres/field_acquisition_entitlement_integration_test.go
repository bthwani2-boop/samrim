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

type fieldAcquisitionScenario struct {
	db             *sql.DB
	ctx            context.Context
	suffix         string
	scopeID        string
	policyID       string
	policyKey      string
	policyRetryKey string
	caseOne        string
	caseTwo        string
	storeOne       string
	storeTwo       string
	actorID        string
	caseOneKey     string
	caseTwoKey     string
	firstAward     FieldAcquisitionEntitlementRecord
	activePolicy   FieldAcquisitionRewardPolicyRecord
}

func TestFieldAcquisitionEntitlementPostgresLifecycle(t *testing.T) {
	scenario := newFieldAcquisitionScenario(t)
	scenario.registerCleanup(t)
	scenario.activePolicy = scenario.createAndReplacePolicy(t)
	scenario.firstAward = scenario.createAndReplayFirstAward(t)
	scenario.createSecondAward(t)
	scenario.verifyReadbacks(t)
	scenario.verifySummaryAndPagination(t)
}

func newFieldAcquisitionScenario(t *testing.T) *fieldAcquisitionScenario {
	t.Helper()
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
	db.SetMaxOpenConns(4)
	t.Cleanup(func() {
		if err := db.Close(); err != nil {
			t.Errorf("close WLT test database: %v", err)
		}
	})
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	t.Cleanup(cancel)
	if err := db.PingContext(ctx); err != nil {
		t.Fatalf("connect WLT test database: %v", err)
	}
	if err := migrateFieldAcquisitionTestSchema(ctx, db); err != nil {
		t.Fatalf("prepare canonical WLT test schema: %v", err)
	}
	return &fieldAcquisitionScenario{
		db: db, ctx: ctx,
		suffix: fmt.Sprintf("%d", time.Now().UTC().UnixNano()),
	}
}

func migrateFieldAcquisitionTestSchema(ctx context.Context, db *sql.DB) error {
	directory := filepath.Clean(filepath.Join("..", "..", "..", "..", "database", "migrations"))
	records, statements, err := LoadMigrations(directory)
	if err != nil {
		return fmt.Errorf("load WLT migrations: %w", err)
	}
	if err := Migrate(ctx, db, records, statements); err != nil {
		return fmt.Errorf("apply WLT migrations: %w", err)
	}
	if err := VerifySchema(ctx, db, records); err != nil {
		return fmt.Errorf("verify WLT migrations: %w", err)
	}
	return nil
}

func (s *fieldAcquisitionScenario) registerCleanup(t *testing.T) {
	t.Helper()
	s.scopeID = "field-acquisition-test-" + s.suffix
	s.policyKey = "field-policy-test-" + s.suffix
	s.policyRetryKey = "field-policy-retry-" + s.suffix
	s.caseOne = "field-case-one-" + s.suffix
	s.caseTwo = "field-case-two-" + s.suffix
	s.storeOne = "field-store-one-" + s.suffix
	s.storeTwo = "field-store-two-" + s.suffix
	s.actorID = "field-actor-" + s.suffix
	s.caseOneKey = "field-award-one-" + s.suffix
	s.caseTwoKey = "field-award-two-" + s.suffix
	t.Cleanup(func() {
		if s.policyID == "" {
			return
		}
		s.deleteTestEntitlements(t)
		s.deleteTestLedgerEntries(t)
		s.deleteTestLedgerTransactions(t)
		s.deleteTestPolicies(t)
	})
}

func (s *fieldAcquisitionScenario) deleteTestEntitlements(t *testing.T) {
	t.Helper()
	if _, err := s.db.ExecContext(context.Background(), `DELETE FROM wlt.field_acquisition_entitlements WHERE joining_case_id IN ($1,$2)`, s.caseOne, s.caseTwo); err != nil {
		t.Errorf("remove test entitlements: %v", err)
	}
}

func (s *fieldAcquisitionScenario) deleteTestLedgerEntries(t *testing.T) {
	t.Helper()
	if _, err := s.db.ExecContext(context.Background(), `DELETE FROM wlt.ledger_entries WHERE transaction_id IN (SELECT id FROM wlt.ledger_transactions WHERE source_id IN ($1,$2))`, s.caseOne, s.caseTwo); err != nil {
		t.Errorf("remove test ledger entries: %v", err)
	}
}

func (s *fieldAcquisitionScenario) deleteTestLedgerTransactions(t *testing.T) {
	t.Helper()
	if _, err := s.db.ExecContext(context.Background(), `DELETE FROM wlt.ledger_transactions WHERE source_id IN ($1,$2)`, s.caseOne, s.caseTwo); err != nil {
		t.Errorf("remove test ledger transactions: %v", err)
	}
}

func (s *fieldAcquisitionScenario) deleteTestPolicies(t *testing.T) {
	t.Helper()
	if _, err := s.db.ExecContext(context.Background(), `DELETE FROM wlt.field_acquisition_reward_policies WHERE scope_id=$1`, s.scopeID); err != nil {
		t.Errorf("remove test reward policy: %v", err)
	}
}

func (s *fieldAcquisitionScenario) createAndReplacePolicy(t *testing.T) FieldAcquisitionRewardPolicyRecord {
	t.Helper()
	if _, _, err := CreateFieldAcquisitionRewardPolicy(s.ctx, s.db, CreateFieldAcquisitionRewardPolicyInput{}); !errors.Is(err, ErrFieldAcquisitionRewardPolicyInvalidInput) {
		t.Fatalf("invalid policy input error = %v", err)
	}
	created := s.createInitialPolicy(t)
	updated := s.replacePolicy(t, created)
	s.verifyPolicyConflictCases(t, updated)
	s.verifyActivePolicy(t, updated)
	return updated
}

func (s *fieldAcquisitionScenario) createInitialPolicy(t *testing.T) FieldAcquisitionRewardPolicyRecord {
	t.Helper()
	input := CreateFieldAcquisitionRewardPolicyInput{
		ScopeType: " store_type ", ScopeID: " " + s.scopeID + " ", RewardMinor: 1250,
		RoundingUnitMinor: 50, CreatedBy: " field-operator ", IdempotencyKey: s.policyKey,
		CorrelationID: "field-correlation-" + s.suffix, ExpectedVersion: 0, Reason: "  initial   field reward policy  ",
	}
	created, replayed, err := CreateFieldAcquisitionRewardPolicy(s.ctx, s.db, input)
	if err != nil || replayed || created.Version != 1 || created.State != "ACTIVE" || created.ScopeID != s.scopeID {
		t.Fatalf("create field reward policy = %+v, replayed=%v, error=%v", created, replayed, err)
	}
	s.policyID = created.ID
	return created
}

func (s *fieldAcquisitionScenario) replacePolicy(t *testing.T, current FieldAcquisitionRewardPolicyRecord) FieldAcquisitionRewardPolicyRecord {
	t.Helper()
	input := CreateFieldAcquisitionRewardPolicyInput{
		ScopeType: "STORE_TYPE", ScopeID: s.scopeID, RewardMinor: 1250,
		RoundingUnitMinor: 50, CreatedBy: "field-operator", IdempotencyKey: s.policyRetryKey,
		CorrelationID: "field-correlation-update-" + s.suffix, ExpectedVersion: current.Version, Reason: "policy version two",
	}
	updated, replayed, err := CreateFieldAcquisitionRewardPolicy(s.ctx, s.db, input)
	if err != nil || replayed || updated.Version != 2 || updated.State != "ACTIVE" {
		t.Fatalf("replace field reward policy = %+v, replayed=%v, error=%v", updated, replayed, err)
	}
	s.policyID = updated.ID
	if _, _, err := CreateFieldAcquisitionRewardPolicy(s.ctx, s.db, input); err != nil {
		t.Fatalf("idempotent policy retry: %v", err)
	}
	return updated
}

func (s *fieldAcquisitionScenario) verifyPolicyConflictCases(t *testing.T, policy FieldAcquisitionRewardPolicyRecord) {
	t.Helper()
	changed := CreateFieldAcquisitionRewardPolicyInput{
		ScopeType: "STORE_TYPE", ScopeID: s.scopeID, RewardMinor: 1251,
		RoundingUnitMinor: 50, CreatedBy: "field-operator", IdempotencyKey: s.policyRetryKey,
		CorrelationID: "field-correlation-update-" + s.suffix, ExpectedVersion: policy.Version, Reason: "policy version two",
	}
	if _, _, err := CreateFieldAcquisitionRewardPolicy(s.ctx, s.db, changed); !errors.Is(err, ErrIdempotencyConflict) {
		t.Fatalf("changed policy request error = %v", err)
	}
	stale := changed
	stale.IdempotencyKey = "field-policy-stale-" + s.suffix
	stale.ExpectedVersion = 0
	if _, _, err := CreateFieldAcquisitionRewardPolicy(s.ctx, s.db, stale); !errors.Is(err, ErrVersionConflict) {
		t.Fatalf("stale policy version error = %v", err)
	}
	var retiredState string
	var retiredAt sql.NullTime
	if err := s.db.QueryRowContext(s.ctx, `SELECT state,retired_at FROM wlt.field_acquisition_reward_policies WHERE id<>$1 AND scope_id=$2`, policy.ID, s.scopeID).Scan(&retiredState, &retiredAt); err != nil || retiredState != "RETIRED" || !retiredAt.Valid {
		t.Fatalf("previous policy retirement readback state=%q retiredAt=%v error=%v", retiredState, retiredAt, err)
	}
}

func (s *fieldAcquisitionScenario) verifyActivePolicy(t *testing.T, policy FieldAcquisitionRewardPolicyRecord) {
	t.Helper()
	active, err := ReadActiveFieldAcquisitionRewardPolicyByScope(s.ctx, s.db, " store_type ", s.scopeID)
	if err != nil || active.ID != policy.ID || active.Version != 2 {
		t.Fatalf("active policy readback = %+v, error=%v", active, err)
	}
	if _, err := ReadActiveFieldAcquisitionRewardPolicyByScope(s.ctx, s.db, "STORE_TYPE", "missing-"+s.suffix); !errors.Is(err, ErrFieldAcquisitionRewardPolicyNotFound) {
		t.Fatalf("missing active policy error = %v", err)
	}
}

func (s *fieldAcquisitionScenario) awardInput(caseID, storeID, partnerID, key string) FinalizeFieldAcquisitionRewardInput {
	return FinalizeFieldAcquisitionRewardInput{
		JoiningCaseID: caseID, StoreID: storeID, PartnerActorID: partnerID,
		FieldActorID: s.actorID, VerticalID: "grocery", CommercialStoreTypeID: s.scopeID,
		IdempotencyKey: key, CorrelationID: "field-award-correlation-" + s.suffix,
	}
}

func (s *fieldAcquisitionScenario) verifyAwardRejections(t *testing.T, input FinalizeFieldAcquisitionRewardInput) {
	t.Helper()
	if _, _, err := FinalizeFieldAcquisitionReward(s.ctx, s.db, FinalizeFieldAcquisitionRewardInput{}); !errors.Is(err, ErrFieldAcquisitionEntitlementInvalid) {
		t.Fatalf("invalid award input error = %v", err)
	}
	withoutPolicy := input
	withoutPolicy.CommercialStoreTypeID = "unconfigured-" + s.suffix
	withoutPolicy.IdempotencyKey = "field-award-no-policy-" + s.suffix
	if _, _, err := FinalizeFieldAcquisitionReward(s.ctx, s.db, withoutPolicy); !errors.Is(err, ErrFieldAcquisitionRewardPolicyNotFound) {
		t.Fatalf("missing award policy error = %v", err)
	}
}

func (s *fieldAcquisitionScenario) createAndReplayFirstAward(t *testing.T) FieldAcquisitionEntitlementRecord {
	t.Helper()
	input := s.awardInput(s.caseOne, s.storeOne, "partner-one-"+s.suffix, s.caseOneKey)
	s.verifyAwardRejections(t, input)
	first, replayed, err := FinalizeFieldAcquisitionReward(s.ctx, s.db, input)
	if err != nil || replayed || first.RewardMinor != 1250 || first.PolicyVersion != 2 || first.Currency != "YER" {
		t.Fatalf("post field entitlement = %+v, replayed=%v, error=%v", first, replayed, err)
	}
	retry := input
	retry.StoreID = "different-store-on-same-acquisition"
	retried, replayed, err := FinalizeFieldAcquisitionReward(s.ctx, s.db, retry)
	if err != nil || !replayed || retried.StoreID != s.storeOne || retried.LedgerTransactionID != first.LedgerTransactionID {
		t.Fatalf("idempotent award readback = %+v, replayed=%v, error=%v", retried, replayed, err)
	}
	s.verifyAwardConflictCases(t, input)
	return first
}

func (s *fieldAcquisitionScenario) verifyAwardConflictCases(t *testing.T, input FinalizeFieldAcquisitionRewardInput) {
	t.Helper()
	changedActor := input
	changedActor.FieldActorID = "different-field-actor"
	if _, _, err := FinalizeFieldAcquisitionReward(s.ctx, s.db, changedActor); !errors.Is(err, ErrIdempotencyConflict) {
		t.Fatalf("changed award request error = %v", err)
	}
	sameCaseDifferentRequest := input
	sameCaseDifferentRequest.IdempotencyKey = "field-award-case-conflict-" + s.suffix
	sameCaseDifferentRequest.FieldActorID = "different-field-actor"
	if _, _, err := FinalizeFieldAcquisitionReward(s.ctx, s.db, sameCaseDifferentRequest); !errors.Is(err, ErrIdempotencyConflict) {
		t.Fatalf("same joining case with different request error = %v", err)
	}
}

func (s *fieldAcquisitionScenario) createSecondAward(t *testing.T) {
	t.Helper()
	input := s.awardInput(s.caseTwo, s.storeTwo, "partner-two-"+s.suffix, s.caseTwoKey)
	input.CorrelationID = "field-award-second-correlation-" + s.suffix
	created, replayed, err := FinalizeFieldAcquisitionReward(s.ctx, s.db, input)
	if err != nil || replayed || created.JoiningCaseID != s.caseTwo {
		t.Fatalf("second field entitlement = %+v, replayed=%v, error=%v", created, replayed, err)
	}
}

func (s *fieldAcquisitionScenario) verifyReadbacks(t *testing.T) {
	t.Helper()
	byStore, err := ReadFieldAcquisitionEntitlement(s.ctx, s.db, s.storeOne)
	if err != nil || byStore.JoiningCaseID != s.caseOne || byStore.PolicyID != s.activePolicy.ID {
		t.Fatalf("store entitlement readback = %+v, error=%v", byStore, err)
	}
	byCase, err := ReadFieldAcquisitionEntitlementByJoiningCase(s.ctx, s.db, s.caseOne)
	if err != nil || byCase.LedgerTransactionID != s.firstAward.LedgerTransactionID {
		t.Fatalf("joining case entitlement readback = %+v, error=%v", byCase, err)
	}
	if _, err := ReadFieldAcquisitionEntitlement(s.ctx, s.db, "missing-store-"+s.suffix); !errors.Is(err, ErrFieldAcquisitionEntitlementInvalid) {
		t.Fatalf("missing store entitlement error = %v", err)
	}
	if _, err := ReadFieldAcquisitionEntitlementByJoiningCase(s.ctx, s.db, "missing-case-"+s.suffix); !errors.Is(err, ErrFieldAcquisitionEntitlementInvalid) {
		t.Fatalf("missing joining case entitlement error = %v", err)
	}
}

func (s *fieldAcquisitionScenario) verifySummaryAndPagination(t *testing.T) {
	t.Helper()
	summary, err := ReadFieldFinancialSummary(s.ctx, s.db, s.actorID)
	if err != nil || summary.Currency != "YER" || summary.EarnedMinor != 2500 || summary.EntitlementMinor != 2500 || summary.PartnerCount != 2 || summary.LastEarningAt == nil {
		t.Fatalf("field financial summary = %+v, error=%v", summary, err)
	}
	empty, err := ReadFieldFinancialSummary(s.ctx, s.db, "empty-field-"+s.suffix)
	if err != nil || empty.EarnedMinor != 0 || empty.PartnerCount != 0 || empty.LastEarningAt != nil {
		t.Fatalf("empty field financial summary = %+v, error=%v", empty, err)
	}
	s.verifyEntitlementPagination(t)
}

func (s *fieldAcquisitionScenario) verifyEntitlementPagination(t *testing.T) {
	t.Helper()
	firstPage, err := ListFieldAcquisitionEntitlements(s.ctx, s.db, s.actorID, nil, "", 1)
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
	secondPage, err := ListFieldAcquisitionEntitlements(s.ctx, s.db, s.actorID, &before, cursorCase, 1)
	if err != nil || len(secondPage.Entitlements) != 1 || secondPage.NextCursor != "" || secondPage.Entitlements[0].JoiningCaseID == firstPage.Entitlements[0].JoiningCaseID {
		t.Fatalf("second entitlement page = %+v, error=%v", secondPage, err)
	}
	s.verifyInvalidCursors(t, before, cursorCase)
}

func (s *fieldAcquisitionScenario) verifyInvalidCursors(t *testing.T, before time.Time, cursorCase string) {
	t.Helper()
	if _, err := ListFieldAcquisitionEntitlements(s.ctx, s.db, s.actorID, &before, "", 1); !errors.Is(err, ErrFieldAcquisitionEntitlementInvalid) {
		t.Fatalf("incomplete pagination cursor error = %v", err)
	}
	if _, err := ListFieldAcquisitionEntitlements(s.ctx, s.db, s.actorID, nil, cursorCase, 1); !errors.Is(err, ErrFieldAcquisitionEntitlementInvalid) {
		t.Fatalf("unexpected pagination cursor error = %v", err)
	}
	if _, err := ListFieldAcquisitionEntitlements(s.ctx, s.db, s.actorID, nil, "", 101); !errors.Is(err, ErrFieldAcquisitionEntitlementInvalid) {
		t.Fatalf("oversized entitlement page error = %v", err)
	}
}
