package postgres

import (
	"context"
	"database/sql"
	"errors"
	"strings"
)

type DiscoveryContentMediaAssetInput struct {
	ID, IdempotencyKey, RequestHash, ObjectKey, URI string
	ContentSHA256, ContentType                      string
	Creator, SourceDescription, SourceURI           string
	RightsStatement, RightsURI, RightsAttestedBy    string
	ByteSize                                        int64
}

type DiscoveryContentMediaAssetRecord struct {
	ID, IdempotencyKey, RequestHash, ObjectKey, URI string
	ContentSHA256, ContentType, State               string
	ByteSize, CleanupAttempts                       int64
	LastCleanupError                                *string
}

func RegisterDiscoveryContentMediaAssetPending(ctx context.Context, db *sql.DB, asset DiscoveryContentMediaAssetInput) (DiscoveryContentMediaAssetRecord, bool, error) {
	if strings.TrimSpace(asset.ID) == "" || strings.TrimSpace(asset.IdempotencyKey) == "" || len(asset.RequestHash) != 64 || strings.TrimSpace(asset.ObjectKey) == "" || strings.TrimSpace(asset.URI) == "" || len(asset.ContentSHA256) != 64 || (asset.ContentType != "image/jpeg" && asset.ContentType != "image/png") || asset.ByteSize < 1 || asset.ByteSize > 10485760 || strings.TrimSpace(asset.RightsAttestedBy) == "" {
		return DiscoveryContentMediaAssetRecord{}, false, ErrDiscoveryContentInvalid
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return DiscoveryContentMediaAssetRecord{}, false, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err = tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "dsh:marketing:idempotency:"+asset.IdempotencyKey); err != nil {
		return DiscoveryContentMediaAssetRecord{}, false, err
	}
	stored, err := readDiscoveryContentMediaAssetByIdempotencyTx(ctx, tx, asset.IdempotencyKey)
	if err == nil {
		if stored.ID != asset.ID || stored.RequestHash != asset.RequestHash || stored.ObjectKey != asset.ObjectKey || stored.URI != asset.URI || stored.ContentSHA256 != asset.ContentSHA256 || stored.ContentType != asset.ContentType || stored.ByteSize != asset.ByteSize {
			return DiscoveryContentMediaAssetRecord{}, false, ErrDiscoveryContentIdempotency
		}
		if stored.State == "failed" || stored.State == "deleted" || stored.State == "retired" {
			return DiscoveryContentMediaAssetRecord{}, false, ErrDiscoveryContentInvalid
		}
		if err = tx.Commit(); err != nil {
			return DiscoveryContentMediaAssetRecord{}, false, err
		}
		return stored, stored.State == "active", nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return DiscoveryContentMediaAssetRecord{}, false, err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO dsh.discovery_content_media_assets(id,idempotency_key,request_hash,object_key,uri,content_sha256,content_type,byte_size,state,creator,source_description,source_uri,rights_statement,rights_uri,rights_attested_by_actor_id)
		VALUES($1,$2,$3,$4,$5,$6,$7,$8,'pending',$9,$10,NULLIF($11,''),$12,NULLIF($13,''),$14)`, asset.ID, asset.IdempotencyKey, asset.RequestHash, asset.ObjectKey, asset.URI, asset.ContentSHA256, asset.ContentType, asset.ByteSize, asset.Creator, asset.SourceDescription, asset.SourceURI, asset.RightsStatement, asset.RightsURI, asset.RightsAttestedBy); err != nil {
		return DiscoveryContentMediaAssetRecord{}, false, err
	}
	if err = tx.Commit(); err != nil {
		return DiscoveryContentMediaAssetRecord{}, false, err
	}
	return DiscoveryContentMediaAssetRecord{ID: asset.ID, IdempotencyKey: asset.IdempotencyKey, RequestHash: asset.RequestHash, ObjectKey: asset.ObjectKey, URI: asset.URI, ContentSHA256: asset.ContentSHA256, ContentType: asset.ContentType, ByteSize: asset.ByteSize, State: "pending"}, false, nil
}

func readDiscoveryContentMediaAssetByIdempotencyTx(ctx context.Context, tx *sql.Tx, idempotencyKey string) (DiscoveryContentMediaAssetRecord, error) {
	var asset DiscoveryContentMediaAssetRecord
	var lastError sql.NullString
	err := tx.QueryRowContext(ctx, `SELECT id,idempotency_key,request_hash,object_key,uri,content_sha256,content_type,byte_size,state,cleanup_attempts,last_cleanup_error
		FROM dsh.discovery_content_media_assets WHERE idempotency_key=$1 FOR UPDATE`, idempotencyKey).Scan(&asset.ID, &asset.IdempotencyKey, &asset.RequestHash, &asset.ObjectKey, &asset.URI, &asset.ContentSHA256, &asset.ContentType, &asset.ByteSize, &asset.State, &asset.CleanupAttempts, &lastError)
	if lastError.Valid {
		asset.LastCleanupError = &lastError.String
	}
	return asset, err
}

func ListDiscoveryContentMediaAssetsForCleanup(ctx context.Context, db *sql.DB, limit int) ([]DiscoveryContentMediaAssetRecord, error) {
	if limit < 1 || limit > 100 {
		limit = 100
	}
	rows, err := db.QueryContext(ctx, `SELECT id,idempotency_key,request_hash,object_key,uri,content_sha256,content_type,byte_size,state,cleanup_attempts,last_cleanup_error
		FROM dsh.discovery_content_media_assets WHERE state IN ('retired','failed') OR (state='pending' AND created_at < clock_timestamp() - interval '10 minutes') ORDER BY created_at ASC LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	assets := make([]DiscoveryContentMediaAssetRecord, 0)
	for rows.Next() {
		var asset DiscoveryContentMediaAssetRecord
		var lastError sql.NullString
		if err := rows.Scan(&asset.ID, &asset.IdempotencyKey, &asset.RequestHash, &asset.ObjectKey, &asset.URI, &asset.ContentSHA256, &asset.ContentType, &asset.ByteSize, &asset.State, &asset.CleanupAttempts, &lastError); err != nil {
			return nil, err
		}
		if lastError.Valid {
			asset.LastCleanupError = &lastError.String
		}
		assets = append(assets, asset)
	}
	return assets, rows.Err()
}

func MarkDiscoveryContentMediaAssetFailed(ctx context.Context, db *sql.DB, assetID, message string) error {
	_, err := db.ExecContext(ctx, "UPDATE dsh.discovery_content_media_assets SET state='failed',last_cleanup_error=$2 WHERE id=$1 AND state<>'deleted'", assetID, strings.TrimSpace(message))
	return err
}

func MarkDiscoveryContentMediaAssetDeleted(ctx context.Context, db *sql.DB, assetID string) error {
	_, err := db.ExecContext(ctx, "UPDATE dsh.discovery_content_media_assets SET state='deleted',retired_at=COALESCE(retired_at,clock_timestamp()),cleaned_at=clock_timestamp(),cleanup_attempts=cleanup_attempts+1,last_cleanup_error=NULL WHERE id=$1 AND state IN ('retired','failed','pending')", assetID)
	return err
}

func MarkDiscoveryContentMediaAssetCleanupFailure(ctx context.Context, db *sql.DB, assetID, message string) error {
	_, err := db.ExecContext(ctx, "UPDATE dsh.discovery_content_media_assets SET cleanup_attempts=cleanup_attempts+1,last_cleanup_error=$2 WHERE id=$1 AND state IN ('retired','failed','pending')", assetID, strings.TrimSpace(message))
	return err
}

func ReadDiscoveryContentMutation(ctx context.Context, db *sql.DB, idempotencyKey, resourceID, requestHash string) (DiscoveryContentRecord, bool, error) {
	var storedResourceID, storedHash string
	err := db.QueryRowContext(ctx, `SELECT resource_id,request_hash FROM dsh.commerce_marketing_mutation_idempotency
		WHERE idempotency_key=$1 AND resource_type='DISCOVERY_CONTENT' AND operation='CREATE'`, strings.TrimSpace(idempotencyKey)).Scan(&storedResourceID, &storedHash)
	if errors.Is(err, sql.ErrNoRows) {
		return DiscoveryContentRecord{}, false, nil
	}
	if err != nil {
		return DiscoveryContentRecord{}, false, err
	}
	if storedResourceID != strings.TrimSpace(resourceID) || storedHash != strings.TrimSpace(requestHash) {
		return DiscoveryContentRecord{}, false, ErrDiscoveryContentIdempotency
	}
	item, err := ReadDiscoveryContent(ctx, db, resourceID)
	return item, err == nil, err
}
