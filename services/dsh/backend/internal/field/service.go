package field

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"math"
	"regexp"
	"strings"
	"unicode/utf8"

	identityintegration "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/identity"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/joiningcase"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/media"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	identityclient "github.com/bthwani2-boop/samrim/services/identity/clients/go"
)

var (
	ErrInvalidInput               = errors.New("Field input is invalid")
	ErrOperatorNotActive          = errors.New("operator is not active")
	ErrFieldSessionForbidden      = errors.New("an active app-field session is required")
	ErrFieldIdentityUnavailable   = errors.New("Field Identity role was not provisioned")
	ErrManagedRoleNotEligible     = errors.New("Field managed role is not currently eligible")
	ErrManagedRoleVersionConflict = errors.New("Field managed role version is stale")
)

var phoneE164Pattern = regexp.MustCompile(`^\+[1-9][0-9]{7,14}$`)

type Service struct {
	identity *identityintegration.Client
	db       *sql.DB
	media    media.Store
}

func New(identity *identityintegration.Client, db *sql.DB, mediaStore media.Store) (*Service, error) {
	if identity == nil || db == nil || mediaStore == nil {
		return nil, errors.New("Field configuration is invalid")
	}
	return &Service{identity: identity, db: db, media: mediaStore}, nil
}

func (s *Service) UploadJoiningCaseStoreImage(ctx context.Context, accessToken, caseID, idempotencyKey, correlationID string, expectedVersion int, contentType string, data []byte) (postgres.JoiningCaseResult, error) {
	identity, err := s.requireEligibleField(ctx, accessToken)
	if err != nil {
		return postgres.JoiningCaseResult{}, err
	}
	caseID = strings.TrimSpace(caseID)
	if caseID == "" || expectedVersion < 1 || !validMutation(idempotencyKey, correlationID, identity.Subject) {
		return postgres.JoiningCaseResult{}, ErrInvalidInput
	}
	current, err := postgres.ReadJoiningCaseForField(ctx, s.db, identity.Subject, caseID)
	if err != nil {
		return postgres.JoiningCaseResult{}, err
	}
	if current.Case.State != "draft" && current.Case.State != "needs_correction" {
		return postgres.JoiningCaseResult{}, postgres.ErrJoiningCaseState
	}
	if current.Case.Version != expectedVersion {
		return postgres.JoiningCaseResult{}, postgres.ErrJoiningCaseVersion
	}
	actualType, _, _, err := media.ValidateImageBytes(data)
	if err != nil || (strings.TrimSpace(contentType) != "" && strings.TrimSpace(contentType) != actualType) {
		return postgres.JoiningCaseResult{}, ErrInvalidInput
	}
	digest := sha256.Sum256(data)
	sha := hex.EncodeToString(digest[:])
	hash := postgres.HashStoreProfileMediaUploadRequest(caseID, sha, expectedVersion)
	assetHash := sha256.Sum256([]byte(caseID + "\x00" + strings.TrimSpace(idempotencyKey)))
	assetID := "store_profile_media_" + hex.EncodeToString(assetHash[:])
	objectKey, err := media.KeyForStoreProfileUpload(assetID, idempotencyKey, sha, actualType)
	if err != nil {
		return postgres.JoiningCaseResult{}, ErrInvalidInput
	}
	uri := s.media.PublicURL(objectKey)
	if uri == "" {
		return postgres.JoiningCaseResult{}, errors.New("store profile media storage is unavailable")
	}
	asset, replayed, err := postgres.RegisterStoreProfileMediaAssetPending(ctx, s.db, postgres.StoreProfileMediaAssetInput{ID: assetID, JoiningCaseID: caseID, IdempotencyKey: strings.TrimSpace(idempotencyKey), RequestHash: hash, ExpectedCaseVersion: expectedVersion, ObjectKey: objectKey, URI: uri, ContentSHA256: sha, ContentType: actualType, ByteSize: int64(len(data)), ActingActorID: identity.Subject, CorrelationID: strings.TrimSpace(correlationID)})
	if err != nil {
		return postgres.JoiningCaseResult{}, err
	}
	if replayed {
		switch asset.State {
		case "active", "retired":
			return postgres.ReadJoiningCaseForField(ctx, s.db, identity.Subject, caseID)
		case "failed":
			return postgres.JoiningCaseResult{}, postgres.ErrStoreProfileMediaFailed
		}
	}
	if err := s.media.Put(ctx, objectKey, bytes.NewReader(data), int64(len(data)), actualType); err != nil {
		_ = postgres.MarkStoreProfileMediaAssetFailed(ctx, s.db, asset.ID, err.Error())
		return postgres.JoiningCaseResult{}, errors.New("store profile media storage is unavailable")
	}
	if _, err := postgres.ActivateStoreProfileMediaAsset(ctx, s.db, asset.ID, caseID, expectedVersion, strings.TrimSpace(idempotencyKey), hash, identity.Subject, strings.TrimSpace(correlationID)); err != nil {
		return postgres.JoiningCaseResult{}, err
	}
	result, err := postgres.ReadJoiningCaseForField(ctx, s.db, identity.Subject, caseID)
	result.Replayed = replayed
	return result, err
}

func (s *Service) Admit(ctx context.Context, phone, idempotencyKey, actingActorID, correlationID string) (postgres.FieldAdmission, bool, error) {
	phone = strings.TrimSpace(phone)
	idempotencyKey = strings.TrimSpace(idempotencyKey)
	actingActorID = strings.TrimSpace(actingActorID)
	correlationID = strings.TrimSpace(correlationID)
	if !phoneE164Pattern.MatchString(phone) || !validMutation(idempotencyKey, correlationID, actingActorID) {
		return postgres.FieldAdmission{}, false, ErrInvalidInput
	}
	if err := s.requireOperator(ctx, actingActorID); err != nil {
		return postgres.FieldAdmission{}, false, err
	}
	roles, err := s.identity.SearchFieldRolesByPhoneE164(ctx, phone)
	if err != nil {
		return postgres.FieldAdmission{}, false, err
	}
	var existingRole identityclient.ActorRoleView
	for _, role := range roles.Items {
		if role.PhoneE164 != phone {
			continue
		}
		if existingRole.ActorID != "" {
			return postgres.FieldAdmission{}, false, ErrFieldIdentityUnavailable
		}
		existingRole = role
	}
	if existingRole.ActorID != "" {
		if existingRole.Role != "field" || !existingRole.Enabled || !existingRole.SecurityEnabled {
			return postgres.FieldAdmission{}, false, ErrManagedRoleNotEligible
		}
		current, readErr := postgres.ReadFieldAdmissionForActor(ctx, s.db, existingRole.ActorID)
		if readErr == nil {
			if current.State == "eligible" {
				return current, true, nil
			}
			return postgres.FieldAdmission{}, false, ErrManagedRoleNotEligible
		}
		if !errors.Is(readErr, postgres.ErrFieldAdmissionNotFound) {
			return postgres.FieldAdmission{}, false, readErr
		}
	}
	hash := postgres.HashFieldAdmissionRequest(phone)
	admission, operationKey, replayed, err := postgres.CreateFieldAdmissionCandidate(ctx, s.db, phone, idempotencyKey, hash, actingActorID, correlationID)
	if err != nil {
		return postgres.FieldAdmission{}, false, err
	}
	if admission.State == "eligible" {
		return admission, replayed, nil
	}
	role := existingRole
	if role.ActorID == "" {
		role, err = s.identity.ProvisionFieldWithContext(ctx, identityintegration.ActorInput{PhoneE164: phone}, correlationID, actingActorID)
		if err != nil {
			return postgres.FieldAdmission{}, false, err
		}
	}
	if role.Role != "field" || strings.TrimSpace(role.ActorID) == "" {
		return postgres.FieldAdmission{}, false, ErrFieldIdentityUnavailable
	}
	bound, err := postgres.BindFieldAdmission(ctx, s.db, admission.ID, role.ActorID, operationKey, hash, actingActorID, correlationID)
	if err != nil {
		return postgres.FieldAdmission{}, false, err
	}
	return bound, replayed, nil
}

func (s *Service) ReadForOperator(ctx context.Context, admissionID, actingActorID string) (postgres.FieldAdmission, error) {
	if err := s.requireOperator(ctx, actingActorID); err != nil {
		return postgres.FieldAdmission{}, err
	}
	return postgres.ReadFieldAdmission(ctx, s.db, admissionID)
}

func (s *Service) ReadForOperatorByActor(ctx context.Context, actorID, actingActorID string) (postgres.FieldAdmission, error) {
	if strings.TrimSpace(actorID) == "" {
		return postgres.FieldAdmission{}, ErrInvalidInput
	}
	if err := s.requireOperator(ctx, actingActorID); err != nil {
		return postgres.FieldAdmission{}, err
	}
	return postgres.ReadFieldAdmissionForActor(ctx, s.db, actorID)
}

func (s *Service) ReadForField(ctx context.Context, accessToken string) (postgres.FieldAdmission, error) {
	identity, err := s.requireField(ctx, accessToken)
	if err != nil {
		return postgres.FieldAdmission{}, err
	}
	return postgres.ReadFieldAdmissionForActor(ctx, s.db, identity.Subject)
}

func (s *Service) SetManagedRoleEnabled(ctx context.Context, actorID, operatorActorID, correlationID, idempotencyKey, reason string, expectedVersion int, enabled bool) error {
	actorID = strings.TrimSpace(actorID)
	operatorActorID = strings.TrimSpace(operatorActorID)
	correlationID = strings.TrimSpace(correlationID)
	idempotencyKey = strings.TrimSpace(idempotencyKey)
	if actorID == "" || correlationID == "" || idempotencyKey == "" || expectedVersion < 1 || !validMutation(idempotencyKey, correlationID, operatorActorID) {
		return ErrInvalidInput
	}
	if err := s.requireOperator(ctx, operatorActorID); err != nil {
		return err
	}
	lifecycle, err := postgres.LockFieldLifecycle(ctx, s.db, actorID)
	if err != nil {
		return err
	}
	defer func() { _ = lifecycle.Rollback() }()
	identityRole, err := s.identity.ReadActorRole(ctx, actorID, "field")
	if err != nil {
		return err
	}
	if identityRole.Role != "field" {
		return ErrManagedRoleNotEligible
	}
	if identityRole.Enabled != enabled && identityRole.RoleVersion != expectedVersion {
		return ErrManagedRoleVersionConflict
	}
	accessHash := postgres.HashFieldAccessRequest(actorID, enabled, expectedVersion)
	if enabled {
		admission, err := postgres.ReadFieldAdmissionForActor(ctx, s.db, actorID)
		if err != nil {
			return err
		}
		if admission.State != "eligible" && admission.State != "suspended" {
			return ErrManagedRoleNotEligible
		}
		if identityRole.Enabled != enabled {
			if err := s.identity.SetRoleEnabledWithContext(ctx, actorID, "field", true, correlationID, strings.TrimSpace(reason), operatorActorID, expectedVersion); err != nil {
				return err
			}
		}
		if _, err := postgres.RestoreFieldAdmission(ctx, s.db, actorID, idempotencyKey, accessHash, operatorActorID, correlationID); err != nil {
			return err
		}
		return lifecycle.Commit()
	}
	if _, err := postgres.SuspendFieldAdmission(ctx, s.db, actorID, idempotencyKey, accessHash, operatorActorID, correlationID); err != nil {
		return err
	}
	if identityRole.Enabled == enabled {
		return lifecycle.Commit()
	}
	if err := s.identity.SetRoleEnabledWithContext(ctx, actorID, "field", false, correlationID, strings.TrimSpace(reason), operatorActorID, expectedVersion); err != nil {
		return err
	}
	return lifecycle.Commit()
}

func (s *Service) AuthorizeReenrollment(ctx context.Context, actorID, operatorActorID, correlationID, reason string, expectedAdmissionVersion, expectedActorVersion, expectedRoleVersion int) error {
	actorID = strings.TrimSpace(actorID)
	operatorActorID = strings.TrimSpace(operatorActorID)
	correlationID = strings.TrimSpace(correlationID)
	reason = strings.TrimSpace(reason)
	if actorID == "" || expectedAdmissionVersion < 1 || expectedActorVersion < 1 || expectedRoleVersion < 1 || utf8.RuneCountInString(reason) < 5 || utf8.RuneCountInString(reason) > 500 || !validMutation("field-reenrollment", correlationID, operatorActorID) {
		return ErrInvalidInput
	}
	if err := s.requireOperator(ctx, operatorActorID); err != nil {
		return err
	}
	lifecycle, err := postgres.LockFieldLifecycle(ctx, s.db, actorID)
	if err != nil {
		return err
	}
	defer func() { _ = lifecycle.Rollback() }()
	admission, err := postgres.ReadFieldAdmissionForActor(ctx, s.db, actorID)
	if err != nil {
		return err
	}
	if admission.State != "eligible" {
		return ErrManagedRoleNotEligible
	}
	if admission.Version != expectedAdmissionVersion {
		return postgres.ErrFieldVersionConflict
	}
	if err := s.identity.AuthorizeReenrollmentWithContext(ctx, actorID, "field", correlationID, reason, operatorActorID, expectedActorVersion, expectedRoleVersion); err != nil {
		return err
	}
	return lifecycle.Commit()
}

func (s *Service) CreateJoiningCase(ctx context.Context, accessToken, idempotencyKey, correlationID, phone, businessName, firstStoreName, serviceCityID, verticalID string, latitude, longitude float64, rawFulfillmentModes []string) (postgres.JoiningCaseResult, error) {
	identity, err := s.requireEligibleField(ctx, accessToken)
	if err != nil {
		return postgres.JoiningCaseResult{}, err
	}
	phone = strings.TrimSpace(phone)
	businessName = strings.TrimSpace(businessName)
	firstStoreName = strings.TrimSpace(firstStoreName)
	serviceCityID = strings.TrimSpace(serviceCityID)
	verticalID = strings.TrimSpace(verticalID)
	fulfillmentModes, modesErr := postgres.NormalizeStoreFulfillmentModes(rawFulfillmentModes)
	if modesErr != nil {
		return postgres.JoiningCaseResult{}, ErrInvalidInput
	}
	if !phoneE164Pattern.MatchString(phone) || len(businessName) < 2 || len(businessName) > 160 || len(firstStoreName) < 2 || len(firstStoreName) > 160 || serviceCityID == "" || verticalID == "" || math.IsNaN(latitude) || math.IsInf(latitude, 0) || math.IsNaN(longitude) || math.IsInf(longitude, 0) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180 || strings.TrimSpace(idempotencyKey) == "" || len(strings.TrimSpace(correlationID)) < 8 {
		return postgres.JoiningCaseResult{}, ErrInvalidInput
	}
	city, err := postgres.ReadServiceCity(ctx, s.db, serviceCityID)
	if err != nil || !city.Active {
		return postgres.JoiningCaseResult{}, joiningcase.ErrServiceCityUnavailable
	}
	vertical, err := postgres.ReadCommerceVertical(ctx, s.db, verticalID)
	if err != nil || !vertical.Active {
		return postgres.JoiningCaseResult{}, postgres.ErrCatalogVerticalNotFound
	}
	return postgres.CreateJoiningCaseForField(ctx, s.db, strings.TrimSpace(idempotencyKey), postgres.HashJoiningCaseFieldRequest(identity.Subject, phone, businessName, firstStoreName, serviceCityID, verticalID, latitude, longitude, fulfillmentModes), identity.Subject, strings.TrimSpace(correlationID), phone, businessName, firstStoreName, serviceCityID, verticalID, latitude, longitude, fulfillmentModes)
}

func (s *Service) ListJoiningCases(ctx context.Context, accessToken string, limit int) (postgres.JoiningCaseListResult, error) {
	identity, err := s.requireEligibleField(ctx, accessToken)
	if err != nil {
		return postgres.JoiningCaseListResult{}, err
	}
	return postgres.ListJoiningCasesForField(ctx, s.db, identity.Subject, limit)
}

func (s *Service) ReadJoiningCase(ctx context.Context, accessToken, caseID string) (postgres.JoiningCaseResult, error) {
	identity, err := s.requireEligibleField(ctx, accessToken)
	if err != nil {
		return postgres.JoiningCaseResult{}, err
	}
	return postgres.ReadJoiningCaseForField(ctx, s.db, identity.Subject, caseID)
}

func (s *Service) SubmitJoiningCase(ctx context.Context, accessToken, caseID string, expectedVersion int, idempotencyKey, correlationID string) (postgres.JoiningCaseResult, error) {
	identity, err := s.requireEligibleField(ctx, accessToken)
	if err != nil {
		return postgres.JoiningCaseResult{}, err
	}
	caseID = strings.TrimSpace(caseID)
	if caseID == "" || expectedVersion < 1 || strings.TrimSpace(idempotencyKey) == "" || len(strings.TrimSpace(correlationID)) < 8 {
		return postgres.JoiningCaseResult{}, ErrInvalidInput
	}
	current, err := postgres.ReadJoiningCaseForField(ctx, s.db, identity.Subject, caseID)
	if err != nil {
		return postgres.JoiningCaseResult{}, err
	}
	if current.Case.Origin != "field" {
		return postgres.JoiningCaseResult{}, postgres.ErrJoiningCaseState
	}
	if current.Case.State != "draft" {
		if current.Case.PartnerActorID == "" {
			return postgres.JoiningCaseResult{}, postgres.ErrJoiningCaseState
		}
		return postgres.SubmitJoiningCase(ctx, s.db, caseID, current.Case.PartnerActorID, expectedVersion, strings.TrimSpace(idempotencyKey), postgres.HashJoiningCaseSubmit(caseID, current.Case.PartnerActorID, expectedVersion), identity.Subject, strings.TrimSpace(correlationID))
	}
	if current.Case.Version != expectedVersion {
		return postgres.JoiningCaseResult{}, postgres.ErrJoiningCaseVersion
	}
	actorRole, err := s.identity.ProvisionPartnerWithContext(ctx, identityintegration.ActorInput{PhoneE164: current.Case.ContactPhoneE164}, correlationID, identity.Subject)
	if err != nil {
		return postgres.JoiningCaseResult{}, err
	}
	if actorRole.Role != "partner" || strings.TrimSpace(actorRole.ActorID) == "" {
		return postgres.JoiningCaseResult{}, joiningcase.ErrPartnerIdentityUnavailable
	}
	return postgres.SubmitJoiningCase(ctx, s.db, caseID, actorRole.ActorID, expectedVersion, strings.TrimSpace(idempotencyKey), postgres.HashJoiningCaseSubmit(caseID, actorRole.ActorID, expectedVersion), identity.Subject, strings.TrimSpace(correlationID))
}

func (s *Service) requireField(ctx context.Context, accessToken string) (identityclient.ActorIdentity, error) {
	identity, err := s.identity.ReadSession(ctx, strings.TrimSpace(accessToken))
	if err != nil {
		return identityclient.ActorIdentity{}, err
	}
	if identity.Role != "field" || identity.Surface != "app-field" || strings.TrimSpace(identity.Subject) == "" {
		return identityclient.ActorIdentity{}, ErrFieldSessionForbidden
	}
	return identity, nil
}

func (s *Service) requireEligibleField(ctx context.Context, accessToken string) (identityclient.ActorIdentity, error) {
	identity, err := s.requireField(ctx, accessToken)
	if err != nil {
		return identityclient.ActorIdentity{}, err
	}
	admission, err := postgres.ReadFieldAdmissionForActor(ctx, s.db, identity.Subject)
	if err != nil {
		return identityclient.ActorIdentity{}, err
	}
	if admission.State != "eligible" {
		return identityclient.ActorIdentity{}, ErrFieldSessionForbidden
	}
	return identity, nil
}

func (s *Service) requireOperator(ctx context.Context, actorID string) error {
	operator, err := s.identity.ReadActorRole(ctx, strings.TrimSpace(actorID), "operator")
	if err != nil {
		return err
	}
	if operator.Role != "operator" || !operator.Enabled || !operator.SecurityEnabled || operator.ActivatedAt == nil {
		return ErrOperatorNotActive
	}
	return s.identity.RequireOperatorPermission(ctx, strings.TrimSpace(actorID), "partners")
}

func validMutation(idempotencyKey, correlationID, actingActorID string) bool {
	return len(strings.TrimSpace(idempotencyKey)) >= 8 && len(strings.TrimSpace(idempotencyKey)) <= 128 && len(strings.TrimSpace(correlationID)) >= 8 && len(strings.TrimSpace(correlationID)) <= 128 && strings.TrimSpace(actingActorID) != ""
}

func validCoordinates(latitude, longitude float64) bool {
	return !math.IsNaN(latitude) && !math.IsInf(latitude, 0) && !math.IsNaN(longitude) && !math.IsInf(longitude, 0) && latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180
}
