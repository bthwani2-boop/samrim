package postgres

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"testing"
)

func TestPartnerStoreCommissionPolicyPostgresLifecycle(t *testing.T) {
	scenario := newFieldAcquisitionScenario(t)
	typeID := "commission-policy-test-" + scenario.suffix
	actorID := "commission-actor-" + scenario.suffix
	reason := "approved commission policy change"
	correlation := "commission-correlation-" + scenario.suffix
	t.Cleanup(func() {
		if _, err := scenario.db.ExecContext(scenario.ctx, `DELETE FROM wlt.commercial_store_type_commission_policy_events WHERE commercial_store_type_id=$1`, typeID); err != nil {
			t.Errorf("remove commission policy test events: %v", err)
		}
		if _, err := scenario.db.ExecContext(scenario.ctx, `DELETE FROM wlt.commercial_store_type_commission_policies WHERE commercial_store_type_id=$1`, typeID); err != nil {
			t.Errorf("remove commission policy test rows: %v", err)
		}
	})

	policies, err := ReadPartnerStoreCommissionPolicies(scenario.ctx, scenario.db, typeID)
	if err != nil || len(policies) != 0 {
		t.Fatalf("initial commission policy read = (%+v, %v), want no policies", policies, err)
	}

	create := PartnerStoreCommissionPolicyUpdate{
		CommercialStoreTypeID: typeID,
		FulfillmentMode:       "PARTNER_CAPTAIN",
		CommissionRateBps:     1250,
		ChangedByActorID:      actorID,
		Reason:                reason,
		IdempotencyKey:        "commission-create-" + scenario.suffix,
		CorrelationID:         correlation,
	}
	created, replayed, err := UpdatePartnerStoreCommissionPolicy(scenario.ctx, scenario.db, create)
	if err != nil || replayed || created.PolicyVersion != 1 || created.CommissionRateBps != 1250 {
		t.Fatalf("create commission policy = (%+v, replayed=%t, %v), want version 1 at 1250 bps", created, replayed, err)
	}

	createdReplay, replayed, err := UpdatePartnerStoreCommissionPolicy(scenario.ctx, scenario.db, create)
	if err != nil || !replayed || createdReplay.CommercialStoreTypeID != created.CommercialStoreTypeID || createdReplay.FulfillmentMode != created.FulfillmentMode || createdReplay.CommissionRateBps != created.CommissionRateBps || createdReplay.PolicyVersion != created.PolicyVersion {
		t.Fatalf("idempotent commission create = (%+v, replayed=%t, %v), want original row", createdReplay, replayed, err)
	}

	conflictingReplay := create
	conflictingReplay.CommissionRateBps = 1300
	if _, replayed, err := UpdatePartnerStoreCommissionPolicy(scenario.ctx, scenario.db, conflictingReplay); !errors.Is(err, ErrIdempotencyConflict) || replayed {
		t.Fatalf("conflicting idempotency replay = (replayed=%t, %v), want ErrIdempotencyConflict", replayed, err)
	}

	staleCreate := create
	staleCreate.CommercialStoreTypeID += "-absent"
	staleCreate.IdempotencyKey = "commission-stale-" + scenario.suffix
	staleCreate.ExpectedVersion = 1
	if _, _, err := UpdatePartnerStoreCommissionPolicy(scenario.ctx, scenario.db, staleCreate); !errors.Is(err, ErrPartnerStoreCommissionPolicyVersionConflict) {
		t.Fatalf("create with nonzero expected version error = %v, want version conflict", err)
	}

	noOp := create
	noOp.IdempotencyKey = "commission-noop-" + scenario.suffix
	noOp.ExpectedVersion = 1
	if _, _, err := UpdatePartnerStoreCommissionPolicy(scenario.ctx, scenario.db, noOp); !errors.Is(err, ErrPartnerStoreCommissionPolicyInvalidInput) {
		t.Fatalf("no-op commission update error = %v, want invalid input", err)
	}

	update := create
	update.CommissionRateBps = 1750
	update.ExpectedVersion = 1
	update.IdempotencyKey = "commission-update-" + scenario.suffix
	updated, replayed, err := UpdatePartnerStoreCommissionPolicy(scenario.ctx, scenario.db, update)
	if err != nil || replayed || updated.PolicyVersion != 2 || updated.CommissionRateBps != 1750 || updated.ChangedByActorID != actorID || updated.ChangeReason != reason {
		t.Fatalf("update commission policy = (%+v, replayed=%t, %v), want audited version 2 at 1750 bps", updated, replayed, err)
	}

	staleUpdate := update
	staleUpdate.CommissionRateBps = 1800
	staleUpdate.IdempotencyKey = "commission-stale-update-" + scenario.suffix
	if _, _, err := UpdatePartnerStoreCommissionPolicy(scenario.ctx, scenario.db, staleUpdate); !errors.Is(err, ErrPartnerStoreCommissionPolicyVersionConflict) {
		t.Fatalf("stale commission update error = %v, want version conflict", err)
	}

	secondMode := create
	secondMode.FulfillmentMode = "CUSTOMER_PICKUP"
	secondMode.CommissionRateBps = 500
	secondMode.IdempotencyKey = "commission-pickup-" + scenario.suffix
	if _, _, err := UpdatePartnerStoreCommissionPolicy(scenario.ctx, scenario.db, secondMode); err != nil {
		t.Fatalf("create second fulfillment policy: %v", err)
	}

	policies, err = ReadPartnerStoreCommissionPolicies(scenario.ctx, scenario.db, typeID)
	if err != nil {
		t.Fatalf("read commission policies: %v", err)
	}
	if len(policies) != 2 || policies[0].FulfillmentMode != "CUSTOMER_PICKUP" || policies[1].FulfillmentMode != "PARTNER_CAPTAIN" {
		t.Fatalf("commission policies = %+v, want two rows sorted by fulfillment mode", policies)
	}
	if policies[1].PolicyVersion != 2 || policies[1].CommissionRateBps != 1750 || policies[1].ChangedByActorID != actorID || policies[1].ChangeReason != reason {
		t.Fatalf("updated commission policy readback = %+v, want persisted update and audit metadata", policies[1])
	}

	var eventCount int
	if err := scenario.db.QueryRowContext(scenario.ctx, `SELECT count(*) FROM wlt.commercial_store_type_commission_policy_events WHERE commercial_store_type_id=$1`, typeID).Scan(&eventCount); err != nil {
		t.Fatalf("read commission event count: %v", err)
	}
	if eventCount != 3 {
		t.Fatalf("commission event count = %d, want 3 successful changes (replays and rejected updates must not write events)", eventCount)
	}
}

func TestPartnerStoreCommissionPolicyRejectsInvalidReadAndUpdateInputs(t *testing.T) {
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
			_, err := ReadPartnerStoreCommissionPolicies(context.Background(), db, test.id)
			if !errors.Is(err, ErrPartnerStoreCommissionPolicyInvalidInput) {
				t.Fatalf("read invalid commission policies error = %v, want ErrPartnerStoreCommissionPolicyInvalidInput", err)
			}
		})
	}

	valid := PartnerStoreCommissionPolicyUpdate{
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
		change func(*PartnerStoreCommissionPolicyUpdate)
	}{
		{name: "nil database", change: func(input *PartnerStoreCommissionPolicyUpdate) {}},
		{name: "empty type", change: func(input *PartnerStoreCommissionPolicyUpdate) { input.CommercialStoreTypeID = " " }},
		{name: "oversized type", change: func(input *PartnerStoreCommissionPolicyUpdate) {
			input.CommercialStoreTypeID = strings.Repeat("x", 129)
		}},
		{name: "unsupported mode", change: func(input *PartnerStoreCommissionPolicyUpdate) { input.FulfillmentMode = "PARTNER_DELIVERY" }},
		{name: "negative rate", change: func(input *PartnerStoreCommissionPolicyUpdate) { input.CommissionRateBps = -1 }},
		{name: "rate above maximum", change: func(input *PartnerStoreCommissionPolicyUpdate) { input.CommissionRateBps = 10001 }},
		{name: "negative expected version", change: func(input *PartnerStoreCommissionPolicyUpdate) { input.ExpectedVersion = -1 }},
		{name: "empty actor", change: func(input *PartnerStoreCommissionPolicyUpdate) { input.ChangedByActorID = " " }},
		{name: "oversized actor", change: func(input *PartnerStoreCommissionPolicyUpdate) { input.ChangedByActorID = strings.Repeat("a", 129) }},
		{name: "short reason", change: func(input *PartnerStoreCommissionPolicyUpdate) { input.Reason = "short" }},
		{name: "oversized reason", change: func(input *PartnerStoreCommissionPolicyUpdate) { input.Reason = strings.Repeat("r", 501) }},
		{name: "short idempotency key", change: func(input *PartnerStoreCommissionPolicyUpdate) { input.IdempotencyKey = "short" }},
		{name: "oversized idempotency key", change: func(input *PartnerStoreCommissionPolicyUpdate) { input.IdempotencyKey = strings.Repeat("i", 129) }},
		{name: "short correlation id", change: func(input *PartnerStoreCommissionPolicyUpdate) { input.CorrelationID = "short" }},
		{name: "oversized correlation id", change: func(input *PartnerStoreCommissionPolicyUpdate) { input.CorrelationID = strings.Repeat("c", 129) }},
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
			if _, _, err := UpdatePartnerStoreCommissionPolicy(context.Background(), db, input); !errors.Is(err, ErrPartnerStoreCommissionPolicyInvalidInput) {
				t.Fatalf("update invalid commission policy error = %v, want ErrPartnerStoreCommissionPolicyInvalidInput", err)
			}
		})
	}
}
