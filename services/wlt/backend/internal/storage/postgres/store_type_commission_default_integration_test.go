package postgres

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"testing"
)

func TestStoreTypeCommissionDefaultPostgresLifecycle(t *testing.T) {
	database := newFieldAcquisitionScenario(t)
	scenario := newPartnerCommissionPolicyScenario(t, database)
	t.Cleanup(scenario.deleteRows)
	scenario.runLifecycle()
}

type partnerCommissionPolicyScenario struct {
	t        *testing.T
	database *fieldAcquisitionScenario
	typeID   string
	actorID  string
	reason   string
	suffix   string
}

func newPartnerCommissionPolicyScenario(t *testing.T, database *fieldAcquisitionScenario) partnerCommissionPolicyScenario {
	return partnerCommissionPolicyScenario{
		t: t, database: database, suffix: database.suffix,
		typeID:  "commission-policy-test-" + database.suffix,
		actorID: "commission-actor-" + database.suffix,
		reason:  "approved commission policy change",
	}
}

func (s partnerCommissionPolicyScenario) runLifecycle() {
	s.assertEmptyRead()
	create := s.createInput()
	created := s.createPolicy(create)
	s.assertIdempotentReplay(create, created)
	s.assertConflictingReplay(create)
	s.assertRejectedVersionAndNoOp(create)
	updated := s.updatePolicy(create)
	s.createSecondMode(create)
	s.assertReadback(updated)
	s.assertEventCount(3)
}

func (s partnerCommissionPolicyScenario) createInput() StoreTypeCommissionDefaultUpdate {
	return StoreTypeCommissionDefaultUpdate{
		CommercialStoreTypeID: s.typeID, FulfillmentMode: "PARTNER_CAPTAIN", CommissionRateBps: 1250,
		ChangedByActorID: s.actorID, Reason: s.reason,
		IdempotencyKey: "commission-create-" + s.suffix, CorrelationID: "commission-correlation-" + s.suffix,
	}
}

func (s partnerCommissionPolicyScenario) assertEmptyRead() {
	policies, err := ReadStoreTypeCommissionDefaults(s.database.ctx, s.database.db, s.typeID)
	if err != nil || len(policies) != 0 {
		s.t.Fatalf("initial commission policy read = (%+v, %v), want no policies", policies, err)
	}
}

func (s partnerCommissionPolicyScenario) createPolicy(input StoreTypeCommissionDefaultUpdate) StoreTypeCommissionDefaultRecord {
	created, replayed, err := UpdateStoreTypeCommissionDefault(s.database.ctx, s.database.db, input)
	if err != nil || replayed || created.PolicyVersion != 1 || created.CommissionRateBps != 1250 {
		s.t.Fatalf("create commission policy = (%+v, replayed=%t, %v), want version 1 at 1250 bps", created, replayed, err)
	}
	return created
}

func (s partnerCommissionPolicyScenario) assertIdempotentReplay(input StoreTypeCommissionDefaultUpdate, created StoreTypeCommissionDefaultRecord) {
	replay, replayed, err := UpdateStoreTypeCommissionDefault(s.database.ctx, s.database.db, input)
	if err != nil || !replayed || replay.CommercialStoreTypeID != created.CommercialStoreTypeID || replay.FulfillmentMode != created.FulfillmentMode || replay.CommissionRateBps != created.CommissionRateBps || replay.PolicyVersion != created.PolicyVersion {
		s.t.Fatalf("idempotent commission create = (%+v, replayed=%t, %v), want original row", replay, replayed, err)
	}
}

func (s partnerCommissionPolicyScenario) assertConflictingReplay(input StoreTypeCommissionDefaultUpdate) {
	input.CommissionRateBps = 1300
	if _, replayed, err := UpdateStoreTypeCommissionDefault(s.database.ctx, s.database.db, input); !errors.Is(err, ErrIdempotencyConflict) || replayed {
		s.t.Fatalf("conflicting idempotency replay = (replayed=%t, %v), want ErrIdempotencyConflict", replayed, err)
	}
}

func (s partnerCommissionPolicyScenario) assertRejectedVersionAndNoOp(input StoreTypeCommissionDefaultUpdate) {
	staleCreate := input
	staleCreate.CommercialStoreTypeID += "-absent"
	staleCreate.IdempotencyKey = "commission-stale-" + s.suffix
	staleCreate.ExpectedVersion = 1
	if _, _, err := UpdateStoreTypeCommissionDefault(s.database.ctx, s.database.db, staleCreate); !errors.Is(err, ErrStoreTypeCommissionDefaultVersionConflict) {
		s.t.Fatalf("create with nonzero expected version error = %v, want version conflict", err)
	}
	noOp := input
	noOp.IdempotencyKey = "commission-noop-" + s.suffix
	noOp.ExpectedVersion = 1
	if _, _, err := UpdateStoreTypeCommissionDefault(s.database.ctx, s.database.db, noOp); !errors.Is(err, ErrStoreTypeCommissionDefaultInvalidInput) {
		s.t.Fatalf("no-op commission update error = %v, want invalid input", err)
	}
}

func (s partnerCommissionPolicyScenario) updatePolicy(input StoreTypeCommissionDefaultUpdate) StoreTypeCommissionDefaultRecord {
	input.CommissionRateBps = 1750
	input.ExpectedVersion = 1
	input.IdempotencyKey = "commission-update-" + s.suffix
	updated, replayed, err := UpdateStoreTypeCommissionDefault(s.database.ctx, s.database.db, input)
	if err != nil || replayed || updated.PolicyVersion != 2 || updated.CommissionRateBps != 1750 || updated.ChangedByActorID != s.actorID || updated.ChangeReason != s.reason {
		s.t.Fatalf("update commission policy = (%+v, replayed=%t, %v), want audited version 2 at 1750 bps", updated, replayed, err)
	}
	staleUpdate := input
	staleUpdate.CommissionRateBps = 1800
	staleUpdate.IdempotencyKey = "commission-stale-update-" + s.suffix
	if _, _, err := UpdateStoreTypeCommissionDefault(s.database.ctx, s.database.db, staleUpdate); !errors.Is(err, ErrStoreTypeCommissionDefaultVersionConflict) {
		s.t.Fatalf("stale commission update error = %v, want version conflict", err)
	}
	return updated
}

func (s partnerCommissionPolicyScenario) createSecondMode(input StoreTypeCommissionDefaultUpdate) {
	input.FulfillmentMode = "CUSTOMER_PICKUP"
	input.CommissionRateBps = 500
	input.IdempotencyKey = "commission-pickup-" + s.suffix
	if _, _, err := UpdateStoreTypeCommissionDefault(s.database.ctx, s.database.db, input); err != nil {
		s.t.Fatalf("create second fulfillment policy: %v", err)
	}
}

func (s partnerCommissionPolicyScenario) assertReadback(updated StoreTypeCommissionDefaultRecord) {
	policies, err := ReadStoreTypeCommissionDefaults(s.database.ctx, s.database.db, s.typeID)
	if err != nil {
		s.t.Fatalf("read commission policies: %v", err)
	}
	if len(policies) != 2 || policies[0].FulfillmentMode != "CUSTOMER_PICKUP" || policies[1].FulfillmentMode != "PARTNER_CAPTAIN" {
		s.t.Fatalf("commission policies = %+v, want two rows sorted by fulfillment mode", policies)
	}
	if policies[1].CommercialStoreTypeID != updated.CommercialStoreTypeID || policies[1].FulfillmentMode != updated.FulfillmentMode || policies[1].CommissionRateBps != updated.CommissionRateBps || policies[1].PolicyVersion != updated.PolicyVersion || policies[1].ChangedByActorID != updated.ChangedByActorID || policies[1].ChangeReason != updated.ChangeReason {
		s.t.Fatalf("updated commission policy readback = %+v, want persisted update %+v", policies[1], updated)
	}
}

func (s partnerCommissionPolicyScenario) assertEventCount(want int) {
	var eventCount int
	if err := s.database.db.QueryRowContext(s.database.ctx, `SELECT count(*) FROM wlt.commercial_store_type_commission_default_events WHERE commercial_store_type_id=$1`, s.typeID).Scan(&eventCount); err != nil {
		s.t.Fatalf("read commission event count: %v", err)
	}
	if eventCount != want {
		s.t.Fatalf("commission event count = %d, want %d successful changes (replays and rejected updates must not write events)", eventCount, want)
	}
}

func (s partnerCommissionPolicyScenario) deleteRows() {
	if _, err := s.database.db.ExecContext(s.database.ctx, `DELETE FROM wlt.commercial_store_type_commission_default_events WHERE commercial_store_type_id=$1`, s.typeID); err != nil {
		s.t.Errorf("remove commission policy test events: %v", err)
	}
	if _, err := s.database.db.ExecContext(s.database.ctx, `DELETE FROM wlt.commercial_store_type_commission_defaults WHERE commercial_store_type_id=$1`, s.typeID); err != nil {
		s.t.Errorf("remove commission policy test rows: %v", err)
	}
}

func TestStoreTypeCommissionDefaultRejectsInvalidReadAndUpdateInputs(t *testing.T) {
	validationDB, err := sql.Open("postgres", "postgres://user:pass@127.0.0.1:1/validation?connect_timeout=1")
	if err != nil {
		t.Fatalf("open lazy validation database handle: %v", err)
	}
	t.Cleanup(func() {
		if err := validationDB.Close(); err != nil {
			t.Errorf("close lazy validation database handle: %v", err)
		}
	})
	for _, test := range []struct {
		name string
		db   bool
		id   string
	}{
		{name: "nil database", id: "commercial-store-type"},
		{name: "empty id", db: true, id: "  "},
		{name: "oversized id", db: true, id: strings.Repeat("x", 129)},
	} {
		t.Run("read/"+test.name, func(t *testing.T) {
			var db = (*sql.DB)(nil)
			if test.db {
				db = validationDB
			}
			_, err := ReadStoreTypeCommissionDefaults(context.Background(), db, test.id)
			if !errors.Is(err, ErrStoreTypeCommissionDefaultInvalidInput) {
				t.Fatalf("read invalid commission policies error = %v, want ErrStoreTypeCommissionDefaultInvalidInput", err)
			}
		})
	}

	valid := StoreTypeCommissionDefaultUpdate{
		CommercialStoreTypeID: "commercial-store-type",
		FulfillmentMode:       "PARTNER_CAPTAIN",
		CommissionRateBps:     1000,
		ExpectedVersion:       0,
		ChangedByActorID:      "operator-1",
		Reason:                "approved policy change",
		IdempotencyKey:        "commission-key-1",
		CorrelationID:         "commission-correlation-1",
	}
	invalidCases := []struct {
		name   string
		change func(*StoreTypeCommissionDefaultUpdate)
	}{
		{name: "nil database", change: func(input *StoreTypeCommissionDefaultUpdate) {}},
		{name: "empty type", change: func(input *StoreTypeCommissionDefaultUpdate) { input.CommercialStoreTypeID = " " }},
		{name: "oversized type", change: func(input *StoreTypeCommissionDefaultUpdate) {
			input.CommercialStoreTypeID = strings.Repeat("x", 129)
		}},
		{name: "unsupported mode", change: func(input *StoreTypeCommissionDefaultUpdate) { input.FulfillmentMode = "PARTNER_DELIVERY" }},
		{name: "negative rate", change: func(input *StoreTypeCommissionDefaultUpdate) { input.CommissionRateBps = -1 }},
		{name: "rate above maximum", change: func(input *StoreTypeCommissionDefaultUpdate) { input.CommissionRateBps = 10001 }},
		{name: "negative expected version", change: func(input *StoreTypeCommissionDefaultUpdate) { input.ExpectedVersion = -1 }},
		{name: "empty actor", change: func(input *StoreTypeCommissionDefaultUpdate) { input.ChangedByActorID = " " }},
		{name: "oversized actor", change: func(input *StoreTypeCommissionDefaultUpdate) { input.ChangedByActorID = strings.Repeat("a", 129) }},
		{name: "short reason", change: func(input *StoreTypeCommissionDefaultUpdate) { input.Reason = "short" }},
		{name: "oversized reason", change: func(input *StoreTypeCommissionDefaultUpdate) { input.Reason = strings.Repeat("r", 501) }},
		{name: "short idempotency key", change: func(input *StoreTypeCommissionDefaultUpdate) { input.IdempotencyKey = "short" }},
		{name: "oversized idempotency key", change: func(input *StoreTypeCommissionDefaultUpdate) { input.IdempotencyKey = strings.Repeat("i", 129) }},
		{name: "short correlation id", change: func(input *StoreTypeCommissionDefaultUpdate) { input.CorrelationID = "short" }},
		{name: "oversized correlation id", change: func(input *StoreTypeCommissionDefaultUpdate) { input.CorrelationID = strings.Repeat("c", 129) }},
	}
	for index, test := range invalidCases {
		t.Run(fmt.Sprintf("update/%s", test.name), func(t *testing.T) {
			input := valid
			input.IdempotencyKey += fmt.Sprintf("-%d", index)
			db := validationDB
			if test.name == "nil database" {
				db = nil
			}
			test.change(&input)
			if _, _, err := UpdateStoreTypeCommissionDefault(context.Background(), db, input); !errors.Is(err, ErrStoreTypeCommissionDefaultInvalidInput) {
				t.Fatalf("update invalid commission policy error = %v, want ErrStoreTypeCommissionDefaultInvalidInput", err)
			}
		})
	}
}
