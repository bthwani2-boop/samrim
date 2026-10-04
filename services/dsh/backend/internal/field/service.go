package field

import (
	"context"
	"database/sql"
	"errors"
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/contract"
	identityintegration "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/identity"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/joiningcase"
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
	identity     *identityintegration.Client
	db           *sql.DB
	evidenceKeys *postgres.JoiningCaseEvidenceKeyring
}

func New(identity *identityintegration.Client, db *sql.DB, evidenceKeys *postgres.JoiningCaseEvidenceKeyring) (*Service, error) {
	if identity == nil || db == nil || evidenceKeys == nil {
		return nil, errors.New("Field configuration is invalid")
	}
	return &Service{identity: identity, db: db, evidenceKeys: evidenceKeys}, nil
}

func (s *Service) Admit(ctx context.Context, fullNameAr, phone, serviceCityID, idempotencyKey, actingActorID, correlationID string) (postgres.FieldAdmission, bool, error) {
	fullNameAr = strings.TrimSpace(fullNameAr)
	phone = normalizePhoneE164(phone)
	serviceCityID = strings.TrimSpace(serviceCityID)
	idempotencyKey = strings.TrimSpace(idempotencyKey)
	actingActorID = strings.TrimSpace(actingActorID)
	correlationID = strings.TrimSpace(correlationID)
	if len([]rune(fullNameAr)) < 2 || len([]rune(fullNameAr)) > 120 || !phoneE164Pattern.MatchString(phone) || serviceCityID == "" || !validMutation(idempotencyKey, correlationID, actingActorID) {
		return postgres.FieldAdmission{}, false, ErrInvalidInput
	}
	if err := s.requireOperator(ctx, actingActorID); err != nil {
		return postgres.FieldAdmission{}, false, err
	}
	hash := postgres.HashFieldAdmissionRequest(fullNameAr, phone, serviceCityID)
	admission, _, replayed, err := postgres.CreateFieldAdmissionCandidate(ctx, s.db, postgres.FieldAdmissionCandidateInput{FullNameAr: fullNameAr, Phone: phone, ServiceCityID: serviceCityID, IdempotencyKey: idempotencyKey, RequestHash: hash, ActingActorID: actingActorID, CorrelationID: correlationID})
	if err != nil {
		return postgres.FieldAdmission{}, false, err
	}
	return admission, replayed, nil
}

func normalizePhoneE164(value string) string {
	return strings.Map(func(r rune) rune {
		switch {
		case r >= '0' && r <= '9', r == '+':
			return r
		case r >= '\u0660' && r <= '\u0669':
			return '0' + (r - '\u0660')
		case r >= '\u06f0' && r <= '\u06f9':
			return '0' + (r - '\u06f0')
		case unicode.IsSpace(r), r == '-', r == '(', r == ')':
			return -1
		default:
			return r
		}
	}, strings.TrimSpace(value))
}

func (s *Service) Approve(ctx context.Context, admissionID string, expectedVersion int, idempotencyKey, actingActorID, correlationID string) (postgres.FieldAdmission, bool, error) {
	if !validMutation(idempotencyKey, correlationID, actingActorID) {
		return postgres.FieldAdmission{}, false, ErrInvalidInput
	}
	if expectedVersion < 1 {
		return postgres.FieldAdmission{}, false, ErrInvalidInput
	}
	if err := s.requireOperator(ctx, actingActorID); err != nil {
		return postgres.FieldAdmission{}, false, err
	}
	return postgres.ApproveFieldAdmission(ctx, s.db, admissionID, expectedVersion, idempotencyKey, postgres.HashFieldAdmissionApprovalRequest(admissionID, expectedVersion), actingActorID, correlationID)
}

func (s *Service) Provision(ctx context.Context, admissionID, idempotencyKey, actingActorID, correlationID string) (postgres.FieldAdmission, error) {
	if !validMutation(idempotencyKey, correlationID, actingActorID) {
		return postgres.FieldAdmission{}, ErrInvalidInput
	}
	if err := s.requireOperator(ctx, actingActorID); err != nil {
		return postgres.FieldAdmission{}, err
	}
	admission, err := postgres.ReadFieldAdmission(ctx, s.db, admissionID)
	if err != nil {
		return postgres.FieldAdmission{}, err
	}
	if admission.State == "eligible" {
		return admission, nil
	}
	if admission.State != "pending_identity" || admission.PhoneE164 == "" {
		return postgres.FieldAdmission{}, postgres.ErrFieldAdmissionNotEligible
	}
	roles, err := s.identity.SearchFieldRolesByPhoneE164(ctx, admission.PhoneE164)
	if err != nil {
		return postgres.FieldAdmission{}, err
	}
	var role identityclient.ActorRoleView
	for _, candidate := range roles.Items {
		if candidate.PhoneE164 != admission.PhoneE164 {
			continue
		}
		if role.ActorID != "" {
			return postgres.FieldAdmission{}, ErrFieldIdentityUnavailable
		}
		role = candidate
	}
	if role.ActorID == "" {
		role, err = s.identity.ProvisionFieldWithContext(ctx, identityintegration.ActorInput{PhoneE164: admission.PhoneE164}, correlationID, actingActorID)
		if err != nil {
			return postgres.FieldAdmission{}, err
		}
	}
	if role.Role != "field" || strings.TrimSpace(role.ActorID) == "" {
		return postgres.FieldAdmission{}, ErrFieldIdentityUnavailable
	}
	if !role.Enabled || !role.SecurityEnabled {
		return postgres.FieldAdmission{}, ErrManagedRoleNotEligible
	}
	bound, err := postgres.BindFieldAdmission(ctx, s.db, admission.ID, role.ActorID, idempotencyKey, postgres.HashFieldAdmissionTransition("bind", admissionID), actingActorID, correlationID)
	if err != nil {
		return postgres.FieldAdmission{}, err
	}
	return bound, nil
}

func (s *Service) ReadForOperator(ctx context.Context, admissionID, actingActorID string) (postgres.FieldAdmission, error) {
	if err := s.requireOperator(ctx, actingActorID); err != nil {
		return postgres.FieldAdmission{}, err
	}
	return postgres.ReadFieldAdmission(ctx, s.db, admissionID)
}

func (s *Service) ListAdmissionsForOperator(ctx context.Context, query, state, sort string, limit int, cursor, actingActorID string) (postgres.FieldAdmissionPage, error) {
	if err := s.requireOperator(ctx, actingActorID); err != nil {
		return postgres.FieldAdmissionPage{}, err
	}
	return postgres.ListFieldAdmissions(ctx, s.db, query, state, sort, limit, cursor)
}

func (s *Service) UpdateAdmissionProfile(ctx context.Context, admissionID, fullNameAr string, expectedVersion int, idempotencyKey, actingActorID, correlationID string) (postgres.FieldAdmission, bool, error) {
	if expectedVersion < 1 || !validMutation(idempotencyKey, correlationID, actingActorID) {
		return postgres.FieldAdmission{}, false, ErrInvalidInput
	}
	if err := s.requireOperator(ctx, actingActorID); err != nil {
		return postgres.FieldAdmission{}, false, err
	}
	return postgres.UpdateFieldAdmissionProfile(ctx, s.db, admissionID, fullNameAr, expectedVersion, idempotencyKey, postgres.HashFieldAdmissionProfileRequest(admissionID, fullNameAr, expectedVersion), actingActorID, correlationID)
}

func (s *Service) ReviewAdmissionProfile(ctx context.Context, admissionID string, expectedVersion int, idempotencyKey, actingActorID, correlationID string) (postgres.FieldAdmission, bool, error) {
	if expectedVersion < 1 || !validMutation(idempotencyKey, correlationID, actingActorID) {
		return postgres.FieldAdmission{}, false, ErrInvalidInput
	}
	if err := s.requireOperator(ctx, actingActorID); err != nil {
		return postgres.FieldAdmission{}, false, err
	}
	return postgres.ReviewFieldAdmissionProfile(ctx, s.db, admissionID, expectedVersion, idempotencyKey, postgres.HashFieldAdmissionProfileReviewRequest(admissionID, expectedVersion), actingActorID, correlationID)
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
	admission, err := postgres.ReadFieldAdmissionForActor(ctx, s.db, identity.Subject)
	if err != nil {
		return postgres.FieldAdmission{}, err
	}
	role, err := s.identity.ReadActorRole(ctx, identity.Subject, "field")
	if err != nil {
		return postgres.FieldAdmission{}, err
	}
	if role.Role != "field" {
		return postgres.FieldAdmission{}, ErrFieldIdentityUnavailable
	}
	admission.PhoneE164 = role.PhoneE164
	return admission, nil
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
		if (admission.State != "eligible" && admission.State != "suspended") || admission.RequiresProfileReview || admission.FullNameAr == "" {
			return ErrManagedRoleNotEligible
		}
		if admission.State == "suspended" {
			if _, err := postgres.RestoreFieldAdmission(ctx, s.db, actorID, idempotencyKey, accessHash, operatorActorID, correlationID); err != nil {
				return err
			}
		}
		if identityRole.Enabled != enabled {
			if err := s.identity.SetRoleEnabledWithContext(ctx, actorID, "field", true, correlationID, strings.TrimSpace(reason), operatorActorID, expectedVersion); err != nil {
				return err
			}
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
	if admission.State != "eligible" || admission.RequiresProfileReview || strings.TrimSpace(admission.FullNameAr) == "" {
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

func (s *Service) CreateJoiningCase(ctx context.Context, accessToken, idempotencyKey, correlationID string, input contract.CreateJoiningCaseRequest) (postgres.JoiningCaseResult, error) {
	identity, err := s.requireEligibleField(ctx, accessToken)
	if err != nil {
		return postgres.JoiningCaseResult{}, err
	}
	request, err := joiningcase.NormalizeCreateRequest(input)
	if err != nil {
		return postgres.JoiningCaseResult{}, ErrInvalidInput
	}
	if strings.TrimSpace(idempotencyKey) == "" || len(strings.TrimSpace(correlationID)) < 8 {
		return postgres.JoiningCaseResult{}, ErrInvalidInput
	}
	requestHash, err := joiningcase.HashCreateRequest(s.evidenceKeys, "field-joining-case-create", identity.Subject, request)
	if err != nil {
		return postgres.JoiningCaseResult{}, err
	}
	return postgres.CreateJoiningCaseForField(ctx, s.db, postgres.CreateJoiningCaseInput{IdempotencyKey: strings.TrimSpace(idempotencyKey), RequestHash: requestHash, ActingActorID: identity.Subject, CorrelationID: strings.TrimSpace(correlationID), EvidenceKeyring: s.evidenceKeys, Request: request})
}

func (s *Service) UploadJoiningCaseProofImage(ctx context.Context, accessToken, caseID, idempotencyKey, correlationID string, expectedVersion int, declaredContentType string, data []byte) (postgres.JoiningCaseResult, error) {
	identity, err := s.requireEligibleField(ctx, accessToken)
	if err != nil {
		return postgres.JoiningCaseResult{}, err
	}
	result, err := joiningcase.UploadPrivateProofImage(ctx, s.db, s.evidenceKeys, caseID, identity.Subject, "field", "field-proof-image-upload", idempotencyKey, correlationID, expectedVersion, declaredContentType, data)
	if err != nil {
		if errors.Is(err, joiningcase.ErrInvalidInput) {
			return postgres.JoiningCaseResult{}, ErrInvalidInput
		}
		return postgres.JoiningCaseResult{}, err
	}
	return result, nil
}

func (s *Service) ListJoiningCases(ctx context.Context, accessToken, queryText string, limit int, cursor string) (postgres.JoiningCaseListResult, error) {
	identity, err := s.requireEligibleField(ctx, accessToken)
	if err != nil {
		return postgres.JoiningCaseListResult{}, err
	}
	return postgres.ListJoiningCasesForField(ctx, s.db, identity.Subject, queryText, limit, cursor)
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
	return postgres.RequestFieldJoiningCaseAdmission(ctx, s.db, caseID, identity.Subject, expectedVersion, strings.TrimSpace(idempotencyKey), postgres.HashFieldJoiningCaseAdmission(caseID, identity.Subject, expectedVersion), strings.TrimSpace(correlationID))
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
	if admission.State != "eligible" || admission.RequiresProfileReview || admission.FullNameAr == "" {
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
