package postgres

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
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

func SaveStoreInternalPhoto(ctx context.Context, db *sql.DB, caseID, fieldActorID string, expectedVersion int, idempotencyKey, contentType string, data []byte) (JoiningCaseResult, error) {
	caseID, fieldActorID, idempotencyKey = strings.TrimSpace(caseID), strings.TrimSpace(fieldActorID), strings.TrimSpace(idempotencyKey)
	if db == nil || caseID == "" || fieldActorID == "" || len(idempotencyKey) < 8 || len(idempotencyKey) > 128 || expectedVersion < 1 || len(data) < 1 || len(data) > 10*1024*1024 || (contentType != "image/jpeg" && contentType != "image/png") {
		return JoiningCaseResult{}, ErrJoiningCaseState
	}
	digest := sha256.Sum256(data)
	contentSHA := hex.EncodeToString(digest[:])
	requestHash := sha256.Sum256([]byte(strings.Join([]string{"store-internal-photo", caseID, fieldActorID, fmt.Sprint(expectedVersion), contentType, contentSHA}, "\x00")))
	requestHashText := hex.EncodeToString(requestHash[:])
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return JoiningCaseResult{}, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", "dsh:store-internal-photo:idempotency:"+idempotencyKey); err != nil {
		return JoiningCaseResult{}, err
	}
	var existingCaseID, existingHash string
	err = tx.QueryRowContext(ctx, "SELECT joining_case_id,request_hash FROM dsh.store_internal_photos WHERE idempotency_key=$1", idempotencyKey).Scan(&existingCaseID, &existingHash)
	if err == nil {
		if existingCaseID != caseID || existingHash != requestHashText {
			return JoiningCaseResult{}, ErrStoreProfileMediaIdempotency
		}
		if err := tx.Commit(); err != nil {
			return JoiningCaseResult{}, err
		}
		result, err := ReadJoiningCaseForField(ctx, db, fieldActorID, caseID)
		result.Replayed = true
		return result, err
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return JoiningCaseResult{}, err
	}
	current, err := readJoiningCaseTx(ctx, tx, caseID)
	if err != nil {
		return JoiningCaseResult{}, err
	}
	if current.Case.Origin != "field" || current.Case.State != "draft" || current.Case.OriginatingFieldActorID != fieldActorID {
		return JoiningCaseResult{}, ErrJoiningCasePartnerAccess
	}
	if current.Case.Version != expectedVersion {
		return JoiningCaseResult{}, ErrJoiningCaseVersion
	}
	var count int
	if err := tx.QueryRowContext(ctx, "SELECT count(*) FROM dsh.store_internal_photos WHERE joining_case_id=$1", caseID).Scan(&count); err != nil {
		return JoiningCaseResult{}, err
	}
	if count >= maxStoreInternalPhotos {
		return JoiningCaseResult{}, ErrStoreInternalPhotoLimit
	}
	idDigest := sha256.Sum256([]byte(caseID + "\x00" + idempotencyKey))
	id := "store_internal_photo_" + hex.EncodeToString(idDigest[:])
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.store_internal_photos(id,joining_case_id,idempotency_key,request_hash,content_type,content_sha256,image_bytes,uploaded_by_field_actor_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, id, caseID, idempotencyKey, requestHashText, contentType, contentSHA, data, fieldActorID); err != nil {
		return JoiningCaseResult{}, fmt.Errorf("save private store field photo: %w", err)
	}
	if _, err := tx.ExecContext(ctx, "UPDATE dsh.joining_cases SET version=version+1,updated_at=clock_timestamp() WHERE id=$1 AND version=$2", caseID, expectedVersion); err != nil {
		return JoiningCaseResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return JoiningCaseResult{}, err
	}
	return ReadJoiningCaseForField(ctx, db, fieldActorID, caseID)
}

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
