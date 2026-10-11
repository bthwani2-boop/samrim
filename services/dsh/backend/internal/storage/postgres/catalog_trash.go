package postgres

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"time"
	"unicode/utf8"
)

var ErrCatalogTrashInvalid = errors.New("invalid catalog trash operation")

type DeletedCatalogProduct struct {
	ID             string     `json:"id"`
	StoreID        string     `json:"storeId,omitempty"`
	CanonicalName  string     `json:"canonicalName"`
	Version        int        `json:"version"`
	DeletedAt      *time.Time `json:"deletedAt,omitempty"`
	DeletedBy      string     `json:"deletedBy,omitempty"`
	DeletionReason string     `json:"deletionReason,omitempty"`
}

type DeletedCatalogProductPage struct {
	Products   []DeletedCatalogProduct `json:"products"`
	NextCursor string                  `json:"nextCursor"`
}

type catalogTrashCursor struct {
	At time.Time `json:"at"`
	ID string    `json:"id"`
}

func ListDeletedCatalogProducts(ctx context.Context, db *sql.DB, limit int, rawCursor string) (DeletedCatalogProductPage, error) {
	return listDeletedCatalogProducts(ctx, db, "", limit, rawCursor)
}

func ListDeletedCatalogProductsForStore(ctx context.Context, db *sql.DB, storeID string, limit int, rawCursor string) (DeletedCatalogProductPage, error) {
	if strings.TrimSpace(storeID) == "" {
		return DeletedCatalogProductPage{}, ErrCatalogTrashInvalid
	}
	return listDeletedCatalogProducts(ctx, db, strings.TrimSpace(storeID), limit, rawCursor)
}

func listDeletedCatalogProducts(ctx context.Context, db *sql.DB, storeID string, limit int, rawCursor string) (DeletedCatalogProductPage, error) {
	if limit < 1 || limit > 100 || len(rawCursor) > 512 {
		return DeletedCatalogProductPage{}, ErrCatalogTrashInvalid
	}
	var at any
	var id string
	if rawCursor != "" {
		payload, err := base64.RawURLEncoding.DecodeString(rawCursor)
		if err != nil {
			return DeletedCatalogProductPage{}, ErrCatalogTrashInvalid
		}
		var cursor catalogTrashCursor
		if json.Unmarshal(payload, &cursor) != nil || cursor.At.IsZero() || cursor.ID == "" {
			return DeletedCatalogProductPage{}, ErrCatalogTrashInvalid
		}
		at, id = cursor.At, cursor.ID
	}
	rows, err := db.QueryContext(ctx, "SELECT id,COALESCE(store_id,''),canonical_name,version,deleted_at,deleted_by,deletion_reason FROM dsh.catalog_products WHERE (($4='' AND scope='SHARED') OR ($4<>'' AND scope='STORE_SCOPED' AND store_id=$4)) AND deleted_at IS NOT NULL AND ($1::timestamptz IS NULL OR (deleted_at,id)<($1::timestamptz,$2::text)) ORDER BY deleted_at DESC,id DESC LIMIT $3", at, id, limit+1, storeID)
	if err != nil {
		return DeletedCatalogProductPage{}, err
	}
	defer rows.Close()
	items := make([]DeletedCatalogProduct, 0, limit+1)
	for rows.Next() {
		var item DeletedCatalogProduct
		if err := rows.Scan(&item.ID, &item.StoreID, &item.CanonicalName, &item.Version, &item.DeletedAt, &item.DeletedBy, &item.DeletionReason); err != nil {
			return DeletedCatalogProductPage{}, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return DeletedCatalogProductPage{}, err
	}
	page := DeletedCatalogProductPage{Products: items}
	if len(items) > limit {
		page.Products = items[:limit]
		last := page.Products[len(page.Products)-1]
		encoded, err := json.Marshal(catalogTrashCursor{At: *last.DeletedAt, ID: last.ID})
		if err != nil {
			return DeletedCatalogProductPage{}, err
		}
		page.NextCursor = base64.RawURLEncoding.EncodeToString(encoded)
	}
	return page, nil
}

func SetCatalogProductTrashed(ctx context.Context, db *sql.DB, productID, actorID, reason, action, idempotencyKey string, expectedVersion int) (DeletedCatalogProduct, bool, error) {
	return setCatalogProductTrashed(ctx, db, productID, "", actorID, reason, action, idempotencyKey, expectedVersion)
}

func SetStoreScopedProductTrashed(ctx context.Context, db *sql.DB, storeID, productID, actorID, reason, action, idempotencyKey string, expectedVersion int) (DeletedCatalogProduct, bool, error) {
	if strings.TrimSpace(storeID) == "" {
		return DeletedCatalogProduct{}, false, ErrCatalogTrashInvalid
	}
	return setCatalogProductTrashed(ctx, db, productID, strings.TrimSpace(storeID), actorID, reason, action, idempotencyKey, expectedVersion)
}

func setCatalogProductTrashed(ctx context.Context, db *sql.DB, productID, storeID, actorID, reason, action, idempotencyKey string, expectedVersion int) (DeletedCatalogProduct, bool, error) {
	productID, actorID, reason, idempotencyKey = strings.TrimSpace(productID), strings.TrimSpace(actorID), strings.TrimSpace(reason), strings.TrimSpace(idempotencyKey)
	if productID == "" || actorID == "" || expectedVersion < 1 || len(idempotencyKey) < 8 || len(idempotencyKey) > 128 || (action != "trash" && action != "restore") || (action == "trash" && (utf8.RuneCountInString(reason) < 5 || utf8.RuneCountInString(reason) > 500)) || (action == "restore" && reason != "") {
		return DeletedCatalogProduct{}, false, ErrCatalogTrashInvalid
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return DeletedCatalogProduct{}, false, err
	}
	defer tx.Rollback()
	// Serialize concurrent attempts sharing one idempotency key across service instances.
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "catalog-trash:"+idempotencyKey); err != nil {
		return DeletedCatalogProduct{}, false, err
	}
	var pastID, pastActor, pastAction, pastReason string
	var pastVersion, pastResultVersion int
	err = tx.QueryRowContext(ctx, "SELECT product_id,actor_id,action,reason,expected_version,result_version FROM dsh.catalog_product_trash_audit WHERE idempotency_key=$1", idempotencyKey).Scan(&pastID, &pastActor, &pastAction, &pastReason, &pastVersion, &pastResultVersion)
	if err == nil {
		if pastID != productID || pastActor != actorID || pastAction != action || pastReason != reason || pastVersion != expectedVersion {
			return DeletedCatalogProduct{}, false, ErrCatalogIdempotencyConflict
		}
		item, err := readCatalogTrashProduct(ctx, tx, productID, storeID)
		if err == nil && item.Version != pastResultVersion {
			return DeletedCatalogProduct{}, false, ErrCatalogVersionConflict
		}
		if err != nil {
			return DeletedCatalogProduct{}, false, err
		}
		return item, true, tx.Commit()
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return DeletedCatalogProduct{}, false, err
	}
	var version int
	switch action {
	case "trash":
		err = tx.QueryRowContext(ctx, "UPDATE dsh.catalog_products SET deleted_at=clock_timestamp(),deleted_by=$3,deletion_reason=$4,version=version+1,updated_at=clock_timestamp() WHERE id=$1 AND version=$2 AND (($5='' AND scope='SHARED') OR ($5<>'' AND scope='STORE_SCOPED' AND store_id=$5)) AND deleted_at IS NULL RETURNING version", productID, expectedVersion, actorID, reason, storeID).Scan(&version)
	case "restore":
		err = tx.QueryRowContext(ctx, "UPDATE dsh.catalog_products SET deleted_at=NULL,deleted_by=NULL,deletion_reason=NULL,version=version+1,updated_at=clock_timestamp() WHERE id=$1 AND version=$2 AND (($3='' AND scope='SHARED') OR ($3<>'' AND scope='STORE_SCOPED' AND store_id=$3)) AND deleted_at IS NOT NULL RETURNING version", productID, expectedVersion, storeID).Scan(&version)
	}
	if errors.Is(err, sql.ErrNoRows) {
		var found int
		if findErr := tx.QueryRowContext(ctx, "SELECT 1 FROM dsh.catalog_products WHERE id=$1 AND (($2='' AND scope='SHARED') OR ($2<>'' AND scope='STORE_SCOPED' AND store_id=$2))", productID, storeID).Scan(&found); errors.Is(findErr, sql.ErrNoRows) {
			return DeletedCatalogProduct{}, false, ErrCatalogProductNotFound
		} else if findErr != nil {
			return DeletedCatalogProduct{}, false, findErr
		}
		return DeletedCatalogProduct{}, false, ErrCatalogVersionConflict
	}
	if err != nil {
		return DeletedCatalogProduct{}, false, err
	}
	if _, err := tx.ExecContext(ctx, "INSERT INTO dsh.catalog_product_trash_audit(idempotency_key,product_id,actor_id,action,reason,expected_version,result_version) VALUES ($1,$2,$3,$4,$5,$6,$7)", idempotencyKey, productID, actorID, action, reason, expectedVersion, version); err != nil {
		return DeletedCatalogProduct{}, false, err
	}
	item, err := readCatalogTrashProduct(ctx, tx, productID, storeID)
	if err != nil {
		return DeletedCatalogProduct{}, false, err
	}
	return item, false, tx.Commit()
}

func readCatalogTrashProduct(ctx context.Context, tx *sql.Tx, id, storeID string) (DeletedCatalogProduct, error) {
	var item DeletedCatalogProduct
	var deleted sql.NullTime
	var actor, reason sql.NullString
	err := tx.QueryRowContext(ctx, "SELECT id,COALESCE(store_id,''),canonical_name,version,deleted_at,deleted_by,deletion_reason FROM dsh.catalog_products WHERE id=$1 AND (($2='' AND scope='SHARED') OR ($2<>'' AND scope='STORE_SCOPED' AND store_id=$2))", id, storeID).Scan(&item.ID, &item.StoreID, &item.CanonicalName, &item.Version, &deleted, &actor, &reason)
	if errors.Is(err, sql.ErrNoRows) {
		return DeletedCatalogProduct{}, ErrCatalogProductNotFound
	}
	if err != nil {
		return DeletedCatalogProduct{}, err
	}
	if deleted.Valid {
		item.DeletedAt = &deleted.Time
	}
	item.DeletedBy, item.DeletionReason = actor.String, reason.String
	return item, nil
}
