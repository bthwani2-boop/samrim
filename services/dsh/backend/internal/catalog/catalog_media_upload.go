package catalog

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"sort"
	"strings"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/media"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

type CatalogMediaUploadInput struct {
	ProductID, Role, IdempotencyKey, CorrelationID string
	ExpectedVersion                                int
	ContentType                                    string
	Bytes                                          []byte
}

func (s *Service) UploadCatalogProductMedia(ctx context.Context, actingActorID string, input CatalogMediaUploadInput) (postgres.CatalogProductResult, error) {
	if err := s.requireOperator(ctx, actingActorID); err != nil {
		return postgres.CatalogProductResult{}, err
	}
	if s.media == nil {
		return postgres.CatalogProductResult{}, ErrCatalogMediaStorageUnavailable
	}
	input.ProductID = strings.TrimSpace(input.ProductID)
	input.Role = strings.TrimSpace(input.Role)
	input.IdempotencyKey = strings.TrimSpace(input.IdempotencyKey)
	input.CorrelationID = strings.TrimSpace(input.CorrelationID)
	if input.ProductID == "" || input.IdempotencyKey == "" || input.CorrelationID == "" || input.ExpectedVersion < 1 || (input.Role != "primary" && input.Role != "gallery") {
		return postgres.CatalogProductResult{}, ErrCatalogMediaUploadInvalid
	}
	contentType, _, _, err := media.ValidateImageBytes(input.Bytes)
	if err != nil || (strings.TrimSpace(input.ContentType) != "" && strings.TrimSpace(input.ContentType) != contentType) {
		return postgres.CatalogProductResult{}, ErrCatalogMediaUploadInvalid
	}
	digest := sha256.Sum256(input.Bytes)
	contentSHA256 := hex.EncodeToString(digest[:])
	objectKey, err := media.KeyForUpload(input.ProductID, input.IdempotencyKey, contentSHA256, contentType)
	if err != nil {
		return postgres.CatalogProductResult{}, ErrCatalogMediaUploadInvalid
	}
	uri := s.media.PublicURL(objectKey)
	if uri == "" {
		return postgres.CatalogProductResult{}, ErrCatalogMediaStorageUnavailable
	}
	assetHash := sha256.Sum256([]byte(input.ProductID + "\x00" + input.IdempotencyKey))
	asset := postgres.CatalogMediaAssetInput{
		ID:              "media_asset_" + hex.EncodeToString(assetHash[:]),
		ProductID:       input.ProductID,
		IdempotencyKey:  input.IdempotencyKey,
		ExpectedVersion: input.ExpectedVersion,
		ObjectKey:       objectKey,
		URI:             uri,
		ContentSHA256:   contentSHA256,
		ContentType:     contentType,
		Role:            input.Role,
		ByteSize:        int64(len(input.Bytes)),
	}
	registered, replayed, err := postgres.RegisterCatalogMediaAssetPending(ctx, s.db, asset)
	if err != nil {
		return postgres.CatalogProductResult{}, err
	}
	if replayed {
		product, readErr := postgres.ReadCatalogProduct(ctx, s.db, input.ProductID)
		if readErr != nil {
			return postgres.CatalogProductResult{}, readErr
		}
		return postgres.CatalogProductResult{Product: product, Replayed: true}, nil
	}
	if registered.State != "pending" {
		return postgres.CatalogProductResult{}, ErrCatalogMediaStorageUnavailable
	}
	product, err := postgres.ReadCatalogProduct(ctx, s.db, input.ProductID)
	if err != nil {
		return postgres.CatalogProductResult{}, err
	}
	if product.Version != input.ExpectedVersion {
		_ = postgres.MarkCatalogMediaAssetFailed(ctx, s.db, asset.ID, "catalog version is stale before object upload")
		return postgres.CatalogProductResult{}, postgres.ErrCatalogVersionConflict
	}
	if err = s.media.Put(ctx, objectKey, bytes.NewReader(input.Bytes), int64(len(input.Bytes)), contentType); err != nil {
		_ = postgres.MarkCatalogMediaAssetFailed(ctx, s.db, asset.ID, err.Error())
		return postgres.CatalogProductResult{}, ErrCatalogMediaStorageUnavailable
	}
	mediaItems, err := uploadedMedia(product.Media, input.Role, uri)
	if err != nil {
		_ = s.removeFailedAsset(ctx, asset, err)
		return postgres.CatalogProductResult{}, err
	}
	normalized, err := normalizeCatalogMedia(mediaItems)
	if err != nil {
		_ = s.removeFailedAsset(ctx, asset, err)
		return postgres.CatalogProductResult{}, ErrCatalogMediaUploadInvalid
	}
	result, err := postgres.ReplaceCatalogProductMediaWithAsset(ctx, s.db, input.ProductID, normalized, input.ExpectedVersion, input.IdempotencyKey, postgres.HashCatalogMediaUploadRequest(input.ProductID, input.Role, contentSHA256, input.ExpectedVersion), actingActorID, input.CorrelationID, asset)
	if err != nil {
		_ = s.removeFailedAsset(ctx, asset, err)
		return postgres.CatalogProductResult{}, err
	}
	if cleanupErr := s.ReconcileMediaStorage(ctx); cleanupErr != nil {
		// The retired asset remains durably tracked for the next reconciliation pass.
		return result, nil
	}
	return result, nil
}

func uploadedMedia(current []postgres.CatalogMediaRecord, role, uri string) ([]postgres.CatalogMediaInput, error) {
	ordered := append([]postgres.CatalogMediaRecord(nil), current...)
	sort.SliceStable(ordered, func(left, right int) bool { return ordered[left].Ordinal < ordered[right].Ordinal })
	mediaItems := make([]postgres.CatalogMediaInput, 0, len(ordered)+1)
	if role == "primary" {
		mediaItems = append(mediaItems, postgres.CatalogMediaInput{URI: uri, Role: "primary", Ordinal: 0})
		for _, item := range ordered {
			if item.Role == "gallery" {
				mediaItems = append(mediaItems, postgres.CatalogMediaInput{URI: item.URI, Role: "gallery", Ordinal: len(mediaItems)})
			}
		}
		return mediaItems, nil
	}
	hasPrimary := false
	for _, item := range ordered {
		if item.Role == "primary" {
			hasPrimary = true
			mediaItems = append(mediaItems, postgres.CatalogMediaInput{URI: item.URI, Role: "primary", Ordinal: 0})
		} else if item.Role == "gallery" {
			mediaItems = append(mediaItems, postgres.CatalogMediaInput{URI: item.URI, Role: "gallery", Ordinal: len(mediaItems)})
		}
	}
	if !hasPrimary {
		return nil, ErrCatalogMediaUploadInvalid
	}
	mediaItems = append(mediaItems, postgres.CatalogMediaInput{URI: uri, Role: "gallery", Ordinal: len(mediaItems)})
	return mediaItems, nil
}

func (s *Service) removeFailedAsset(ctx context.Context, asset postgres.CatalogMediaAssetInput, cause error) error {
	if err := s.media.Delete(ctx, asset.ObjectKey); err == nil {
		return postgres.MarkCatalogMediaAssetDeleted(ctx, s.db, asset.ID)
	}
	return postgres.MarkCatalogMediaAssetFailed(ctx, s.db, asset.ID, fmt.Sprintf("%s; object cleanup failed", cause.Error()))
}

func (s *Service) ReconcileMediaStorage(ctx context.Context) error {
	assets, err := postgres.ListCatalogMediaAssetsForCleanup(ctx, s.db, 100)
	if err != nil {
		return err
	}
	var firstErr error
	for _, asset := range assets {
		if err := s.media.Delete(ctx, asset.ObjectKey); err != nil {
			_ = postgres.MarkCatalogMediaAssetCleanupFailure(ctx, s.db, asset.ID, err.Error())
			if firstErr == nil {
				firstErr = err
			}
			continue
		}
		if err := postgres.MarkCatalogMediaAssetDeleted(ctx, s.db, asset.ID); err != nil && firstErr == nil {
			firstErr = err
		}
	}
	return firstErr
}
