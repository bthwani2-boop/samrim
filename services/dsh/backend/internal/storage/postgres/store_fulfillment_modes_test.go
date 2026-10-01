package postgres_test

import (
	"context"
	"database/sql"
	"errors"
	"testing"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

func verifyStoreFulfillmentModes(t *testing.T, ctx context.Context, db *sql.DB) {
	t.Helper()
	const (
		storeID         = "store_fulfillment_modes_v1"
		partnerActorID  = "act_partner_fulfillment_modes_v1"
		operatorActorID = "act_operator_fulfillment_modes_v1"
	)
	insertCanonicalStoreFixture(t, ctx, db, canonicalStoreFixture{
		ID:             storeID,
		PartnerActorID: partnerActorID,
		Name:           "Fulfillment Modes Store",
	})

	_, err := postgres.SetStoreFulfillmentModes(ctx, db, storeID, operatorActorID, nil, 1, "idem-mode-empty-v1", "corr-mode-empty-v1")
	requireStoreFulfillmentModesError(t, err, postgres.ErrFulfillmentModesInvalid)

	allModes := []string{postgres.FulfillmentModeBthwaniCaptain, postgres.FulfillmentModePartnerCaptain, postgres.FulfillmentModeCustomerPickup}
	modes, err := postgres.SetStoreFulfillmentModes(ctx, db, storeID, operatorActorID, []string{postgres.FulfillmentModeCustomerPickup, postgres.FulfillmentModePartnerCaptain, postgres.FulfillmentModeBthwaniCaptain}, 1, "idem-mode-all-v1", "corr-mode-all-v1")
	requireStoreFulfillmentModesResult(t, modes, err, false, 2, allModes)
	replay, err := postgres.SetStoreFulfillmentModes(ctx, db, storeID, operatorActorID, allModes, 1, "idem-mode-all-v1", "corr-mode-all-replay-v1")
	requireStoreFulfillmentModesResult(t, replay, err, true, 2, allModes)
	_, err = postgres.SetStoreFulfillmentModes(ctx, db, storeID, operatorActorID, []string{postgres.FulfillmentModeCustomerPickup}, 1, "idem-mode-all-v1", "corr-mode-conflict-v1")
	requireStoreFulfillmentModesError(t, err, postgres.ErrStoreFulfillmentModesIdempotency)

	noOp, err := postgres.SetStoreFulfillmentModes(ctx, db, storeID, operatorActorID, allModes, 2, "idem-mode-noop-v1", "corr-mode-noop-v1")
	requireStoreFulfillmentModesResult(t, noOp, err, false, 2, allModes)
	partnerModes := []string{postgres.FulfillmentModePartnerCaptain}
	partnerOnly, err := postgres.SetStoreFulfillmentModes(ctx, db, storeID, operatorActorID, partnerModes, 2, "idem-mode-partner-only-v1", "corr-mode-partner-only-v1")
	requireStoreFulfillmentModesResult(t, partnerOnly, err, false, 3, partnerModes)
	_, err = postgres.SetStoreFulfillmentModes(ctx, db, storeID, operatorActorID, []string{postgres.FulfillmentModeBthwaniCaptain}, 2, "idem-mode-stale-v1", "corr-mode-stale-v1")
	requireStoreFulfillmentModesError(t, err, postgres.ErrStoreFulfillmentModesVersion)

	current, err := postgres.ReadStore(ctx, db, storeID)
	if err != nil || current.Version != 3 || !equalStoreFulfillmentModes(current.FulfillmentModes, partnerModes) {
		t.Fatalf("canonical Store fulfillment mode readback failed: %+v err=%v", current, err)
	}
	var audits int
	if err := db.QueryRowContext(ctx, "SELECT count(*) FROM dsh.store_fulfillment_modes_audit WHERE store_id=$1", storeID).Scan(&audits); err != nil || audits != 2 {
		t.Fatalf("unexpected Store fulfillment mode audit count: count=%d err=%v", audits, err)
	}
	var attributedAudits int
	if err := db.QueryRowContext(ctx, "SELECT count(*) FROM dsh.store_fulfillment_modes_audit WHERE store_id=$1 AND acting_actor_id=$2 AND partner_actor_id=$3", storeID, operatorActorID, partnerActorID).Scan(&attributedAudits); err != nil || attributedAudits != 2 {
		t.Fatalf("Store fulfillment mode audit must distinguish the acting Operator from the owning Partner: count=%d err=%v", attributedAudits, err)
	}
}

func requireStoreFulfillmentModesError(t *testing.T, err, expected error) {
	t.Helper()
	if !errors.Is(err, expected) {
		t.Fatalf("Store fulfillment mode operation error = %v, want %v", err, expected)
	}
}

func requireStoreFulfillmentModesResult(t *testing.T, result postgres.StoreFulfillmentModesResult, err error, replayed bool, version int, modes []string) {
	t.Helper()
	if err != nil || result.Replayed != replayed || result.Version != version || !equalStoreFulfillmentModes(result.FulfillmentModes, modes) {
		t.Fatalf("Store fulfillment mode result mismatch: result=%+v err=%v", result, err)
	}
}

func equalStoreFulfillmentModes(left, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}
