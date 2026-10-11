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

var (
	ErrStoreTrashInvalid    = errors.New("invalid store trash request")
	ErrStoreTrashConflict   = errors.New("stale store trash version")
	ErrStoreTrashOpenOrders = errors.New("store has unfinished customer orders")
)

type DeletedStore struct {
	ID             string     `json:"id"`
	Name           string     `json:"name"`
	PartnerActorID string     `json:"partnerActorId"`
	Version        int        `json:"version"`
	DeletedAt      *time.Time `json:"deletedAt,omitempty"`
	DeletedBy      string     `json:"deletedBy,omitempty"`
	DeletionReason string     `json:"deletionReason,omitempty"`
}
type DeletedStorePage struct {
	Stores     []DeletedStore `json:"stores"`
	NextCursor string         `json:"nextCursor"`
}

func ListDeletedStores(ctx context.Context, db *sql.DB, limit int, rawCursor string) (DeletedStorePage, error) {
	if limit < 1 || limit > 50 || len(rawCursor) > 512 {
		return DeletedStorePage{}, ErrStoreTrashInvalid
	}
	var at any
	var id string
	if rawCursor != "" {
		payload, err := base64.RawURLEncoding.DecodeString(rawCursor)
		if err != nil {
			return DeletedStorePage{}, ErrStoreTrashInvalid
		}
		var cursor catalogTrashCursor
		if json.Unmarshal(payload, &cursor) != nil || cursor.At.IsZero() || cursor.ID == "" {
			return DeletedStorePage{}, ErrStoreTrashInvalid
		}
		at, id = cursor.At, cursor.ID
	}
	rows, err := db.QueryContext(ctx, "SELECT id,name,partner_actor_id,version,deleted_at,deleted_by,deletion_reason FROM dsh.stores WHERE deleted_at IS NOT NULL AND ($1::timestamptz IS NULL OR (deleted_at,id)<($1::timestamptz,$2::text)) ORDER BY deleted_at DESC,id DESC LIMIT $3", at, id, limit+1)
	if err != nil {
		return DeletedStorePage{}, err
	}
	defer rows.Close()
	items := make([]DeletedStore, 0, limit+1)
	for rows.Next() {
		var item DeletedStore
		if err = rows.Scan(&item.ID, &item.Name, &item.PartnerActorID, &item.Version, &item.DeletedAt, &item.DeletedBy, &item.DeletionReason); err != nil {
			return DeletedStorePage{}, err
		}
		items = append(items, item)
	}
	if err = rows.Err(); err != nil {
		return DeletedStorePage{}, err
	}
	page := DeletedStorePage{Stores: items}
	if len(items) > limit {
		page.Stores = items[:limit]
		last := page.Stores[len(page.Stores)-1]
		payload, _ := json.Marshal(catalogTrashCursor{At: *last.DeletedAt, ID: last.ID})
		page.NextCursor = base64.RawURLEncoding.EncodeToString(payload)
	}
	return page, nil
}

func SetStoreTrashed(ctx context.Context, db *sql.DB, storeID, actorID, reason, action, key string, version int) (DeletedStore, bool, error) {
	storeID, actorID, reason, key = strings.TrimSpace(storeID), strings.TrimSpace(actorID), strings.TrimSpace(reason), strings.TrimSpace(key)
	if storeID == "" || actorID == "" || len(actorID) > 128 || version < 1 || len(key) < 8 || len(key) > 128 || (action != "trash" && action != "restore") || (action == "trash" && (utf8.RuneCountInString(reason) < 5 || utf8.RuneCountInString(reason) > 500)) || (action == "restore" && reason != "") {
		return DeletedStore{}, false, ErrStoreTrashInvalid
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return DeletedStore{}, false, err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "store-trash:"+key); err != nil {
		return DeletedStore{}, false, err
	}
	var pastID, pastActor, pastAction, pastReason string
	var pastVersion, pastResult int
	err = tx.QueryRowContext(ctx, "SELECT store_id,actor_id,action,reason,expected_version,result_version FROM dsh.store_trash_audit WHERE idempotency_key=$1", key).Scan(&pastID, &pastActor, &pastAction, &pastReason, &pastVersion, &pastResult)
	if err == nil {
		if pastID != storeID || pastActor != actorID || pastAction != action || pastReason != reason || pastVersion != version {
			return DeletedStore{}, false, ErrCatalogIdempotencyConflict
		}
		item, e := readStoreTrash(ctx, tx, storeID)
		if e != nil {
			return DeletedStore{}, false, e
		}
		if item.Version != pastResult {
			return DeletedStore{}, false, ErrStoreTrashConflict
		}
		return item, true, tx.Commit()
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return DeletedStore{}, false, err
	}
	var actualVersion int
	var archived bool
	err = tx.QueryRowContext(ctx, "SELECT version,(deleted_at IS NOT NULL) FROM dsh.stores WHERE id=$1 FOR UPDATE", storeID).Scan(&actualVersion, &archived)
	if errors.Is(err, sql.ErrNoRows) {
		return DeletedStore{}, false, ErrStoreNotFound
	}
	if err != nil {
		return DeletedStore{}, false, err
	}
	if actualVersion != version || (action == "trash" && archived) || (action == "restore" && !archived) {
		return DeletedStore{}, false, ErrStoreTrashConflict
	}
	if action == "trash" {
		// Prevent archiving a store while customers still have active orders.
		var openOrders bool
		if err = tx.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM dsh.commerce_orders WHERE store_id=$1 AND state NOT IN ('DELIVERED','PICKED_UP','REJECTED','CANCELLED'))", storeID).Scan(&openOrders); err != nil {
			return DeletedStore{}, false, err
		}
		if openOrders {
			return DeletedStore{}, false, ErrStoreTrashOpenOrders
		}
		// Atomically hide public discovery before setting the recoverable deletion marker.
		_, err = tx.ExecContext(ctx, "UPDATE dsh.stores SET publication_state='hidden',publication_changed_at=clock_timestamp(),deleted_at=clock_timestamp(),deleted_by=$2,deletion_reason=$3,version=version+1,updated_at=clock_timestamp() WHERE id=$1", storeID, actorID, reason)
	} else {
		// Recovery stays hidden; the existing publication readiness guard controls re-publication.
		_, err = tx.ExecContext(ctx, "UPDATE dsh.stores SET deleted_at=NULL,deleted_by=NULL,deletion_reason=NULL,version=version+1,updated_at=clock_timestamp() WHERE id=$1", storeID)
	}
	if err != nil {
		return DeletedStore{}, false, err
	}
	_, err = tx.ExecContext(ctx, "INSERT INTO dsh.store_trash_audit(idempotency_key,store_id,actor_id,action,reason,expected_version,result_version) VALUES($1,$2,$3,$4,$5,$6,$7)", key, storeID, actorID, action, reason, version, version+1)
	if err != nil {
		return DeletedStore{}, false, err
	}
	item, err := readStoreTrash(ctx, tx, storeID)
	if err != nil {
		return DeletedStore{}, false, err
	}
	return item, false, tx.Commit()
}

func readStoreTrash(ctx context.Context, tx *sql.Tx, id string) (DeletedStore, error) {
	var item DeletedStore
	var deleted sql.NullTime
	var actor, reason sql.NullString
	err := tx.QueryRowContext(ctx, "SELECT id,name,partner_actor_id,version,deleted_at,deleted_by,deletion_reason FROM dsh.stores WHERE id=$1", id).Scan(&item.ID, &item.Name, &item.PartnerActorID, &item.Version, &deleted, &actor, &reason)
	if errors.Is(err, sql.ErrNoRows) {
		return DeletedStore{}, ErrStoreNotFound
	}
	if err != nil {
		return DeletedStore{}, err
	}
	if deleted.Valid {
		item.DeletedAt = &deleted.Time
	}
	item.DeletedBy, item.DeletionReason = actor.String, reason.String
	return item, nil
}
