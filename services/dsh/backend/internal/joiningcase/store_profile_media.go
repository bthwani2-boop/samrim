package joiningcase

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strings"
	"time"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/media"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

var (
	ErrFieldSessionForbidden             = errors.New("an eligible app-field session is required for this joining-case operation")
	ErrStoreProfileMediaSessionForbidden = errors.New("an eligible Field or Partner session is required for this joining-case operation")
)

func (s *Service) UploadStoreProfileImage(ctx context.Context, accessToken, caseID, idempotencyKey, correlationID string, expectedVersion int, contentType string, data []byte) (postgres.JoiningCaseResult, error) {
	identity, err := s.identity.ReadSession(ctx, strings.TrimSpace(accessToken))
	if err != nil {
		return postgres.JoiningCaseResult{}, err
	}
	caseID = strings.TrimSpace(caseID)
	if caseID == "" || expectedVersion < 1 || !validStoreProfileMutation(idempotencyKey, correlationID, identity.Subject) {
		return postgres.JoiningCaseResult{}, ErrInvalidInput
	}

	var current postgres.JoiningCaseResult
	scope := ""
	switch {
	case identity.Role == "field" && identity.Surface == "app-field" && strings.TrimSpace(identity.Subject) != "":
		admission, err := postgres.ReadFieldAdmissionForActor(ctx, s.db, identity.Subject)
		if err != nil {
			return postgres.JoiningCaseResult{}, err
		}
		if admission.State != "eligible" {
			return postgres.JoiningCaseResult{}, ErrFieldSessionForbidden
		}
		current, err = postgres.ReadJoiningCaseForField(ctx, s.db, identity.Subject, caseID)
		if err != nil {
			return postgres.JoiningCaseResult{}, err
		}
		if current.Case.State != "draft" {
			return postgres.JoiningCaseResult{}, postgres.ErrStoreProfileMediaState
		}
		scope = "field"
	case identity.Role == "partner" && identity.Surface == "app-partner" && strings.TrimSpace(identity.Subject) != "":
		current, err = postgres.ReadJoiningCaseForPartner(ctx, s.db, identity.Subject)
		if errors.Is(err, postgres.ErrJoiningCaseNotFound) || (err == nil && current.Case.ID != caseID) {
			return postgres.JoiningCaseResult{}, postgres.ErrJoiningCaseNotFound
		}
		if err != nil {
			return postgres.JoiningCaseResult{}, err
		}
		if current.Case.State != "needs_correction" {
			return postgres.JoiningCaseResult{}, postgres.ErrStoreProfileMediaState
		}
		scope = "partner"
	default:
		return postgres.JoiningCaseResult{}, ErrStoreProfileMediaSessionForbidden
	}
	actualType, _, _, err := media.ValidateImageBytes(data)
	if err != nil || (strings.TrimSpace(contentType) != "" && strings.TrimSpace(contentType) != actualType) {
		return postgres.JoiningCaseResult{}, ErrInvalidInput
	}
	digest := sha256.Sum256(data)
	contentSHA := hex.EncodeToString(digest[:])
	requestHash := postgres.HashStoreProfileMediaUploadRequest(caseID, contentSHA, expectedVersion)
	assetHash := sha256.Sum256([]byte(caseID + "\x00" + strings.TrimSpace(idempotencyKey)))
	assetID := "store_profile_media_" + hex.EncodeToString(assetHash[:])
	objectKey, err := media.KeyForStoreProfileUpload(assetID, idempotencyKey, contentSHA, actualType)
	if err != nil {
		return postgres.JoiningCaseResult{}, ErrInvalidInput
	}
	uri := s.media.PublicURL(objectKey)
	if uri == "" {
		return postgres.JoiningCaseResult{}, errors.New("store profile media storage is unavailable")
	}
	asset, replayed, err := postgres.RegisterStoreProfileMediaAssetPending(ctx, s.db, postgres.StoreProfileMediaAssetInput{ID: assetID, JoiningCaseID: caseID, IdempotencyKey: strings.TrimSpace(idempotencyKey), RequestHash: requestHash, ExpectedCaseVersion: expectedVersion, ObjectKey: objectKey, URI: uri, ContentSHA256: contentSHA, ContentType: actualType, ByteSize: int64(len(data)), ActingActorID: identity.Subject, CorrelationID: strings.TrimSpace(correlationID)})
	if err != nil {
		return postgres.JoiningCaseResult{}, err
	}
	if replayed {
		switch asset.State {
		case "active", "retired":
			return s.readStoreProfileImageCase(ctx, scope, identity.Subject, caseID, true)
		case "failed":
			return postgres.JoiningCaseResult{}, postgres.ErrStoreProfileMediaFailed
		case "pending":
			if current.Case.Version != expectedVersion {
				return postgres.JoiningCaseResult{}, postgres.ErrStoreProfileMediaVersion
			}
		default:
			return postgres.JoiningCaseResult{}, postgres.ErrStoreProfileMediaFailed
		}
	}
	putContext, cancelPut := context.WithTimeout(ctx, 5*time.Minute)
	defer cancelPut()
	if err := s.media.Put(putContext, objectKey, bytes.NewReader(data), int64(len(data)), actualType); err != nil {
		_ = postgres.MarkStoreProfileMediaAssetFailed(ctx, s.db, asset.ID, err.Error())
		return postgres.JoiningCaseResult{}, postgres.ErrStoreProfileMediaFailed
	}
	if _, err := postgres.ActivateStoreProfileMediaAsset(ctx, s.db, asset.ID, caseID, expectedVersion, strings.TrimSpace(idempotencyKey), requestHash, identity.Subject, strings.TrimSpace(correlationID)); err != nil {
		return postgres.JoiningCaseResult{}, err
	}
	return s.readStoreProfileImageCase(ctx, scope, identity.Subject, caseID, replayed)
}

func (s *Service) readStoreProfileImageCase(ctx context.Context, scope, actorID, caseID string, replayed bool) (postgres.JoiningCaseResult, error) {
	var result postgres.JoiningCaseResult
	var err error
	switch scope {
	case "field":
		result, err = postgres.ReadJoiningCaseForField(ctx, s.db, actorID, caseID)
	case "partner":
		result, err = postgres.ReadJoiningCaseForPartner(ctx, s.db, actorID)
		if err == nil && result.Case.ID != caseID {
			return postgres.JoiningCaseResult{}, postgres.ErrJoiningCaseNotFound
		}
	default:
		return postgres.JoiningCaseResult{}, ErrInvalidInput
	}
	result.Replayed = replayed
	return result, err
}

func (s *Service) ReconcileStoreProfileMedia(ctx context.Context) error {
	assets, err := postgres.ClaimStoreProfileMediaAssetsForCleanup(ctx, s.db, 100)
	if err != nil {
		return err
	}
	var firstErr error
	for _, asset := range assets {
		if err := s.media.Delete(ctx, asset.ObjectKey); err != nil {
			_ = postgres.MarkStoreProfileMediaAssetCleanupFailure(ctx, s.db, asset.ID, asset.CleanupClaimedAt, err.Error())
			if firstErr == nil {
				firstErr = err
			}
			continue
		}
		if err := postgres.MarkStoreProfileMediaAssetCleanupComplete(ctx, s.db, asset.ID, asset.CleanupClaimedAt); err != nil && firstErr == nil {
			firstErr = err
		}
	}
	return firstErr
}

func validStoreProfileMutation(idempotencyKey, correlationID, actingActorID string) bool {
	return len(strings.TrimSpace(idempotencyKey)) >= 8 && len(strings.TrimSpace(idempotencyKey)) <= 128 && len(strings.TrimSpace(correlationID)) >= 8 && len(strings.TrimSpace(correlationID)) <= 128 && strings.TrimSpace(actingActorID) != ""
}
