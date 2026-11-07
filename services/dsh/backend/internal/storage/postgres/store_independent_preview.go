package postgres

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
)

// ReadIndependentStoreOwnedByPartner is the private preview boundary.
// It never grants web publication or market orderability.
func ReadIndependentStoreOwnedByPartner(ctx context.Context, db *sql.DB, storeID, partnerActorID string) (StoreRecord, error) {
	storeID, partnerActorID = strings.TrimSpace(storeID), strings.TrimSpace(partnerActorID)
	if db == nil || storeID == "" || partnerActorID == "" || len(storeID) > 128 || len(partnerActorID) > 128 {
		return StoreRecord{}, ErrStoreNotFound
	}
	// The owner and relation checks are part of one fixed, parameterized SQL
	// statement. Never build a preview scope dynamically from request data.
	store, err := scanStore(db.QueryRowContext(ctx, `
		SELECT id, partner_actor_id, name, service_city_id, primary_vertical_id,
			commercial_store_type_id, version, publication_state, publication_changed_at,
			created_at, updated_at, delivery_origin_latitude, delivery_origin_longitude,
			delivery_origin_version, delivery_origin_updated_at, fulfillment_modes, relation_model
		FROM dsh.stores
		WHERE id=$1 AND partner_actor_id=$2 AND relation_model='INDEPENDENT_STORE'
			AND deleted_at IS NULL
	`, storeID, partnerActorID))
	if errors.Is(err, sql.ErrNoRows) {
		return StoreRecord{}, ErrStoreNotFound
	}
	if err != nil {
		return StoreRecord{}, fmt.Errorf("read independent Store preview scope: %w", err)
	}
	store.StoreProfileImage, err = ReadStoreProfileMedia(ctx, db, "", store.ID)
	if err != nil {
		return StoreRecord{}, err
	}
	store.StoreCoverImage, err = ReadStoreCoverMedia(ctx, db, "", store.ID)
	if err != nil {
		return StoreRecord{}, err
	}
	return store, nil
}
