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

var ErrCatalogCategoryTrashHasChildren = errors.New("move subcategories before deleting their parent category")

type DeletedCatalogCategory struct {
	ID             string     `json:"id"`
	VerticalID     string     `json:"verticalId"`
	NameAr         string     `json:"nameAr"`
	Version        int        `json:"version"`
	DeletedAt      *time.Time `json:"deletedAt,omitempty"`
	DeletedBy      string     `json:"deletedBy,omitempty"`
	DeletionReason string     `json:"deletionReason,omitempty"`
}
type DeletedCatalogCategoryPage struct {
	Categories []DeletedCatalogCategory `json:"categories"`
	NextCursor string                   `json:"nextCursor"`
}

func ListDeletedCatalogCategories(ctx context.Context, db *sql.DB, limit int, cursor string) (DeletedCatalogCategoryPage, error) {
	if limit < 1 || limit > 100 || len(cursor) > 512 {
		return DeletedCatalogCategoryPage{}, ErrCatalogTrashInvalid
	}
	var at any
	var id string
	if cursor != "" {
		data, err := decodeCatalogCategoryTrashCursor(cursor)
		if err != nil {
			return DeletedCatalogCategoryPage{}, ErrCatalogTrashInvalid
		}
		at, id = data.At, data.ID
	}
	rows, err := db.QueryContext(ctx, "SELECT id,vertical_id,name_ar,version,deleted_at,deleted_by,deletion_reason FROM dsh.catalog_categories WHERE deleted_at IS NOT NULL AND ($1::timestamptz IS NULL OR (deleted_at,id)<($1::timestamptz,$2::text)) ORDER BY deleted_at DESC,id DESC LIMIT $3", at, id, limit+1)
	if err != nil {
		return DeletedCatalogCategoryPage{}, err
	}
	defer rows.Close()
	items := make([]DeletedCatalogCategory, 0, limit+1)
	for rows.Next() {
		var item DeletedCatalogCategory
		if err = rows.Scan(&item.ID, &item.VerticalID, &item.NameAr, &item.Version, &item.DeletedAt, &item.DeletedBy, &item.DeletionReason); err != nil {
			return DeletedCatalogCategoryPage{}, err
		}
		items = append(items, item)
	}
	if err = rows.Err(); err != nil {
		return DeletedCatalogCategoryPage{}, err
	}
	page := DeletedCatalogCategoryPage{Categories: items}
	if len(items) > limit {
		page.Categories = items[:limit]
		last := page.Categories[len(page.Categories)-1]
		payload, _ := json.Marshal(catalogTrashCursor{At: *last.DeletedAt, ID: last.ID})
		page.NextCursor = base64.RawURLEncoding.EncodeToString(payload)
	}
	return page, nil
}

func decodeCatalogCategoryTrashCursor(raw string) (catalogTrashCursor, error) {
	bytes, err := base64.RawURLEncoding.DecodeString(raw)
	if err != nil {
		return catalogTrashCursor{}, ErrCatalogTrashInvalid
	}
	var cursor catalogTrashCursor
	if json.Unmarshal(bytes, &cursor) != nil || cursor.ID == "" || cursor.At.IsZero() {
		return catalogTrashCursor{}, ErrCatalogTrashInvalid
	}
	return cursor, nil
}

func SetCatalogCategoryTrashed(ctx context.Context, db *sql.DB, categoryID, actorID, reason, action, key string, version int) (DeletedCatalogCategory, bool, error) {
	categoryID, actorID, reason, key = strings.TrimSpace(categoryID), strings.TrimSpace(actorID), strings.TrimSpace(reason), strings.TrimSpace(key)
	if categoryID == "" || actorID == "" || len(actorID) > 128 || version < 1 || len(key) < 8 || len(key) > 128 || (action != "trash" && action != "restore") || (action == "trash" && (utf8.RuneCountInString(reason) < 5 || utf8.RuneCountInString(reason) > 500)) || (action == "restore" && reason != "") {
		return DeletedCatalogCategory{}, false, ErrCatalogTrashInvalid
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return DeletedCatalogCategory{}, false, err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "category-trash:"+key); err != nil {
		return DeletedCatalogCategory{}, false, err
	}
	var pastID, pastActor, pastAction, pastReason string
	var pastVersion, pastResult int
	err = tx.QueryRowContext(ctx, "SELECT category_id,actor_id,action,reason,expected_version,result_version FROM dsh.catalog_category_trash_audit WHERE idempotency_key=$1", key).Scan(&pastID, &pastActor, &pastAction, &pastReason, &pastVersion, &pastResult)
	if err == nil {
		if pastID != categoryID || pastActor != actorID || pastAction != action || pastReason != reason || pastVersion != version {
			return DeletedCatalogCategory{}, false, ErrCatalogIdempotencyConflict
		}
		if action == "trash" {
			item, e := readDeletedCategory(ctx, tx, categoryID)
			if e != nil {
				return DeletedCatalogCategory{}, false, e
			}
			if item.Version != pastResult {
				return DeletedCatalogCategory{}, false, ErrCatalogVersionConflict
			}
			return item, true, tx.Commit()
		}
		var actual int
		if e := tx.QueryRowContext(ctx, "SELECT version FROM dsh.catalog_categories WHERE id=$1 AND deleted_at IS NULL", categoryID).Scan(&actual); e != nil {
			return DeletedCatalogCategory{}, false, ErrCatalogVersionConflict
		}
		if actual != pastResult {
			return DeletedCatalogCategory{}, false, ErrCatalogVersionConflict
		}
		return DeletedCatalogCategory{ID: categoryID, Version: actual}, true, tx.Commit()
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return DeletedCatalogCategory{}, false, err
	}
	var currentVersion int
	var currentlyDeleted bool
	err = tx.QueryRowContext(ctx, "SELECT version,(deleted_at IS NOT NULL) FROM dsh.catalog_categories WHERE id=$1 FOR UPDATE", categoryID).Scan(&currentVersion, &currentlyDeleted)
	if errors.Is(err, sql.ErrNoRows) {
		return DeletedCatalogCategory{}, false, ErrCatalogCategoryNotFound
	}
	if err != nil {
		return DeletedCatalogCategory{}, false, err
	}
	if currentVersion != version || (action == "trash" && currentlyDeleted) || (action == "restore" && !currentlyDeleted) {
		return DeletedCatalogCategory{}, false, ErrCatalogVersionConflict
	}
	if action == "trash" {
		var children bool
		if err = tx.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM dsh.catalog_categories WHERE parent_category_id=$1)", categoryID).Scan(&children); err != nil {
			return DeletedCatalogCategory{}, false, err
		}
		if children {
			return DeletedCatalogCategory{}, false, ErrCatalogCategoryTrashHasChildren
		}
		_, err = tx.ExecContext(ctx, "UPDATE dsh.catalog_categories SET active=false,deleted_at=clock_timestamp(),deleted_by=$2,deletion_reason=$3,version=version+1,updated_at=clock_timestamp() WHERE id=$1", categoryID, actorID, reason)
	} else {
		// Recovery does not automatically republish. Operators explicitly reactivate.
		_, err = tx.ExecContext(ctx, "UPDATE dsh.catalog_categories SET deleted_at=NULL,deleted_by=NULL,deletion_reason=NULL,version=version+1,updated_at=clock_timestamp() WHERE id=$1", categoryID)
	}
	if err != nil {
		return DeletedCatalogCategory{}, false, catalogRegistryNameWriteError(err)
	}
	_, err = tx.ExecContext(ctx, "INSERT INTO dsh.catalog_category_trash_audit(idempotency_key,category_id,actor_id,action,reason,expected_version,result_version) VALUES ($1,$2,$3,$4,$5,$6,$7)", key, categoryID, actorID, action, reason, version, version+1)
	if err != nil {
		return DeletedCatalogCategory{}, false, err
	}
	var item DeletedCatalogCategory
	if action == "trash" {
		item, err = readDeletedCategory(ctx, tx, categoryID)
		if err != nil {
			return DeletedCatalogCategory{}, false, err
		}
	} else {
		item.ID = categoryID
		item.Version = version + 1
	}
	return item, false, tx.Commit()
}

func readDeletedCategory(ctx context.Context, tx *sql.Tx, id string) (DeletedCatalogCategory, error) {
	var item DeletedCatalogCategory
	err := tx.QueryRowContext(ctx, "SELECT id,vertical_id,name_ar,version,deleted_at,deleted_by,deletion_reason FROM dsh.catalog_categories WHERE id=$1 AND deleted_at IS NOT NULL", id).Scan(&item.ID, &item.VerticalID, &item.NameAr, &item.Version, &item.DeletedAt, &item.DeletedBy, &item.DeletionReason)
	if errors.Is(err, sql.ErrNoRows) {
		return DeletedCatalogCategory{}, ErrCatalogCategoryNotFound
	}
	return item, err
}
