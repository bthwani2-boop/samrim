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

func (s *Service) UploadStoreProfileImage(ctx context.Context, accessToken, caseID, idempotencyKey, correlationID string, expectedVersion int, contentType string, data []byte, provenance media.Provenance) (postgres.JoiningCaseResult, error) {
	identity, err := s.identity.ReadSession(ctx, strings.TrimSpace(accessToken))
	if err != nil {
		return postgres.JoiningCaseResult{}, err
	}
	caseID = strings.TrimSpace(caseID)
	if caseID == "" || expectedVersion < 1 || !validStoreProfileMutation(idempotencyKey, correlationID, identity.Subject) {
		return postgres.JoiningCaseResult{}, ErrInvalidInput
	}

	current, scope, err := s.readStoreProfileMutationCase(ctx, identity.Role, identity.Surface, identity.Subject, caseID)
	if err != nil {
		return postgres.JoiningCaseResult{}, err
	}
	actualType, _, _, err := media.ValidateImageBytes(data)
	provenance = provenance.Normalized()
	if err != nil || (strings.TrimSpace(contentType) != "" && strings.TrimSpace(contentType) != actualType) || provenance.Validate() != nil {
		return postgres.JoiningCaseResult{}, ErrInvalidInput
	}
	digest := sha256.Sum256(data)
	contentSHA := hex.EncodeToString(digest[:])
	requestHash := postgres.HashStoreProfileMediaUploadRequest(caseID, contentSHA, expectedVersion, provenance)
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
	asset, replayed, err := postgres.RegisterStoreProfileMediaAssetPending(ctx, s.db, postgres.StoreProfileMediaAssetInput{ID: assetID, JoiningCaseID: caseID, IdempotencyKey: strings.TrimSpace(idempotencyKey), RequestHash: requestHash, ExpectedCaseVersion: expectedVersion, ObjectKey: objectKey, URI: uri, ContentSHA256: contentSHA, ContentType: actualType, ByteSize: int64(len(data)), ActingActorID: identity.Subject, CorrelationID: strings.TrimSpace(correlationID), Provenance: provenance})
	if err != nil {
		return postgres.JoiningCaseResult{}, err
	}
	if replayed {
		result, handled, replayErr := s.resolveReplayedStoreProfileAsset(ctx, asset, current, scope, identity.Subject, caseID, expectedVersion)
		if handled {
			return result, replayErr
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

func (s *Service) readStoreProfileMutationCase(ctx context.Context, role, surface, subject, caseID string) (postgres.JoiningCaseResult, string, error) {
	subject = strings.TrimSpace(subject)
	if role == "field" && surface == "app-field" && subject != "" {
		admission, err := postgres.ReadFieldAdmissionForActor(ctx, s.db, subject)
		if err != nil {
			return postgres.JoiningCaseResult{}, "", err
		}
		if admission.State != "eligible" || admission.RequiresProfileReview || strings.TrimSpace(admission.FullNameAr) == "" {
			return postgres.JoiningCaseResult{}, "", ErrFieldSessionForbidden
		}
		current, err := postgres.ReadJoiningCaseForField(ctx, s.db, subject, caseID)
		if err != nil {
			return postgres.JoiningCaseResult{}, "", err
		}
		if current.Case.State != "draft" {
			return postgres.JoiningCaseResult{}, "", postgres.ErrStoreProfileMediaState
		}
		return current, "field", nil
	}
	if role == "partner" && surface == "app-partner" && subject != "" {
		current, err := postgres.ReadJoiningCaseForPartner(ctx, s.db, subject)
		if errors.Is(err, postgres.ErrJoiningCaseNotFound) || (err == nil && current.Case.ID != caseID) {
			return postgres.JoiningCaseResult{}, "", postgres.ErrJoiningCaseNotFound
		}
		if err != nil {
			return postgres.JoiningCaseResult{}, "", err
		}
		if current.Case.State != "needs_correction" && !(current.Case.State == "approved" && current.Case.StoreID != "") {
			return postgres.JoiningCaseResult{}, "", postgres.ErrStoreProfileMediaState
		}
		return current, "partner", nil
	}
	return postgres.JoiningCaseResult{}, "", ErrStoreProfileMediaSessionForbidden
}

func (s *Service) resolveReplayedStoreProfileAsset(ctx context.Context, asset postgres.StoreProfileMediaRecord, current postgres.JoiningCaseResult, scope, actorID, caseID string, expectedVersion int) (postgres.JoiningCaseResult, bool, error) {
	switch asset.State {
	case "active", "retired":
		result, err := s.readStoreProfileImageCase(ctx, scope, actorID, caseID, true)
		return result, true, err
	case "failed":
		return postgres.JoiningCaseResult{}, true, postgres.ErrStoreProfileMediaFailed
	case "pending":
		if current.Case.Version != expectedVersion {
			return postgres.JoiningCaseResult{}, true, postgres.ErrStoreProfileMediaVersion
		}
		return postgres.JoiningCaseResult{}, false, nil
	default:
		return postgres.JoiningCaseResult{}, true, postgres.ErrStoreProfileMediaFailed
	}
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
