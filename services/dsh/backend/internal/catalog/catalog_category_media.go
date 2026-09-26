package catalog

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"strings"
	"unicode/utf8"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/media"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

type CatalogCategoryMediaUploadInput struct {
	CategoryID, IdempotencyKey, CorrelationID, Reason string
	ExpectedVersion                                   int
	ContentType                                       string
	Bytes                                             []byte
}

func (s *Service) UploadCatalogCategoryMedia(ctx context.Context, actingActorID string, input CatalogCategoryMediaUploadInput) (postgres.CatalogCategoryRecord, error) {
	if err := s.requireOperatorPermission(ctx, actingActorID, "catalog"); err != nil {
		return postgres.CatalogCategoryRecord{}, err
	}
	if s.media == nil {
		return postgres.CatalogCategoryRecord{}, ErrCatalogMediaStorageUnavailable
	}
	input.CategoryID = strings.TrimSpace(input.CategoryID)
	input.IdempotencyKey = strings.TrimSpace(input.IdempotencyKey)
	input.CorrelationID = strings.TrimSpace(input.CorrelationID)
	input.Reason = strings.TrimSpace(input.Reason)
	if input.CategoryID == "" || input.IdempotencyKey == "" || input.CorrelationID == "" || utf8.RuneCountInString(input.Reason) < 5 || utf8.RuneCountInString(input.Reason) > 500 || input.ExpectedVersion < 1 {
		return postgres.CatalogCategoryRecord{}, ErrCatalogMediaUploadInvalid
	}
	contentType, _, _, err := media.ValidateImageBytes(input.Bytes)
	if err != nil || (strings.TrimSpace(input.ContentType) != "" && strings.TrimSpace(input.ContentType) != contentType) {
		return postgres.CatalogCategoryRecord{}, ErrCatalogMediaUploadInvalid
	}
	digest := sha256.Sum256(input.Bytes)
	contentSHA256 := hex.EncodeToString(digest[:])
	objectKey, err := media.KeyForCategoryUpload(input.CategoryID, input.IdempotencyKey, contentSHA256, contentType)
	if err != nil {
		return postgres.CatalogCategoryRecord{}, ErrCatalogMediaUploadInvalid
	}
	uri := s.media.PublicURL(objectKey)
	if uri == "" {
		return postgres.CatalogCategoryRecord{}, ErrCatalogMediaStorageUnavailable
	}
	assetHash := sha256.Sum256([]byte(input.CategoryID + "\x00" + input.IdempotencyKey))
	asset := postgres.CatalogCategoryMediaAssetInput{ID: "category_media_" + hex.EncodeToString(assetHash[:]), CategoryID: input.CategoryID, IdempotencyKey: input.IdempotencyKey, ExpectedVersion: input.ExpectedVersion, ObjectKey: objectKey, URI: uri, ContentSHA256: contentSHA256, ContentType: contentType, ByteSize: int64(len(input.Bytes)), Reason: input.Reason}
	registered, replayed, err := postgres.RegisterCatalogCategoryMediaAssetPending(ctx, s.db, asset)
	if err != nil {
		return postgres.CatalogCategoryRecord{}, err
	}
	if replayed {
		return readCategoryForService(ctx, s.db, input.CategoryID)
	}
	if registered.State != "pending" {
		return postgres.CatalogCategoryRecord{}, ErrCatalogMediaStorageUnavailable
	}
	current, err := readCategoryForService(ctx, s.db, input.CategoryID)
	if err != nil {
		_ = postgres.MarkCatalogCategoryMediaAssetFailed(ctx, s.db, asset.ID, err.Error())
		return postgres.CatalogCategoryRecord{}, err
	}
	if current.Version != input.ExpectedVersion {
		_ = postgres.MarkCatalogCategoryMediaAssetFailed(ctx, s.db, asset.ID, "catalog version is stale before category image upload")
		return postgres.CatalogCategoryRecord{}, postgres.ErrCatalogVersionConflict
	}
	if err = s.media.Put(ctx, objectKey, bytes.NewReader(input.Bytes), int64(len(input.Bytes)), contentType); err != nil {
		_ = postgres.MarkCatalogCategoryMediaAssetFailed(ctx, s.db, asset.ID, err.Error())
		return postgres.CatalogCategoryRecord{}, ErrCatalogMediaStorageUnavailable
	}
	result, _, err := postgres.AttachCatalogCategoryMediaAsset(ctx, s.db, asset, actingActorID, input.CorrelationID)
	if err != nil {
		if cleanupErr := s.media.Delete(ctx, objectKey); cleanupErr == nil {
			_ = postgres.MarkCatalogCategoryMediaAssetDeleted(ctx, s.db, asset.ID)
		} else {
			_ = postgres.MarkCatalogCategoryMediaAssetFailed(ctx, s.db, asset.ID, err.Error()+"; object cleanup failed")
		}
		return postgres.CatalogCategoryRecord{}, err
	}
	_ = s.ReconcileMediaStorage(ctx)
	return result, nil
}

func readCategoryForService(ctx context.Context, db *sql.DB, id string) (postgres.CatalogCategoryRecord, error) {
	return postgres.ReadCatalogCategory(ctx, db, id)
}
