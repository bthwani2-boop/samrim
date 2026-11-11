package postgres

import (
	"errors"
	"sync"
	"testing"

	"github.com/lib/pq"
)

func TestStoreRelationCommercialModelDefaultValidation(t *testing.T) {
	cases := []struct {
		relation string
		model    string
		valid    bool
	}{
		{"BTHWANI_PARTNER", "COMMISSION", true},
		{"BTHWANI_PARTNER", "SUBSCRIPTION", true},
		{"INDEPENDENT_STORE", "COMMISSION", true},
		{"INDEPENDENT_STORE", "SUBSCRIPTION", true},
		{"INDEPENDENT_STORE", "HYBRID", false},
		{"UNKNOWN", "COMMISSION", false},
		{"BTHWANI_PARTNER", "", false},
	}
	for _, test := range cases {
		if got := validStoreRelationCommercialModel(test.relation, test.model); got != test.valid {
			t.Errorf("relation=%s model=%s valid=%t want %t", test.relation, test.model, got, test.valid)
		}
	}
	base := StoreRelationCommercialModelDefaultUpdate{
		RelationModel: "INDEPENDENT_STORE", CommercialModel: "SUBSCRIPTION",
		ExpectedVersion: 0, ActingActorID: "policy-operator", Reason: "Approved prospective model selection",
		IdempotencyKey: "policy-idempotency-0001", CorrelationID: "policy-correlation-0001",
	}
	if !validStoreRelationCommercialModelUpdate(base) {
		t.Fatal("valid WLT policy update was rejected")
	}
	for _, invalid := range []StoreRelationCommercialModelDefaultUpdate{
		func() StoreRelationCommercialModelDefaultUpdate { v := base; v.CommercialModel = "HYBRID"; return v }(),
		func() StoreRelationCommercialModelDefaultUpdate { v := base; v.ExpectedVersion = -1; return v }(),
		func() StoreRelationCommercialModelDefaultUpdate { v := base; v.Reason = "short"; return v }(),
		func() StoreRelationCommercialModelDefaultUpdate { v := base; v.IdempotencyKey = ""; return v }(),
		func() StoreRelationCommercialModelDefaultUpdate { v := base; v.ActingActorID = ""; return v }(),
	} {
		if validStoreRelationCommercialModelUpdate(invalid) {
			t.Fatalf("invalid commercial model default accepted: %+v", invalid)
		}
	}
	if _, _, err := UpdateStoreRelationCommercialModelDefault(t.Context(), nil, base); !errors.Is(err, ErrStoreRelationCommercialDefaultInvalid) {
		t.Fatalf("nil WLT owner database must fail closed, got %v", err)
	}
}

func TestStoreRelationCommercialModelDefaultPersistedIsolation(t *testing.T) {
	s := newFieldAcquisitionScenario(t) // Requires verified isolated WLT_TEST_DATABASE_URL.
	var agreementsBefore int
	if err := s.db.QueryRowContext(s.ctx, "SELECT COUNT(*) FROM wlt.store_commercial_agreements").Scan(&agreementsBefore); err != nil {
		t.Fatalf("baseline WLT Store agreement count unavailable: %v", err)
	}
	all, err := ReadStoreRelationCommercialModelDefaults(s.ctx, s.db)
	if err != nil || len(all) != 0 {
		t.Fatalf("unconfigured relation defaults must not be invented: count=%d error=%v", len(all), err)
	}
	operator := "model-operator-" + s.suffix
	independent := StoreRelationCommercialModelDefaultUpdate{
		RelationModel: "INDEPENDENT_STORE", CommercialModel: "SUBSCRIPTION", ExpectedVersion: 0,
		ActingActorID: operator, Reason: "Explicit independent Store subscription suggestion",
		IdempotencyKey: "independent-model-" + s.suffix, CorrelationID: "independent-correlation-" + s.suffix,
	}
	partner := StoreRelationCommercialModelDefaultUpdate{
		RelationModel: "BTHWANI_PARTNER", CommercialModel: "COMMISSION", ExpectedVersion: 0,
		ActingActorID: operator, Reason: "Explicit marketplace Partner commission suggestion",
		IdempotencyKey: "partner-model-" + s.suffix, CorrelationID: "partner-correlation-" + s.suffix,
	}
	first, replayed, err := UpdateStoreRelationCommercialModelDefault(s.ctx, s.db, independent)
	if err != nil || replayed || first.PolicyVersion != 1 || first.CommercialModel != "SUBSCRIPTION" {
		t.Fatalf("create independent policy: %+v replayed=%t err=%v", first, replayed, err)
	}
	second, replayed, err := UpdateStoreRelationCommercialModelDefault(s.ctx, s.db, partner)
	if err != nil || replayed || second.PolicyVersion != 1 || second.CommercialModel != "COMMISSION" {
		t.Fatalf("create Partner policy: %+v replayed=%t err=%v", second, replayed, err)
	}
	all, err = ReadStoreRelationCommercialModelDefaults(s.ctx, s.db)
	if err != nil || len(all) != 2 || all[0].RelationModel == all[1].RelationModel {
		t.Fatalf("WLT relation models not isolated: %+v err=%v", all, err)
	}
	if _, _, err := UpdateStoreRelationCommercialModelDefault(s.ctx, s.db, StoreRelationCommercialModelDefaultUpdate{
		RelationModel: "BTHWANI_PARTNER", CommercialModel: "SUBSCRIPTION", ExpectedVersion: 0,
		ActingActorID: operator, Reason: "Different facts with same key must not be applied",
		IdempotencyKey: independent.IdempotencyKey, CorrelationID: independent.CorrelationID,
	}); !errors.Is(err, ErrIdempotencyConflict) {
		t.Fatalf("cross-relation idempotency must be blocked: %v", err)
	}
	change := independent
	change.CommercialModel = "COMMISSION"
	change.ExpectedVersion = 1
	change.Reason = "Prospective independent Store policy version two"
	change.IdempotencyKey = "independent-model-v2-" + s.suffix
	change.CorrelationID = "independent-correlation-v2-" + s.suffix
	changed, replayed, err := UpdateStoreRelationCommercialModelDefault(s.ctx, s.db, change)
	if err != nil || replayed || changed.PolicyVersion != 2 || changed.CommercialModel != "COMMISSION" {
		t.Fatalf("independent v2 not persisted: %+v replayed=%t err=%v", changed, replayed, err)
	}
	updatedReplay, replayed, err := UpdateStoreRelationCommercialModelDefault(s.ctx, s.db, change)
	if err != nil || !replayed || !updatedReplay.UpdatedAt.Equal(changed.UpdatedAt) || updatedReplay.PolicyVersion != changed.PolicyVersion {
		t.Fatalf("updated policy replay must preserve the exact original receipt: first=%+v replay=%+v replayed=%t err=%v", changed, updatedReplay, replayed, err)
	}
	if _, _, err := UpdateStoreRelationCommercialModelDefault(s.ctx, s.db, StoreRelationCommercialModelDefaultUpdate{
		RelationModel: "INDEPENDENT_STORE", CommercialModel: "SUBSCRIPTION", ExpectedVersion: 1,
		ActingActorID: operator, Reason: "Stale expected-version must be refused",
		IdempotencyKey: "independent-model-stale-" + s.suffix, CorrelationID: "independent-stale-correlation-" + s.suffix,
	}); !errors.Is(err, ErrStoreRelationCommercialDefaultVersion) {
		t.Fatalf("stale version not refused: %v", err)
	}
	originalReceipt, replayed, err := UpdateStoreRelationCommercialModelDefault(s.ctx, s.db, independent)
	if err != nil || !replayed || originalReceipt.PolicyVersion != 1 || originalReceipt.CommercialModel != "SUBSCRIPTION" || !originalReceipt.UpdatedAt.Equal(first.UpdatedAt) {
		t.Fatalf("replay must preserve the entire original versioned receipt (including updatedAt): first=%+v replay=%+v replayed=%t err=%v", first, originalReceipt, replayed, err)
	}
	// Two operators racing the same expected version cannot create two effective defaults.
	var group sync.WaitGroup
	type attempt struct {
		item     StoreRelationCommercialModelDefault
		replayed bool
		err      error
	}
	results := make(chan attempt, 2)
	for i := 0; i < 2; i++ {
		group.Add(1)
		go func(index int) {
			defer group.Done()
			input := StoreRelationCommercialModelDefaultUpdate{
				RelationModel: "INDEPENDENT_STORE", CommercialModel: "SUBSCRIPTION",
				ExpectedVersion: 2, ActingActorID: operator,
				Reason:         "Concurrent prospective model change must be serialized",
				IdempotencyKey: "model-race-" + string(rune('a'+index)) + "-" + s.suffix,
				CorrelationID:  "model-race-correlation-" + string(rune('a'+index)) + "-" + s.suffix,
			}
			item, replayed, err := UpdateStoreRelationCommercialModelDefault(s.ctx, s.db, input)
			results <- attempt{item: item, replayed: replayed, err: err}
		}(i)
	}
	group.Wait()
	close(results)
	successes, conflicts := 0, 0
	for result := range results {
		if result.err == nil && !result.replayed && result.item.CommercialModel == "SUBSCRIPTION" && result.item.PolicyVersion == 3 {
			successes++
		} else if errors.Is(result.err, ErrStoreRelationCommercialDefaultVersion) {
			conflicts++
		} else {
			t.Fatalf("unexpected concurrent update result: %+v", result)
		}
	}
	if successes != 1 || conflicts != 1 {
		t.Fatalf("concurrent updates: successes=%d conflicts=%d, expected 1 each", successes, conflicts)
	}

	all, err = ReadStoreRelationCommercialModelDefaults(s.ctx, s.db)
	if err != nil || len(all) != 2 || all[0].RelationModel != "BTHWANI_PARTNER" || all[0].CommercialModel != "COMMISSION" ||
		all[1].RelationModel != "INDEPENDENT_STORE" || all[1].CommercialModel != "SUBSCRIPTION" || all[1].PolicyVersion != 3 {
		t.Fatalf("WLT canonical readback invalid: %+v err=%v", all, err)
	}
	var agreementCount, eventCount int
	if err := s.db.QueryRowContext(s.ctx, "SELECT COUNT(*) FROM wlt.store_commercial_agreements").Scan(&agreementCount); err != nil || agreementCount != agreementsBefore {
		t.Fatalf("a policy change created an agreement or touched existing finance facts: count=%d err=%v", agreementCount, err)
	}
	if err := s.db.QueryRowContext(s.ctx, "SELECT COUNT(*) FROM wlt.store_relation_commercial_model_default_events").Scan(&eventCount); err != nil || eventCount != 4 {
		t.Fatalf("expected exactly four model-change events after serialized race: count=%d err=%v", eventCount, err)
	}
}

// A policy audit event is evidence, not just an arbitrary row. PostgreSQL must
// reject malformed hashes and impossible first/change transitions even if an
// unexpected caller attempts to bypass the sole WLT service writer.
func TestStoreRelationCommercialModelDefaultEventSQLConstraints(t *testing.T) {
	s := newFieldAcquisitionScenario(t)
	actor := "model-audit-operator-" + s.suffix
	relation := "INDEPENDENT_STORE"
	input := StoreRelationCommercialModelDefaultUpdate{
		RelationModel: relation, CommercialModel: "COMMISSION", ExpectedVersion: 0,
		ActingActorID: actor, Reason: "Initial canonical financial model policy",
		IdempotencyKey: "model-audit-create-" + s.suffix,
		CorrelationID:  "model-audit-correlation-" + s.suffix,
	}
	created, replayed, err := UpdateStoreRelationCommercialModelDefault(s.ctx, s.db, input)
	if err != nil || replayed || created.PolicyVersion != 1 {
		t.Fatalf("original WLT policy writer failed: %+v replayed=%t err=%v", created, replayed, err)
	}
	tests := []struct {
		name            string
		hash            string
		previousModel   any
		newModel        string
		previousVersion any
		newVersion      int
		constraint      string
	}{
		{"invalid_hash", "not-a-sha256", nil, "COMMISSION", nil, 1, "store_relation_model_default_event_hash_chk"},
		{"orphaned_previous_version", hashFacts("audit-orphaned-version"), nil, "SUBSCRIPTION", 1, 2, "store_relation_model_default_event_transition_chk"},
		{"skipped_version", hashFacts("audit-skipped-version"), "COMMISSION", "SUBSCRIPTION", 1, 3, "store_relation_model_default_event_transition_chk"},
		{"unchanged_model", hashFacts("audit-unchanged-model"), "COMMISSION", "COMMISSION", 1, 2, "store_relation_model_default_event_transition_chk"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			_, insertErr := s.db.ExecContext(s.ctx, `INSERT INTO wlt.store_relation_commercial_model_default_events
				(idempotency_key,request_hash,relation_model,previous_model,new_model,
				 previous_policy_version,new_policy_version,changed_by_actor_id,reason,correlation_id)
				VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
				"invalid-audit-"+tc.name+"-"+s.suffix, tc.hash, relation, tc.previousModel,
				tc.newModel, tc.previousVersion, tc.newVersion, actor,
				"Invalid WLT audit event must be rejected by PostgreSQL",
				"invalid-audit-correlation-"+s.suffix)
			var pgErr *pq.Error
			if !errors.As(insertErr, &pgErr) || string(pgErr.Code) != "23514" || pgErr.Constraint != tc.constraint {
				t.Fatalf("expected SQL CHECK %q rejection, got %v", tc.constraint, insertErr)
			}
		})
	}
	var count int
	if err := s.db.QueryRowContext(s.ctx, `SELECT COUNT(*)
		FROM wlt.store_relation_commercial_model_default_events WHERE relation_model=$1`, relation).Scan(&count); err != nil || count != 1 {
		t.Fatalf("invalid audit attempts changed canonical event count: count=%d err=%v", count, err)
	}
}
