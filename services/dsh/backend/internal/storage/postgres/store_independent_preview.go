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
	if db == nil {
		return StoreRecord{}, ErrStoreNotFound
	}
	return readIndependentStoreOwnedByPartnerWithQueryer(ctx, db, storeID, partnerActorID)
}

func readIndependentStoreOwnedByPartnerWithQueryer(ctx context.Context, queryer storeProfileMediaQueryer, storeID, partnerActorID string) (StoreRecord, error) {
	storeID, partnerActorID = strings.TrimSpace(storeID), strings.TrimSpace(partnerActorID)
	if storeID == "" || partnerActorID == "" || len(storeID) > 128 || len(partnerActorID) > 128 {
		return StoreRecord{}, ErrStoreNotFound
	}
	// The owner and relation checks are part of one fixed, parameterized SQL
	// statement. Never build a preview scope dynamically from request data.
	store, err := scanStore(queryer.QueryRowContext(ctx, `
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
	store.StoreProfileImage, err = readStoreProfileMediaWithQuery(ctx, queryer, "", store.ID, "primary")
	if err != nil {
		return StoreRecord{}, err
	}
	store.StoreCoverImage, err = readStoreProfileMediaWithQuery(ctx, queryer, "", store.ID, "cover")
	if err != nil {
		return StoreRecord{}, err
	}
	return store, nil
}

// ReadIndependentPreviewSnapshotForOwner keeps ownership, relation model,
// independent publication, Store media and private Catalog on one read-only
// MVCC snapshot. A mid-request ownership transfer must not pair stale owner
// approval with another owner's newer Catalog or media.
func ReadIndependentPreviewSnapshotForOwner(ctx context.Context, db *sql.DB, storeID, partnerActorID string, limit int, cursor string) (StoreRecord, string, CatalogStoreOfferPage, error) {
	if db == nil {
		return StoreRecord{}, "", CatalogStoreOfferPage{}, ErrStoreNotFound
	}
	tx, err := db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	if err != nil {
		return StoreRecord{}, "", CatalogStoreOfferPage{}, err
	}
	defer func() { _ = tx.Rollback() }()

	store, err := readIndependentStoreOwnedByPartnerWithQueryer(ctx, tx, storeID, partnerActorID)
	if err != nil {
		return StoreRecord{}, "", CatalogStoreOfferPage{}, err
	}
	publication, _, err := independentStorePublicationForOwnerWithQueryer(ctx, tx, store.ID, partnerActorID)
	if err != nil {
		return StoreRecord{}, "", CatalogStoreOfferPage{}, err
	}
	page, err := listCatalogOfferPageWithQueryer(ctx, tx, store.ID, limit, cursor)
	if err != nil {
		return StoreRecord{}, "", CatalogStoreOfferPage{}, err
	}
	if err := tx.Commit(); err != nil {
		return StoreRecord{}, "", CatalogStoreOfferPage{}, fmt.Errorf("finish independent owner preview snapshot: %w", err)
	}
	return store, publication, page, nil
}
