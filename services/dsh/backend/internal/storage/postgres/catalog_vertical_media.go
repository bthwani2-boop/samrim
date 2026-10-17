package postgres

import (
	"context"
	"database/sql"
	"errors"
	"strconv"
	"strings"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/media"
)

type CommerceVerticalMediaAssetInput struct {
	ID, VerticalID, IdempotencyKey, ObjectKey, URI      string
	ContentSHA256, ContentType, Reason, RequestHash     string
	Creator, SourceDescription, SourceURI               string
	RightsStatement, RightsURI, RightsAttestedByActorID string
	ExpectedVersion                                     int
	ByteSize                                            int64
}

type CommerceVerticalMediaAssetRecord struct {
	ID, VerticalID, IdempotencyKey, ObjectKey, URI string
	ContentSHA256, ContentType, State, RequestHash string
	ExpectedVersion                                int
	ByteSize, CleanupAttempts                      int64
	LastCleanupError                               *string
}

func HashCommerceVerticalMediaUploadRequest(verticalID, idempotencyKey, actingActorID string, expectedVersion int, contentSHA256, contentType, reason string, provenance media.Provenance) string {
	return hashFacts("commerce-vertical-media-upload", strings.TrimSpace(verticalID), strings.TrimSpace(idempotencyKey), strings.TrimSpace(actingActorID), strconv.Itoa(expectedVersion), contentSHA256, contentType, strings.TrimSpace(reason), provenance.Creator, provenance.SourceDescription, provenance.SourceURI, provenance.RightsStatement, provenance.RightsURI, strconv.FormatBool(provenance.RightsAttested))
}

func RegisterCommerceVerticalMediaAssetPending(ctx context.Context, db *sql.DB, asset CommerceVerticalMediaAssetInput) (CommerceVerticalMediaAssetRecord, bool, error) {
	if strings.TrimSpace(asset.ID) == "" || strings.TrimSpace(asset.VerticalID) == "" || strings.TrimSpace(asset.IdempotencyKey) == "" || strings.TrimSpace(asset.ObjectKey) == "" || strings.TrimSpace(asset.URI) == "" || asset.ExpectedVersion < 1 || len(asset.ContentSHA256) != 64 || len(asset.RequestHash) != 64 || strings.TrimSpace(asset.RightsAttestedByActorID) == "" || strings.TrimSpace(asset.Reason) == "" || asset.ByteSize < 1 || asset.ByteSize > 10485760 || (asset.ContentType != "image/jpeg" && asset.ContentType != "image/png") {
		return CommerceVerticalMediaAssetRecord{}, false, ErrCatalogMediaInvalid
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return CommerceVerticalMediaAssetRecord{}, false, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err = tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "dsh:commerce-vertical-media:idempotency:"+asset.IdempotencyKey); err != nil {
		return CommerceVerticalMediaAssetRecord{}, false, err
	}
	stored, err := readCommerceVerticalMediaAssetByIdempotencyTx(ctx, tx, asset.IdempotencyKey)
	if err == nil {
		if stored.VerticalID != asset.VerticalID || stored.ExpectedVersion != asset.ExpectedVersion || stored.ObjectKey != asset.ObjectKey || stored.URI != asset.URI || stored.ContentSHA256 != asset.ContentSHA256 || stored.ContentType != asset.ContentType || stored.ByteSize != asset.ByteSize || stored.RequestHash != asset.RequestHash {
			return CommerceVerticalMediaAssetRecord{}, false, ErrCatalogIdempotencyConflict
		}
		if stored.State == "failed" {
			if _, err = tx.ExecContext(ctx, "UPDATE dsh.commerce_vertical_media_assets SET state='pending',last_cleanup_error=NULL WHERE id=$1", stored.ID); err != nil {
				return CommerceVerticalMediaAssetRecord{}, false, err
			}
			stored.State = "pending"
		}
		if err = tx.Commit(); err != nil {
			return CommerceVerticalMediaAssetRecord{}, false, err
		}
		return stored, stored.State == "active", nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return CommerceVerticalMediaAssetRecord{}, false, err
	}
	vertical, err := readCommerceVerticalForUpdateTx(ctx, tx, asset.VerticalID)
	if err != nil {
		return CommerceVerticalMediaAssetRecord{}, false, err
	}
	if vertical.Version != asset.ExpectedVersion {
		return CommerceVerticalMediaAssetRecord{}, false, ErrCatalogVersionConflict
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO dsh.commerce_vertical_media_assets(id,vertical_id,idempotency_key,expected_version,object_key,uri,content_sha256,content_type,byte_size,reason,state,request_hash,creator,source_description,source_uri,rights_statement,rights_uri,rights_attested_by_actor_id,rights_attested_at)
		VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending',$11,$12,$13,NULLIF($14,''),$15,NULLIF($16,''),$17,clock_timestamp())`, asset.ID, asset.VerticalID, asset.IdempotencyKey, asset.ExpectedVersion, asset.ObjectKey, asset.URI, asset.ContentSHA256, asset.ContentType, asset.ByteSize, asset.Reason, asset.RequestHash, asset.Creator, asset.SourceDescription, asset.SourceURI, asset.RightsStatement, asset.RightsURI, asset.RightsAttestedByActorID); err != nil {
		return CommerceVerticalMediaAssetRecord{}, false, err
	}
	if err = tx.Commit(); err != nil {
		return CommerceVerticalMediaAssetRecord{}, false, err
	}
	return CommerceVerticalMediaAssetRecord{ID: asset.ID, VerticalID: asset.VerticalID, IdempotencyKey: asset.IdempotencyKey, ExpectedVersion: asset.ExpectedVersion, ObjectKey: asset.ObjectKey, URI: asset.URI, ContentSHA256: asset.ContentSHA256, ContentType: asset.ContentType, ByteSize: asset.ByteSize, RequestHash: asset.RequestHash, State: "pending"}, false, nil
}

func AttachCommerceVerticalMediaAsset(ctx context.Context, db *sql.DB, asset CommerceVerticalMediaAssetInput, actingActorID, correlationID string) (CommerceVerticalRecord, bool, error) {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return CommerceVerticalRecord{}, false, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err = tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "dsh:commerce-vertical-media:idempotency:"+asset.IdempotencyKey); err != nil {
		return CommerceVerticalRecord{}, false, err
	}
	registered, err := readCommerceVerticalMediaAssetByIdempotencyTx(ctx, tx, asset.IdempotencyKey)
	if err != nil {
		return CommerceVerticalRecord{}, false, err
	}
	if registered.ID != asset.ID || registered.VerticalID != asset.VerticalID || registered.ExpectedVersion != asset.ExpectedVersion || registered.ObjectKey != asset.ObjectKey || registered.URI != asset.URI || registered.ContentSHA256 != asset.ContentSHA256 || registered.ContentType != asset.ContentType || registered.ByteSize != asset.ByteSize || registered.RequestHash != asset.RequestHash || registered.State == "deleted" {
		return CommerceVerticalRecord{}, false, ErrCatalogMediaInvalid
	}
	vertical, err := readCommerceVerticalForUpdateTx(ctx, tx, asset.VerticalID)
	if err != nil {
		return CommerceVerticalRecord{}, false, err
	}
	if vertical.ImageURI == asset.URI && registered.State == "active" {
		if err = tx.Commit(); err != nil {
			return CommerceVerticalRecord{}, false, err
		}
		return vertical, true, nil
	}
	if vertical.Version != asset.ExpectedVersion {
		return CommerceVerticalRecord{}, false, ErrCatalogVersionConflict
	}
	if registered.State != "pending" {
		return CommerceVerticalRecord{}, false, ErrCatalogMediaInvalid
	}
	if _, err = tx.ExecContext(ctx, "UPDATE dsh.commerce_vertical_media_assets SET state='retired',retired_at=COALESCE(retired_at,clock_timestamp()),last_cleanup_error=NULL WHERE vertical_id=$1 AND state='active'", asset.VerticalID); err != nil {
		return CommerceVerticalRecord{}, false, err
	}
	result, err := tx.ExecContext(ctx, "UPDATE dsh.commerce_vertical_media_assets SET state='active',retired_at=NULL,cleaned_at=NULL,last_cleanup_error=NULL WHERE id=$1 AND vertical_id=$2 AND state='pending'", asset.ID, asset.VerticalID)
	if err != nil {
		return CommerceVerticalRecord{}, false, err
	}
	if affected, affectedErr := result.RowsAffected(); affectedErr != nil || affected != 1 {
		return CommerceVerticalRecord{}, false, ErrCatalogMediaInvalid
	}
	result, err = tx.ExecContext(ctx, "UPDATE dsh.commerce_verticals SET image_uri=$2,version=version+1,updated_at=clock_timestamp() WHERE id=$1 AND version=$3", asset.VerticalID, asset.URI, asset.ExpectedVersion)
	if err != nil {
		return CommerceVerticalRecord{}, false, err
	}
	if affected, affectedErr := result.RowsAffected(); affectedErr != nil || affected != 1 {
		return CommerceVerticalRecord{}, false, ErrCatalogVersionConflict
	}
	after, err := readCommerceVerticalTx(ctx, tx, asset.VerticalID)
	if err != nil {
		return CommerceVerticalRecord{}, false, err
	}
	if err = writeCatalogRegistryAudit(ctx, tx, CatalogRegistryAuditInput{EntityType: "vertical", EntityID: asset.VerticalID, Action: "UPDATED", ActingActorID: actingActorID, CorrelationID: correlationID, Reason: asset.Reason, ExpectedVersion: vertical.Version, ResultingVersion: after.Version, BeforeState: vertical, AfterState: after}); err != nil {
		return CommerceVerticalRecord{}, false, err
	}
	if err = tx.Commit(); err != nil {
		return CommerceVerticalRecord{}, false, err
	}
	return after, false, nil
}

func ListCommerceVerticalMediaAssetsForCleanup(ctx context.Context, db *sql.DB, limit int) ([]CommerceVerticalMediaAssetRecord, error) {
	if limit < 1 || limit > 100 {
		limit = 100
	}
	rows, err := db.QueryContext(ctx, "SELECT id,vertical_id,idempotency_key,expected_version,object_key,uri,content_sha256,content_type,byte_size,state,cleanup_attempts,last_cleanup_error FROM dsh.commerce_vertical_media_assets WHERE state IN ('retired','failed') OR (state='pending' AND created_at < clock_timestamp() - interval '10 minutes') ORDER BY created_at ASC LIMIT $1", limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	assets := make([]CommerceVerticalMediaAssetRecord, 0)
	for rows.Next() {
		var asset CommerceVerticalMediaAssetRecord
		var lastError sql.NullString
		if err := rows.Scan(&asset.ID, &asset.VerticalID, &asset.IdempotencyKey, &asset.ExpectedVersion, &asset.ObjectKey, &asset.URI, &asset.ContentSHA256, &asset.ContentType, &asset.ByteSize, &asset.State, &asset.CleanupAttempts, &lastError); err != nil {
			return nil, err
		}
		if lastError.Valid {
			asset.LastCleanupError = &lastError.String
		}
		assets = append(assets, asset)
	}
	return assets, rows.Err()
}

func MarkCommerceVerticalMediaAssetFailed(ctx context.Context, db *sql.DB, assetID, message string) error {
	_, err := db.ExecContext(ctx, "UPDATE dsh.commerce_vertical_media_assets SET state='failed',cleanup_attempts=cleanup_attempts+1,last_cleanup_error=$2 WHERE id=$1 AND state<>'deleted'", assetID, strings.TrimSpace(message))
	return err
}

func MarkCommerceVerticalMediaAssetDeleted(ctx context.Context, db *sql.DB, assetID string) error {
	_, err := db.ExecContext(ctx, "UPDATE dsh.commerce_vertical_media_assets SET state='deleted',retired_at=COALESCE(retired_at,clock_timestamp()),cleaned_at=clock_timestamp(),cleanup_attempts=cleanup_attempts+1,last_cleanup_error=NULL WHERE id=$1 AND state IN ('retired','failed','pending')", assetID)
	return err
}

func MarkCommerceVerticalMediaAssetCleanupFailure(ctx context.Context, db *sql.DB, assetID, message string) error {
	_, err := db.ExecContext(ctx, "UPDATE dsh.commerce_vertical_media_assets SET cleanup_attempts=cleanup_attempts+1,last_cleanup_error=$2 WHERE id=$1 AND state IN ('retired','failed','pending')", assetID, strings.TrimSpace(message))
	return err
}

func readCommerceVerticalMediaAssetByIdempotencyTx(ctx context.Context, tx *sql.Tx, idempotencyKey string) (CommerceVerticalMediaAssetRecord, error) {
	var asset CommerceVerticalMediaAssetRecord
	var lastError sql.NullString
	err := tx.QueryRowContext(ctx, "SELECT id,vertical_id,idempotency_key,expected_version,object_key,uri,content_sha256,content_type,byte_size,state,cleanup_attempts,last_cleanup_error,request_hash FROM dsh.commerce_vertical_media_assets WHERE idempotency_key=$1 FOR UPDATE", idempotencyKey).Scan(&asset.ID, &asset.VerticalID, &asset.IdempotencyKey, &asset.ExpectedVersion, &asset.ObjectKey, &asset.URI, &asset.ContentSHA256, &asset.ContentType, &asset.ByteSize, &asset.State, &asset.CleanupAttempts, &lastError, &asset.RequestHash)
	if lastError.Valid {
		asset.LastCleanupError = &lastError.String
	}
	return asset, err
}
