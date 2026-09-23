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
		storeID        = "store_fulfillment_modes_v1"
		partnerActorID = "act_partner_fulfillment_modes_v1"
		otherPartnerID = "act_other_fulfillment_modes_v1"
	)
	if _, err := db.ExecContext(ctx, "INSERT INTO dsh.stores(id, partner_actor_id, name) VALUES($1,$2,$3)", storeID, partnerActorID, "Fulfillment Modes Store"); err != nil {
		t.Fatalf("insert fulfillment mode Store fixture: %v", err)
	}

	_, err := postgres.SetStoreFulfillmentModes(ctx, db, storeID, partnerActorID, nil, 1, "idem-mode-empty-v1", "corr-mode-empty-v1")
	requireStoreFulfillmentModesError(t, err, postgres.ErrFulfillmentModesInvalid)
	_, err = postgres.SetStoreFulfillmentModes(ctx, db, storeID, partnerActorID, []string{postgres.FulfillmentModePartnerCaptain}, 1, "idem-mode-unsupported-v1", "corr-mode-unsupported-v1")
	requireStoreFulfillmentModesError(t, err, postgres.ErrFulfillmentModesInvalid)
	_, err = postgres.SetStoreFulfillmentModes(ctx, db, storeID, otherPartnerID, []string{postgres.FulfillmentModeCustomerPickup}, 1, "idem-mode-foreign-v1", "corr-mode-foreign-v1")
	requireStoreFulfillmentModesError(t, err, postgres.ErrStoreFulfillmentModesNotFound)

	bothModes := []string{postgres.FulfillmentModeBthwaniCaptain, postgres.FulfillmentModeCustomerPickup}
	modes, err := postgres.SetStoreFulfillmentModes(ctx, db, storeID, partnerActorID, []string{postgres.FulfillmentModeCustomerPickup, postgres.FulfillmentModeBthwaniCaptain}, 1, "idem-mode-both-v1", "corr-mode-both-v1")
	requireStoreFulfillmentModesResult(t, modes, err, false, 2, bothModes)
	replay, err := postgres.SetStoreFulfillmentModes(ctx, db, storeID, partnerActorID, bothModes, 1, "idem-mode-both-v1", "corr-mode-both-replay-v1")
	requireStoreFulfillmentModesResult(t, replay, err, true, 2, bothModes)
	_, err = postgres.SetStoreFulfillmentModes(ctx, db, storeID, partnerActorID, []string{postgres.FulfillmentModeCustomerPickup}, 1, "idem-mode-both-v1", "corr-mode-conflict-v1")
	requireStoreFulfillmentModesError(t, err, postgres.ErrStoreFulfillmentModesIdempotency)

	noOp, err := postgres.SetStoreFulfillmentModes(ctx, db, storeID, partnerActorID, bothModes, 2, "idem-mode-noop-v1", "corr-mode-noop-v1")
	requireStoreFulfillmentModesResult(t, noOp, err, false, 2, bothModes)
	pickupModes := []string{postgres.FulfillmentModeCustomerPickup}
	pickup, err := postgres.SetStoreFulfillmentModes(ctx, db, storeID, partnerActorID, pickupModes, 2, "idem-mode-pickup-v1", "corr-mode-pickup-v1")
	requireStoreFulfillmentModesResult(t, pickup, err, false, 3, pickupModes)
	_, err = postgres.SetStoreFulfillmentModes(ctx, db, storeID, partnerActorID, []string{postgres.FulfillmentModeBthwaniCaptain}, 2, "idem-mode-stale-v1", "corr-mode-stale-v1")
	requireStoreFulfillmentModesError(t, err, postgres.ErrStoreFulfillmentModesVersion)

	current, err := postgres.ReadStore(ctx, db, storeID)
	if err != nil || current.Version != 3 || !equalStoreFulfillmentModes(current.FulfillmentModes, pickupModes) {
		t.Fatalf("canonical Store fulfillment mode readback failed: %+v err=%v", current, err)
	}
	var audits int
	if err := db.QueryRowContext(ctx, "SELECT count(*) FROM dsh.store_fulfillment_modes_audit WHERE store_id=$1", storeID).Scan(&audits); err != nil || audits != 2 {
		t.Fatalf("unexpected Store fulfillment mode audit count: count=%d err=%v", audits, err)
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
