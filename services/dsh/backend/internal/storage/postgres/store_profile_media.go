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

func HashStoreProfileMediaUploadRequest(caseID, contentSHA256 string, expectedVersion int) string {
	digest := sha256.Sum256([]byte("store-profile-image\x00" + strings.TrimSpace(caseID) + "\x00" + strings.TrimSpace(contentSHA256) + "\x00" + fmt.Sprint(expectedVersion)))
	return hex.EncodeToString(digest[:])
}

type StoreProfileMediaRecord struct {
	ID            string
	JoiningCaseID string
	StoreID       string
	URI           string
	ObjectKey     string
	ContentSHA256 string
	ContentType   string
	ByteSize      int64
	Role          string
	State         string
	CreatedAt     time.Time
	AttachedAt    *time.Time
}

type StoreProfileMediaCleanupAsset struct {
	ID, ObjectKey    string
	CleanupClaimedAt time.Time
}

type StoreProfileMediaAssetInput struct {
	ID, JoiningCaseID, IdempotencyKey, RequestHash, ObjectKey, URI string
	ExpectedCaseVersion                                            int
	ContentSHA256, ContentType, ActingActorID, CorrelationID       string
	ByteSize                                                       int64
}

type storeProfileMediaQueryer interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

var (
	ErrStoreProfileMediaInvalid     = errors.New("store profile media facts are invalid")
	ErrStoreProfileMediaNotFound    = errors.New("store profile media was not found")
	ErrStoreProfileMediaIdempotency = errors.New("store profile media idempotency key was already used with different facts")
	ErrStoreProfileMediaVersion     = errors.New("store profile media joining case version is stale")
	ErrStoreProfileMediaState       = errors.New("joining case does not allow store profile media changes")
	ErrStoreProfileMediaFailed      = errors.New("store profile media upload previously failed")
	ErrStoreProfileMediaCleanupBusy = errors.New("store profile media cleanup currently owns this upload")
)

func RegisterStoreProfileMediaAssetPending(ctx context.Context, db *sql.DB, input StoreProfileMediaAssetInput) (StoreProfileMediaRecord, bool, error) {
	if db == nil || strings.TrimSpace(input.ID) == "" || strings.TrimSpace(input.JoiningCaseID) == "" || strings.TrimSpace(input.IdempotencyKey) == "" || strings.TrimSpace(input.RequestHash) == "" || input.ExpectedCaseVersion < 1 || input.ByteSize < 1 || strings.TrimSpace(input.ObjectKey) == "" || strings.TrimSpace(input.URI) == "" || strings.TrimSpace(input.ContentSHA256) == "" || strings.TrimSpace(input.ContentType) == "" {
		return StoreProfileMediaRecord{}, false, ErrStoreProfileMediaInvalid
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return StoreProfileMediaRecord{}, false, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", "dsh:store-profile-media:idempotency:"+input.IdempotencyKey); err != nil {
		return StoreProfileMediaRecord{}, false, err
	}
	var record StoreProfileMediaRecord
	var storedHash string
	err = tx.QueryRowContext(ctx, `SELECT id,joining_case_id,COALESCE(store_id,''),uri,object_key,content_sha256,content_type,byte_size,media_role,state,created_at,attached_at,request_hash FROM dsh.store_profile_media_assets WHERE idempotency_key=$1 FOR UPDATE`, input.IdempotencyKey).Scan(&record.ID, &record.JoiningCaseID, &record.StoreID, &record.URI, &record.ObjectKey, &record.ContentSHA256, &record.ContentType, &record.ByteSize, &record.Role, &record.State, &record.CreatedAt, &record.AttachedAt, &storedHash)
	if err == nil {
		if record.JoiningCaseID != input.JoiningCaseID || record.URI != input.URI || record.ContentSHA256 != input.ContentSHA256 || record.ContentType != input.ContentType || record.ByteSize != input.ByteSize || storedHash != input.RequestHash {
			return StoreProfileMediaRecord{}, false, ErrStoreProfileMediaIdempotency
		}
		if record.State == "pending" {
			result, err := tx.ExecContext(ctx, `UPDATE dsh.store_profile_media_assets SET last_attempt_at=clock_timestamp() WHERE id=$1 AND state='pending' AND cleanup_claimed_at IS NULL`, record.ID)
			if err != nil {
				return StoreProfileMediaRecord{}, false, err
			}
			updated, err := result.RowsAffected()
			if err != nil {
				return StoreProfileMediaRecord{}, false, err
			}
			if updated == 0 {
				return StoreProfileMediaRecord{}, false, ErrStoreProfileMediaCleanupBusy
			}
		} else if record.State == "failed" {
			result, err := tx.ExecContext(ctx, `UPDATE dsh.store_profile_media_assets SET state='pending',last_attempt_at=clock_timestamp(),cleaned_at=NULL,last_upload_error=NULL WHERE id=$1 AND state='failed' AND cleanup_claimed_at IS NULL`, record.ID)
			if err != nil {
				return StoreProfileMediaRecord{}, false, err
			}
			updated, err := result.RowsAffected()
			if err != nil {
				return StoreProfileMediaRecord{}, false, err
			}
			if updated == 0 {
				return StoreProfileMediaRecord{}, false, ErrStoreProfileMediaCleanupBusy
			}
			record.State = "pending"
		}
		if err := tx.Commit(); err != nil {
			return StoreProfileMediaRecord{}, false, err
		}
		return record, true, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return StoreProfileMediaRecord{}, false, err
	}
	var caseState string
	var caseVersion int
	if err := tx.QueryRowContext(ctx, "SELECT state,version FROM dsh.joining_cases WHERE id=$1 FOR UPDATE", input.JoiningCaseID).Scan(&caseState, &caseVersion); errors.Is(err, sql.ErrNoRows) {
		return StoreProfileMediaRecord{}, false, ErrStoreProfileMediaNotFound
	} else if err != nil {
		return StoreProfileMediaRecord{}, false, err
	}
	if caseState != "draft" && caseState != "needs_correction" {
		return StoreProfileMediaRecord{}, false, ErrStoreProfileMediaState
	}
	if caseVersion != input.ExpectedCaseVersion {
		return StoreProfileMediaRecord{}, false, ErrStoreProfileMediaVersion
	}
	err = tx.QueryRowContext(ctx, `INSERT INTO dsh.store_profile_media_assets(id,joining_case_id,idempotency_key,request_hash,expected_case_version,object_key,uri,content_sha256,content_type,byte_size,media_role,state) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'primary','pending') RETURNING id,joining_case_id,'',uri,object_key,content_sha256,content_type,byte_size,media_role,state,created_at,attached_at`, input.ID, input.JoiningCaseID, input.IdempotencyKey, input.RequestHash, input.ExpectedCaseVersion, input.ObjectKey, input.URI, input.ContentSHA256, input.ContentType, input.ByteSize).Scan(&record.ID, &record.JoiningCaseID, &record.StoreID, &record.URI, &record.ObjectKey, &record.ContentSHA256, &record.ContentType, &record.ByteSize, &record.Role, &record.State, &record.CreatedAt, &record.AttachedAt)
	if err != nil {
		return StoreProfileMediaRecord{}, false, err
	}
	if err := tx.Commit(); err != nil {
		return StoreProfileMediaRecord{}, false, err
	}
	return record, false, nil
}

func ClaimStoreProfileMediaAssetsForCleanup(ctx context.Context, db *sql.DB, limit int) ([]StoreProfileMediaCleanupAsset, error) {
	if db == nil {
		return nil, errors.New("DSH database is nil")
	}
	if limit < 1 || limit > 500 {
		limit = 100
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()
	rows, err := tx.QueryContext(ctx, `SELECT id,object_key FROM dsh.store_profile_media_assets WHERE cleaned_at IS NULL AND (cleanup_claimed_at IS NULL OR cleanup_claimed_at < clock_timestamp() - interval '2 minutes') AND (state IN ('retired','failed') OR (state='pending' AND last_attempt_at < clock_timestamp() - interval '10 minutes')) ORDER BY created_at ASC LIMIT $1 FOR UPDATE SKIP LOCKED`, limit)
	if err != nil {
		return nil, err
	}
	assets := make([]StoreProfileMediaCleanupAsset, 0)
	for rows.Next() {
		var asset StoreProfileMediaCleanupAsset
		if err := rows.Scan(&asset.ID, &asset.ObjectKey); err != nil {
			return nil, err
		}
		assets = append(assets, asset)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return nil, err
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	for i := range assets {
		if err := tx.QueryRowContext(ctx, "UPDATE dsh.store_profile_media_assets SET cleanup_claimed_at=clock_timestamp() WHERE id=$1 RETURNING cleanup_claimed_at", assets[i].ID).Scan(&assets[i].CleanupClaimedAt); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return assets, nil
}

func MarkStoreProfileMediaAssetCleanupComplete(ctx context.Context, db *sql.DB, assetID string, claimTime time.Time) error {
	if db == nil || strings.TrimSpace(assetID) == "" || claimTime.IsZero() {
		return ErrStoreProfileMediaInvalid
	}
	result, err := db.ExecContext(ctx, `UPDATE dsh.store_profile_media_assets SET state=CASE WHEN state='pending' THEN 'failed' ELSE state END,cleaned_at=clock_timestamp(),cleanup_claimed_at=NULL,cleanup_attempts=cleanup_attempts+1,last_cleanup_error=NULL WHERE id=$1 AND state IN ('pending','failed','retired') AND cleaned_at IS NULL AND cleanup_claimed_at=$2`, strings.TrimSpace(assetID), claimTime)
	if err != nil {
		return err
	}
	updated, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if updated == 0 {
		return ErrStoreProfileMediaCleanupBusy
	}
	return nil
}

func MarkStoreProfileMediaAssetCleanupFailure(ctx context.Context, db *sql.DB, assetID string, claimTime time.Time, message string) error {
	if db == nil || strings.TrimSpace(assetID) == "" || claimTime.IsZero() {
		return ErrStoreProfileMediaInvalid
	}
	result, err := db.ExecContext(ctx, "UPDATE dsh.store_profile_media_assets SET cleanup_attempts=cleanup_attempts+1,last_cleanup_error=$3,cleanup_claimed_at=NULL WHERE id=$1 AND state IN ('pending','failed','retired') AND cleaned_at IS NULL AND cleanup_claimed_at=$2", strings.TrimSpace(assetID), claimTime, strings.TrimSpace(message))
	if err != nil {
		return err
	}
	updated, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if updated == 0 {
		return ErrStoreProfileMediaCleanupBusy
	}
	return nil
}

func ActivateStoreProfileMediaAsset(ctx context.Context, db *sql.DB, assetID, joiningCaseID string, expectedCaseVersion int, idempotencyKey, requestHash, actingActorID, correlationID string) (int, error) {
	if db == nil || strings.TrimSpace(assetID) == "" || strings.TrimSpace(joiningCaseID) == "" || expectedCaseVersion < 1 || strings.TrimSpace(idempotencyKey) == "" || strings.TrimSpace(requestHash) == "" || strings.TrimSpace(actingActorID) == "" || strings.TrimSpace(correlationID) == "" {
		return 0, ErrStoreProfileMediaInvalid
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer func() { _ = tx.Rollback() }()
	var storedCase, state, storedHash string
	var cleanupClaimedAt sql.NullTime
	if err := tx.QueryRowContext(ctx, "SELECT joining_case_id,state,request_hash,cleanup_claimed_at FROM dsh.store_profile_media_assets WHERE id=$1 FOR UPDATE", assetID).Scan(&storedCase, &state, &storedHash, &cleanupClaimedAt); errors.Is(err, sql.ErrNoRows) {
		return 0, ErrStoreProfileMediaNotFound
	} else if err != nil {
		return 0, err
	} else if storedCase != joiningCaseID || storedHash != requestHash {
		return 0, ErrStoreProfileMediaIdempotency
	}
	if cleanupClaimedAt.Valid {
		return 0, ErrStoreProfileMediaCleanupBusy
	}
	if state == "active" {
		var version int
		if err := tx.QueryRowContext(ctx, "SELECT version FROM dsh.joining_cases WHERE id=$1", joiningCaseID).Scan(&version); err != nil {
			return 0, err
		}
		if err := tx.Commit(); err != nil {
			return 0, err
		}
		return version, nil
	}
	var currentVersion int
	if err := tx.QueryRowContext(ctx, "SELECT version FROM dsh.joining_cases WHERE id=$1 FOR UPDATE", joiningCaseID).Scan(&currentVersion); err != nil {
		return 0, err
	}
	if currentVersion != expectedCaseVersion {
		return 0, ErrStoreProfileMediaVersion
	}
	var previousID sql.NullString
	if err := tx.QueryRowContext(ctx, "SELECT id FROM dsh.store_profile_media_assets WHERE joining_case_id=$1 AND state='active' AND id<>$2 FOR UPDATE", joiningCaseID, assetID).Scan(&previousID); err != nil && !errors.Is(err, sql.ErrNoRows) {
		return 0, err
	}
	if previousID.Valid {
		if _, err := tx.ExecContext(ctx, "UPDATE dsh.store_profile_media_assets SET state='retired',retired_at=clock_timestamp() WHERE id=$1", previousID.String); err != nil {
			return 0, err
		}
	}
	var version int
	if err := tx.QueryRowContext(ctx, "UPDATE dsh.store_profile_media_assets SET state='active',attached_at=clock_timestamp() WHERE id=$1 AND state='pending' RETURNING id", assetID).Scan(&assetID); err != nil {
		return 0, err
	}
	if err := tx.QueryRowContext(ctx, "UPDATE dsh.joining_cases SET version=version+1,updated_at=clock_timestamp() WHERE id=$1 AND version=$2 RETURNING version", joiningCaseID, expectedCaseVersion).Scan(&version); err != nil {
		return 0, ErrStoreProfileMediaVersion
	}
	event := "store_profile_image_attached"
	if previousID.Valid {
		event = "store_profile_image_replaced"
	}
	auditID := "store_profile_media_audit_" + assetID
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.store_profile_media_audit(id,event_type,idempotency_key,correlation_id,acting_actor_id,joining_case_id,result_version,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, auditID, event, idempotencyKey, correlationID, actingActorID, joiningCaseID, version, requestHash); err != nil {
		return 0, err
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return version, nil
}

func MarkStoreProfileMediaAssetFailed(ctx context.Context, db *sql.DB, assetID, reason string) error {
	if db == nil || strings.TrimSpace(assetID) == "" {
		return ErrStoreProfileMediaInvalid
	}
	_, err := db.ExecContext(ctx, "UPDATE dsh.store_profile_media_assets SET state='failed',last_upload_error=$2 WHERE id=$1 AND state='pending'", assetID, strings.TrimSpace(reason))
	return err
}

func ReadStoreProfileMedia(ctx context.Context, db *sql.DB, joiningCaseID, storeID string) (*StoreProfileMediaRecord, error) {
	if db == nil {
		return nil, errors.New("DSH database is nil")
	}
	joiningCaseID = strings.TrimSpace(joiningCaseID)
	storeID = strings.TrimSpace(storeID)
	if joiningCaseID == "" && storeID == "" {
		return nil, nil
	}
	record, err := readStoreProfileMediaWithQuery(ctx, db, joiningCaseID, storeID)
	if err != nil {
		return nil, err
	}
	return record, nil
}

func readStoreProfileMediaWithQuery(ctx context.Context, queryer storeProfileMediaQueryer, joiningCaseID, storeID string) (*StoreProfileMediaRecord, error) {
	joiningCaseID = strings.TrimSpace(joiningCaseID)
	storeID = strings.TrimSpace(storeID)
	if joiningCaseID == "" && storeID == "" {
		return nil, nil
	}
	record := StoreProfileMediaRecord{}
	err := queryer.QueryRowContext(ctx, `SELECT id,joining_case_id,COALESCE(store_id,''),uri,object_key,content_sha256,content_type,byte_size,media_role,state,created_at,attached_at FROM dsh.store_profile_media_assets WHERE state='active' AND ((joining_case_id=$1 AND $1<>'') OR (store_id=$2 AND $2<>'')) ORDER BY created_at DESC LIMIT 1`, joiningCaseID, storeID).Scan(&record.ID, &record.JoiningCaseID, &record.StoreID, &record.URI, &record.ObjectKey, &record.ContentSHA256, &record.ContentType, &record.ByteSize, &record.Role, &record.State, &record.CreatedAt, &record.AttachedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &record, nil
}

func AttachStoreProfileMediaToStoreTx(ctx context.Context, tx *sql.Tx, joiningCaseID, storeID string) error {
	if tx == nil || strings.TrimSpace(joiningCaseID) == "" || strings.TrimSpace(storeID) == "" {
		return ErrStoreProfileMediaInvalid
	}
	_, err := tx.ExecContext(ctx, "UPDATE dsh.store_profile_media_assets SET store_id=$2,attached_at=COALESCE(attached_at,clock_timestamp()) WHERE joining_case_id=$1 AND state='active' AND store_id IS NULL", strings.TrimSpace(joiningCaseID), strings.TrimSpace(storeID))
	return err
}
