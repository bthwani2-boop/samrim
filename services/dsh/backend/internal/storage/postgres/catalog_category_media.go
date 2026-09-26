package postgres

import (
	"context"
	"database/sql"
	"errors"
	"strings"
)

type CatalogCategoryMediaAssetInput struct {
	ID, CategoryID, IdempotencyKey, ObjectKey, URI string
	ContentSHA256, ContentType, Reason             string
	ExpectedVersion                                int
	ByteSize                                       int64
}

type CatalogCategoryMediaAssetRecord struct {
	ID, CategoryID, IdempotencyKey, ObjectKey, URI string
	ContentSHA256, ContentType, State              string
	ExpectedVersion                                int
	ByteSize, CleanupAttempts                      int64
	LastCleanupError                               *string
}

func ReadCatalogCategory(ctx context.Context, db *sql.DB, categoryID string) (CatalogCategoryRecord, error) {
	var item CatalogCategoryRecord
	var parent sql.NullString
	err := db.QueryRowContext(ctx, "SELECT id,vertical_id,parent_category_id,name_ar,name_en,COALESCE(image_uri,''),active,version,created_at,updated_at FROM dsh.catalog_categories WHERE id=$1", strings.TrimSpace(categoryID)).Scan(&item.ID, &item.VerticalID, &parent, &item.NameAr, &item.NameEn, &item.ImageURI, &item.Active, &item.Version, &item.CreatedAt, &item.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return CatalogCategoryRecord{}, ErrCatalogCategoryNotFound
	}
	if parent.Valid {
		item.ParentCategoryID = parent.String
	}
	return item, err
}

func RegisterCatalogCategoryMediaAssetPending(ctx context.Context, db *sql.DB, asset CatalogCategoryMediaAssetInput) (CatalogCategoryMediaAssetRecord, bool, error) {
	if strings.TrimSpace(asset.ID) == "" || strings.TrimSpace(asset.CategoryID) == "" || strings.TrimSpace(asset.IdempotencyKey) == "" || strings.TrimSpace(asset.ObjectKey) == "" || strings.TrimSpace(asset.URI) == "" || asset.ExpectedVersion < 1 || len(asset.ContentSHA256) != 64 || asset.ByteSize < 1 || asset.ByteSize > 10485760 || (asset.ContentType != "image/jpeg" && asset.ContentType != "image/png") {
		return CatalogCategoryMediaAssetRecord{}, false, ErrCatalogMediaInvalid
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return CatalogCategoryMediaAssetRecord{}, false, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err = tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "dsh:catalog-category-media:idempotency:"+asset.IdempotencyKey); err != nil {
		return CatalogCategoryMediaAssetRecord{}, false, err
	}
	stored, err := readCatalogCategoryMediaAssetByIdempotencyTx(ctx, tx, asset.IdempotencyKey)
	if err == nil {
		if stored.CategoryID != asset.CategoryID || stored.ExpectedVersion != asset.ExpectedVersion || stored.ObjectKey != asset.ObjectKey || stored.URI != asset.URI || stored.ContentSHA256 != asset.ContentSHA256 || stored.ContentType != asset.ContentType || stored.ByteSize != asset.ByteSize {
			return CatalogCategoryMediaAssetRecord{}, false, ErrCatalogIdempotencyConflict
		}
		if stored.State == "failed" {
			if _, err = tx.ExecContext(ctx, "UPDATE dsh.catalog_category_media_assets SET state='pending',last_cleanup_error=NULL WHERE id=$1", stored.ID); err != nil {
				return CatalogCategoryMediaAssetRecord{}, false, err
			}
			stored.State = "pending"
		}
		if err = tx.Commit(); err != nil {
			return CatalogCategoryMediaAssetRecord{}, false, err
		}
		return stored, stored.State == "active", nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return CatalogCategoryMediaAssetRecord{}, false, err
	}
	category, err := readCatalogCategoryForUpdateTx(ctx, tx, asset.CategoryID)
	if err != nil {
		return CatalogCategoryMediaAssetRecord{}, false, err
	}
	if !category.Active {
		return CatalogCategoryMediaAssetRecord{}, false, ErrCatalogCategoryNotFound
	}
	if err = requireSharedActiveCategoryVerticalTx(ctx, tx, asset.CategoryID); err != nil {
		return CatalogCategoryMediaAssetRecord{}, false, err
	}
	if category.Version != asset.ExpectedVersion {
		return CatalogCategoryMediaAssetRecord{}, false, ErrCatalogVersionConflict
	}
	if _, err = tx.ExecContext(ctx, "INSERT INTO dsh.catalog_category_media_assets(id,category_id,idempotency_key,expected_version,object_key,uri,content_sha256,content_type,byte_size,state) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending')", asset.ID, asset.CategoryID, asset.IdempotencyKey, asset.ExpectedVersion, asset.ObjectKey, asset.URI, asset.ContentSHA256, asset.ContentType, asset.ByteSize); err != nil {
		return CatalogCategoryMediaAssetRecord{}, false, err
	}
	if err = tx.Commit(); err != nil {
		return CatalogCategoryMediaAssetRecord{}, false, err
	}
	return CatalogCategoryMediaAssetRecord{ID: asset.ID, CategoryID: asset.CategoryID, IdempotencyKey: asset.IdempotencyKey, ExpectedVersion: asset.ExpectedVersion, ObjectKey: asset.ObjectKey, URI: asset.URI, ContentSHA256: asset.ContentSHA256, ContentType: asset.ContentType, ByteSize: asset.ByteSize, State: "pending"}, false, nil
}

func AttachCatalogCategoryMediaAsset(ctx context.Context, db *sql.DB, asset CatalogCategoryMediaAssetInput, actingActorID, correlationID string) (CatalogCategoryRecord, bool, error) {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return CatalogCategoryRecord{}, false, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err = tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "dsh:catalog-category-media:idempotency:"+asset.IdempotencyKey); err != nil {
		return CatalogCategoryRecord{}, false, err
	}
	registered, err := readCatalogCategoryMediaAssetByIdempotencyTx(ctx, tx, asset.IdempotencyKey)
	if err != nil {
		return CatalogCategoryRecord{}, false, err
	}
	if registered.ID != asset.ID || registered.CategoryID != asset.CategoryID || registered.ExpectedVersion != asset.ExpectedVersion || registered.ObjectKey != asset.ObjectKey || registered.URI != asset.URI || registered.ContentSHA256 != asset.ContentSHA256 || registered.ContentType != asset.ContentType || registered.ByteSize != asset.ByteSize || registered.State == "deleted" {
		return CatalogCategoryRecord{}, false, ErrCatalogMediaInvalid
	}
	category, err := readCatalogCategoryForUpdateTx(ctx, tx, asset.CategoryID)
	if err != nil {
		return CatalogCategoryRecord{}, false, err
	}
	if !category.Active {
		return CatalogCategoryRecord{}, false, ErrCatalogCategoryNotFound
	}
	if err = requireSharedActiveCategoryVerticalTx(ctx, tx, asset.CategoryID); err != nil {
		return CatalogCategoryRecord{}, false, err
	}
	if category.ImageURI == asset.URI && registered.State == "active" {
		if err = tx.Commit(); err != nil {
			return CatalogCategoryRecord{}, false, err
		}
		return category, true, nil
	}
	if category.Version != asset.ExpectedVersion {
		return CatalogCategoryRecord{}, false, ErrCatalogVersionConflict
	}
	if registered.State != "pending" {
		return CatalogCategoryRecord{}, false, ErrCatalogMediaInvalid
	}
	if _, err = tx.ExecContext(ctx, "UPDATE dsh.catalog_category_media_assets SET state='retired',retired_at=COALESCE(retired_at,clock_timestamp()),last_cleanup_error=NULL WHERE category_id=$1 AND state='active'", asset.CategoryID); err != nil {
		return CatalogCategoryRecord{}, false, err
	}
	result, err := tx.ExecContext(ctx, "UPDATE dsh.catalog_category_media_assets SET state='active',retired_at=NULL,cleaned_at=NULL,last_cleanup_error=NULL WHERE id=$1 AND category_id=$2 AND state='pending'", asset.ID, asset.CategoryID)
	if err != nil {
		return CatalogCategoryRecord{}, false, err
	}
	if affected, affectedErr := result.RowsAffected(); affectedErr != nil || affected != 1 {
		return CatalogCategoryRecord{}, false, ErrCatalogMediaInvalid
	}
	result, err = tx.ExecContext(ctx, "UPDATE dsh.catalog_categories SET image_uri=$2,version=version+1,updated_at=clock_timestamp() WHERE id=$1 AND version=$3", asset.CategoryID, asset.URI, asset.ExpectedVersion)
	if err != nil {
		return CatalogCategoryRecord{}, false, err
	}
	if affected, affectedErr := result.RowsAffected(); affectedErr != nil || affected != 1 {
		return CatalogCategoryRecord{}, false, ErrCatalogVersionConflict
	}
	after, err := readCatalogCategoryTx(ctx, tx, asset.CategoryID)
	if err != nil {
		return CatalogCategoryRecord{}, false, err
	}
	if err = writeCatalogRegistryAudit(ctx, tx, CatalogRegistryAuditInput{EntityType: "category", EntityID: asset.CategoryID, Action: "UPDATED", ActingActorID: actingActorID, CorrelationID: correlationID, Reason: asset.Reason, ExpectedVersion: category.Version, ResultingVersion: after.Version, BeforeState: category, AfterState: after}); err != nil {
		return CatalogCategoryRecord{}, false, err
	}
	if err = tx.Commit(); err != nil {
		return CatalogCategoryRecord{}, false, err
	}
	return after, false, nil
}

func ListCatalogCategoryMediaAssetsForCleanup(ctx context.Context, db *sql.DB, limit int) ([]CatalogCategoryMediaAssetRecord, error) {
	if limit < 1 || limit > 100 {
		limit = 100
	}
	rows, err := db.QueryContext(ctx, "SELECT id,category_id,idempotency_key,expected_version,object_key,uri,content_sha256,content_type,byte_size,state,cleanup_attempts,last_cleanup_error FROM dsh.catalog_category_media_assets WHERE state IN ('retired','failed') OR (state='pending' AND created_at < clock_timestamp() - interval '10 minutes') ORDER BY created_at ASC LIMIT $1", limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	assets := make([]CatalogCategoryMediaAssetRecord, 0)
	for rows.Next() {
		var asset CatalogCategoryMediaAssetRecord
		var lastError sql.NullString
		if err := rows.Scan(&asset.ID, &asset.CategoryID, &asset.IdempotencyKey, &asset.ExpectedVersion, &asset.ObjectKey, &asset.URI, &asset.ContentSHA256, &asset.ContentType, &asset.ByteSize, &asset.State, &asset.CleanupAttempts, &lastError); err != nil {
			return nil, err
		}
		if lastError.Valid {
			asset.LastCleanupError = &lastError.String
		}
		assets = append(assets, asset)
	}
	return assets, rows.Err()
}

func MarkCatalogCategoryMediaAssetFailed(ctx context.Context, db *sql.DB, assetID, message string) error {
	_, err := db.ExecContext(ctx, "UPDATE dsh.catalog_category_media_assets SET state='failed',cleanup_attempts=cleanup_attempts+1,last_cleanup_error=$2 WHERE id=$1 AND state<>'deleted'", assetID, strings.TrimSpace(message))
	return err
}

func MarkCatalogCategoryMediaAssetDeleted(ctx context.Context, db *sql.DB, assetID string) error {
	_, err := db.ExecContext(ctx, "UPDATE dsh.catalog_category_media_assets SET state='deleted',retired_at=COALESCE(retired_at,clock_timestamp()),cleaned_at=clock_timestamp(),cleanup_attempts=cleanup_attempts+1,last_cleanup_error=NULL WHERE id=$1 AND state IN ('retired','failed','pending')", assetID)
	return err
}

func MarkCatalogCategoryMediaAssetCleanupFailure(ctx context.Context, db *sql.DB, assetID, message string) error {
	_, err := db.ExecContext(ctx, "UPDATE dsh.catalog_category_media_assets SET cleanup_attempts=cleanup_attempts+1,last_cleanup_error=$2 WHERE id=$1 AND state IN ('retired','failed','pending')", assetID, strings.TrimSpace(message))
	return err
}

func readCatalogCategoryMediaAssetByIdempotencyTx(ctx context.Context, tx *sql.Tx, idempotencyKey string) (CatalogCategoryMediaAssetRecord, error) {
	var asset CatalogCategoryMediaAssetRecord
	var lastError sql.NullString
	err := tx.QueryRowContext(ctx, "SELECT id,category_id,idempotency_key,expected_version,object_key,uri,content_sha256,content_type,byte_size,state,cleanup_attempts,last_cleanup_error FROM dsh.catalog_category_media_assets WHERE idempotency_key=$1 FOR UPDATE", idempotencyKey).Scan(&asset.ID, &asset.CategoryID, &asset.IdempotencyKey, &asset.ExpectedVersion, &asset.ObjectKey, &asset.URI, &asset.ContentSHA256, &asset.ContentType, &asset.ByteSize, &asset.State, &asset.CleanupAttempts, &lastError)
	if lastError.Valid {
		asset.LastCleanupError = &lastError.String
	}
	return asset, err
}

func requireSharedActiveCategoryVerticalTx(ctx context.Context, tx *sql.Tx, categoryID string) error {
	var shared bool
	if err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM dsh.catalog_categories c JOIN dsh.commerce_verticals v ON v.id=c.vertical_id WHERE c.id=$1 AND c.active=true AND v.active=true AND v.catalog_model='SHARED_CATALOG')`, categoryID).Scan(&shared); err != nil {
		return err
	}
	if !shared {
		return ErrCatalogProductModelMismatch
	}
	return nil
}
