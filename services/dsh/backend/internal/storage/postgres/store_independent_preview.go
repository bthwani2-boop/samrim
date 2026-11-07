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
	store, err := scanStore(db.QueryRowContext(ctx, storeSelect+` WHERE id=$1 AND partner_actor_id=$2 AND relation_model='INDEPENDENT_STORE' AND deleted_at IS NULL`, storeID, partnerActorID))
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
