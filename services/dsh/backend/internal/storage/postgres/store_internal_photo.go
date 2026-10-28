package postgres

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"
)

type StoreInternalPhotoSummary struct {
	ID          string    `json:"id"`
	ContentType string    `json:"contentType"`
	CreatedAt   time.Time `json:"createdAt"`
}

const maxStoreInternalPhotos = 20

func AttachStoreInternalPhotosToStoreTx(ctx context.Context, tx *sql.Tx, caseID, storeID string) error {
	if tx == nil || strings.TrimSpace(caseID) == "" || strings.TrimSpace(storeID) == "" {
		return ErrStoreProfileMediaInvalid
	}
	_, err := tx.ExecContext(ctx, "UPDATE dsh.store_internal_photos SET store_id=$2 WHERE joining_case_id=$1 AND store_id IS NULL", strings.TrimSpace(caseID), strings.TrimSpace(storeID))
	return err
}

func ReadStoreInternalPhotoForOperator(ctx context.Context, db *sql.DB, storeID, photoID string) ([]byte, string, error) {
	if db == nil || strings.TrimSpace(storeID) == "" || strings.TrimSpace(photoID) == "" {
		return nil, "", ErrStoreNotFound
	}
	var data []byte
	var contentType string
	err := db.QueryRowContext(ctx, "SELECT image_bytes,content_type FROM dsh.store_internal_photos WHERE store_id=$1 AND id=$2", strings.TrimSpace(storeID), strings.TrimSpace(photoID)).Scan(&data, &contentType)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, "", ErrStoreNotFound
	}
	if err != nil {
		return nil, "", fmt.Errorf("read private Store Field photo: %w", err)
	}
	return data, contentType, nil
}

func ListStoreInternalPhotosForOperator(ctx context.Context, db *sql.DB, storeID string) ([]StoreInternalPhotoSummary, error) {
	if db == nil || strings.TrimSpace(storeID) == "" {
		return nil, ErrStoreNotFound
	}
	rows, err := db.QueryContext(ctx, "SELECT id,content_type,created_at FROM dsh.store_internal_photos WHERE store_id=$1 ORDER BY created_at DESC,id", strings.TrimSpace(storeID))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	photos := make([]StoreInternalPhotoSummary, 0, maxStoreInternalPhotos)
	for rows.Next() {
		var photo StoreInternalPhotoSummary
		if err := rows.Scan(&photo.ID, &photo.ContentType, &photo.CreatedAt); err != nil {
			return nil, err
		}
		photos = append(photos, photo)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return photos, nil
}

func CountStoreInternalPhotos(ctx context.Context, db *sql.DB, caseID string) (int, error) {
	var count int
	if db == nil {
		return 0, errors.New("DSH database is nil")
	}
	err := db.QueryRowContext(ctx, "SELECT count(*) FROM dsh.store_internal_photos WHERE joining_case_id=$1", strings.TrimSpace(caseID)).Scan(&count)
	return count, err
}
