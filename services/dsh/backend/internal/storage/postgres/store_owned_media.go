package postgres

import (
	"context"
	"database/sql"
	"errors"
)

// ActivateStoreOwnedMedia uses the existing asset/cleanup owner with Store concurrency.
func ActivateStoreOwnedMedia(ctx context.Context, db *sql.DB, assetID, storeID string, expectedVersion int, idempotencyKey, requestHash, actorID, correlationID string) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var version int
	if err = tx.QueryRowContext(ctx, "SELECT version FROM dsh.stores WHERE id=$1 AND deleted_at IS NULL FOR UPDATE", storeID).Scan(&version); err != nil {
		return err
	}
	var target, state, hash, role string
	var claimed sql.NullTime
	if err = tx.QueryRowContext(ctx, "SELECT COALESCE(store_id,''),state,request_hash,media_role,cleanup_claimed_at FROM dsh.store_profile_media_assets WHERE id=$1 FOR UPDATE", assetID).Scan(&target, &state, &hash, &role, &claimed); err != nil {
		return err
	}
	if target != storeID || hash != requestHash {
		return ErrStoreProfileMediaIdempotency
	}
	if claimed.Valid {
		return ErrStoreProfileMediaCleanupBusy
	}
	if state == "active" || state == "retired" {
		return tx.Commit()
	}
	if state != "pending" {
		return ErrStoreProfileMediaFailed
	}
	if version != expectedVersion {
		return ErrStoreProfileMediaVersion
	}
	var previous string
	err = tx.QueryRowContext(ctx, "SELECT id FROM dsh.store_profile_media_assets WHERE store_id=$1 AND media_role=$2 AND state='active' AND id<>$3 FOR UPDATE", storeID, role, assetID).Scan(&previous)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	if previous != "" {
		if _, err = tx.ExecContext(ctx, "UPDATE dsh.store_profile_media_assets SET state='retired',retired_at=clock_timestamp() WHERE id=$1", previous); err != nil {
			return err
		}
	}
	if _, err = tx.ExecContext(ctx, "UPDATE dsh.store_profile_media_assets SET state='active',attached_at=clock_timestamp() WHERE id=$1", assetID); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, "UPDATE dsh.stores SET version=version+1,updated_at=clock_timestamp() WHERE id=$1", storeID); err != nil {
		return err
	}
	event := "store_profile_image_attached"
	if role == "cover" {
		event = "store_cover_image_attached"
	}
	if previous != "" {
		if role == "cover" {
			event = "store_cover_image_replaced"
		} else {
			event = "store_profile_image_replaced"
		}
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO dsh.store_profile_media_audit(id,event_type,idempotency_key,correlation_id,acting_actor_id,store_id,result_version,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, "store_profile_media_audit_"+assetID, event, idempotencyKey, correlationID, actorID, storeID, version+1, requestHash)
	if err != nil {
		return err
	}
	return tx.Commit()
}
