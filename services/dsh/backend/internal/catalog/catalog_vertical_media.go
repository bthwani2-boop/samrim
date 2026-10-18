package catalog

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/media"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

type CommerceVerticalMediaUploadInput struct {
	VerticalID, IdempotencyKey, CorrelationID, Reason string
	ExpectedVersion                                   int
	ContentType                                       string
	Provenance                                        media.Provenance
	Bytes                                             []byte
}

func (s *Service) UploadCommerceVerticalMedia(ctx context.Context, actingActorID string, input CommerceVerticalMediaUploadInput) (postgres.CommerceVerticalRecord, error) {
	if err := s.requireOperatorPermission(ctx, actingActorID, "catalog"); err != nil {
		return postgres.CommerceVerticalRecord{}, err
	}
	if s.media == nil {
		return postgres.CommerceVerticalRecord{}, ErrCatalogMediaStorageUnavailable
	}
	input.VerticalID = strings.TrimSpace(input.VerticalID)
	input.IdempotencyKey = strings.TrimSpace(input.IdempotencyKey)
	input.CorrelationID = strings.TrimSpace(input.CorrelationID)
	input.Reason = strings.TrimSpace(input.Reason)
	actingActorID = strings.TrimSpace(actingActorID)
	input.Provenance = input.Provenance.Normalized()
	if input.VerticalID == "" || input.IdempotencyKey == "" || input.CorrelationID == "" || utf8.RuneCountInString(input.Reason) < 5 || utf8.RuneCountInString(input.Reason) > 500 || input.ExpectedVersion < 1 || input.Provenance.Validate() != nil {
		return postgres.CommerceVerticalRecord{}, ErrCatalogMediaUploadInvalid
	}
	contentType, _, _, err := media.ValidateImageBytes(input.Bytes)
	if err != nil || (strings.TrimSpace(input.ContentType) != "" && strings.TrimSpace(input.ContentType) != contentType) {
		return postgres.CommerceVerticalRecord{}, ErrCatalogMediaUploadInvalid
	}
	digest := sha256.Sum256(input.Bytes)
	contentSHA256 := hex.EncodeToString(digest[:])
	objectKey, err := media.KeyForCommerceVerticalUpload(input.VerticalID, input.IdempotencyKey, contentSHA256, contentType)
	if err != nil {
		return postgres.CommerceVerticalRecord{}, ErrCatalogMediaUploadInvalid
	}
	uri := s.media.PublicURL(objectKey)
	if uri == "" {
		return postgres.CommerceVerticalRecord{}, ErrCatalogMediaStorageUnavailable
	}
	requestHash := postgres.HashCommerceVerticalMediaUploadRequest(input.VerticalID, input.IdempotencyKey, actingActorID, input.ExpectedVersion, contentSHA256, contentType, input.Reason, input.Provenance)
	assetHash := sha256.Sum256([]byte(input.VerticalID + "\x00" + input.IdempotencyKey))
	asset := postgres.CommerceVerticalMediaAssetInput{ID: "vertical_media_" + hex.EncodeToString(assetHash[:]), VerticalID: input.VerticalID, IdempotencyKey: input.IdempotencyKey, ExpectedVersion: input.ExpectedVersion, ObjectKey: objectKey, URI: uri, ContentSHA256: contentSHA256, ContentType: contentType, ByteSize: int64(len(input.Bytes)), Reason: input.Reason, RequestHash: requestHash,
		Creator: input.Provenance.Creator, SourceDescription: input.Provenance.SourceDescription, SourceURI: input.Provenance.SourceURI,
		RightsStatement: input.Provenance.RightsStatement, RightsURI: input.Provenance.RightsURI, RightsAttestedByActorID: actingActorID}
	registered, replayed, err := postgres.RegisterCommerceVerticalMediaAssetPending(ctx, s.db, asset)
	if err != nil {
		return postgres.CommerceVerticalRecord{}, err
	}
	if replayed {
		return readCommerceVerticalForService(ctx, s.db, input.VerticalID)
	}
	if registered.State != "pending" {
		return postgres.CommerceVerticalRecord{}, ErrCatalogMediaStorageUnavailable
	}
	current, err := readCommerceVerticalForService(ctx, s.db, input.VerticalID)
	if err != nil {
		cleanupCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		_ = postgres.MarkCommerceVerticalMediaAssetFailed(cleanupCtx, s.db, asset.ID, err.Error())
		cancel()
		return postgres.CommerceVerticalRecord{}, err
	}
	if current.Version != input.ExpectedVersion {
		cleanupCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		_ = postgres.MarkCommerceVerticalMediaAssetFailed(cleanupCtx, s.db, asset.ID, "commerce vertical version is stale before image upload")
		cancel()
		return postgres.CommerceVerticalRecord{}, postgres.ErrCatalogVersionConflict
	}
	if err = s.media.Put(ctx, objectKey, bytes.NewReader(input.Bytes), int64(len(input.Bytes)), contentType); err != nil {
		cleanupCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		_ = postgres.MarkCommerceVerticalMediaAssetFailed(cleanupCtx, s.db, asset.ID, err.Error())
		if cleanupErr := s.media.Delete(cleanupCtx, objectKey); cleanupErr == nil {
			_ = postgres.MarkCommerceVerticalMediaAssetDeleted(cleanupCtx, s.db, asset.ID)
		} else {
			_ = postgres.MarkCommerceVerticalMediaAssetCleanupFailure(cleanupCtx, s.db, asset.ID, cleanupErr.Error())
		}
		cancel()
		return postgres.CommerceVerticalRecord{}, ErrCatalogMediaStorageUnavailable
	}
	result, _, err := postgres.AttachCommerceVerticalMediaAsset(ctx, s.db, asset, actingActorID, input.CorrelationID)
	if err != nil {
		cleanupCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		currentAfterError, readErr := readCommerceVerticalForService(cleanupCtx, s.db, input.VerticalID)
		if readErr == nil && currentAfterError.ImageURI == uri {
			cancel()
			return currentAfterError, nil
		}
		if readErr == nil {
			if cleanupErr := s.media.Delete(cleanupCtx, objectKey); cleanupErr == nil {
				_ = postgres.MarkCommerceVerticalMediaAssetDeleted(cleanupCtx, s.db, asset.ID)
			} else {
				_ = postgres.MarkCommerceVerticalMediaAssetCleanupFailure(cleanupCtx, s.db, asset.ID, cleanupErr.Error())
			}
		}
		cancel()
		return postgres.CommerceVerticalRecord{}, err
	}
	_ = s.ReconcileMediaStorage(ctx)
	return result, nil
}

func readCommerceVerticalForService(ctx context.Context, db *sql.DB, id string) (postgres.CommerceVerticalRecord, error) {
	return postgres.ReadCommerceVertical(ctx, db, id)
}
