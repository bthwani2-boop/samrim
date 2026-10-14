package joiningcase

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/media"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	"strings"
	"time"
)

func (s *Service) ReadStoreImages(ctx context.Context, token, operatorActorID, storeID string) (postgres.StoreRecord, error) {
	if operatorActorID != "" {
		if err := s.requireOperator(ctx, operatorActorID); err != nil {
			return postgres.StoreRecord{}, err
		}
		return postgres.ReadStore(ctx, s.db, storeID)
	}
	session, err := s.identity.ReadSession(ctx, strings.TrimSpace(token))
	if err != nil {
		return postgres.StoreRecord{}, err
	}
	if session.Role != "partner" || session.Surface != "app-partner" || strings.TrimSpace(session.Subject) == "" {
		return postgres.StoreRecord{}, ErrStoreProfileMediaSessionForbidden
	}
	return postgres.ReadStoreOwnedByPartner(ctx, s.db, storeID, session.Subject)
}

func (s *Service) UploadStoreOwnedMedia(ctx context.Context, token, operatorActorID, storeID, role, key, correlation string, expectedVersion int, contentType string, data []byte, provenance media.Provenance) (postgres.StoreRecord, bool, error) {
	current, err := s.ReadStoreImages(ctx, token, operatorActorID, storeID)
	if err != nil {
		return postgres.StoreRecord{}, false, err
	}
	actor := operatorActorID
	if actor == "" {
		actor = current.PartnerActorID
	}
	if (role != "primary" && role != "cover") || expectedVersion < 1 || !validStoreProfileMutation(key, correlation, actor) {
		return postgres.StoreRecord{}, false, ErrInvalidInput
	}
	actualType, _, _, err := media.ValidateImageBytes(data)
	provenance = provenance.Normalized()
	if err != nil || provenance.Validate() != nil || (contentType != "" && contentType != actualType) {
		return postgres.StoreRecord{}, false, ErrInvalidInput
	}
	digest := sha256.Sum256(data)
	contentSHA := hex.EncodeToString(digest[:])
	hash := postgres.HashStoreMediaUploadRequest(role, "store:"+storeID, contentSHA, expectedVersion, provenance)
	assetHash := sha256.Sum256([]byte("store:" + storeID + "\x00" + role + "\x00" + key))
	assetID := "store_profile_media_" + hex.EncodeToString(assetHash[:])
	objectKey, err := media.KeyForStoreProfileUpload(assetID, key, contentSHA, actualType)
	if err != nil {
		return postgres.StoreRecord{}, false, err
	}
	uri := s.media.PublicURL(objectKey)
	if uri == "" {
		return postgres.StoreRecord{}, false, postgres.ErrStoreProfileMediaFailed
	}
	asset, replayed, err := postgres.RegisterStoreProfileMediaAssetPending(ctx, s.db, postgres.StoreProfileMediaAssetInput{ID: assetID, StoreID: storeID, Role: role, IdempotencyKey: key, RequestHash: hash, ExpectedCaseVersion: expectedVersion, ObjectKey: objectKey, URI: uri, ContentSHA256: contentSHA, ContentType: actualType, ByteSize: int64(len(data)), ActingActorID: actor, CorrelationID: correlation, Provenance: provenance})
	if err != nil {
		return postgres.StoreRecord{}, false, err
	}
	if asset.State != "active" && asset.State != "retired" {
		putCtx, cancel := context.WithTimeout(ctx, 5*time.Minute)
		defer cancel()
		if err = s.media.Put(putCtx, objectKey, bytes.NewReader(data), int64(len(data)), actualType); err != nil {
			_ = postgres.MarkStoreProfileMediaAssetFailed(ctx, s.db, assetID, err.Error())
			return postgres.StoreRecord{}, false, postgres.ErrStoreProfileMediaFailed
		}
		if err = postgres.ActivateStoreOwnedMedia(ctx, s.db, assetID, storeID, expectedVersion, key, hash, actor, correlation); err != nil {
			return postgres.StoreRecord{}, false, err
		}
	}
	result, err := s.ReadStoreImages(ctx, token, operatorActorID, storeID)
	return result, replayed, err
}
