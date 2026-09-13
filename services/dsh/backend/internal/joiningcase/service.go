package joiningcase

import (
	"context"
	"database/sql"
	"errors"
	"regexp"
	"strings"

	identityintegration "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/identity"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

var (
	ErrOperatorNotActive          = errors.New("operator actor is not active")
	ErrPartnerSessionForbidden    = errors.New("an active app-partner session is required")
	ErrPartnerIdentityUnavailable = errors.New("partner identity admission is unavailable")
)

var phoneE164Pattern = regexp.MustCompile(`^\+[1-9][0-9]{7,14}$`)

type Service struct {
	identity *identityintegration.Client
	db       *sql.DB
}

func New(identity *identityintegration.Client, db *sql.DB) (*Service, error) {
	if identity == nil || db == nil {
		return nil, errors.New("joining case configuration is invalid")
	}
	return &Service{identity: identity, db: db}, nil
}

func (s *Service) Create(ctx context.Context, input postgres.JoiningCaseRecord, idempotencyKey, actingActorID, correlationID string) (postgres.JoiningCaseResult, error) {
	phone := strings.TrimSpace(input.ContactPhoneE164)
	businessName := strings.TrimSpace(input.BusinessName)
	firstStoreName := strings.TrimSpace(input.FirstStoreName)
	if !phoneE164Pattern.MatchString(phone) || len(businessName) < 2 || len(businessName) > 160 || len(firstStoreName) < 2 || len(firstStoreName) > 160 {
		return postgres.JoiningCaseResult{}, errors.New("joining case facts are invalid")
	}
	if err := s.requireOperator(ctx, actingActorID); err != nil {
		return postgres.JoiningCaseResult{}, err
	}
	return postgres.CreateJoiningCase(ctx, s.db, strings.TrimSpace(idempotencyKey), postgres.HashJoiningCaseRequest(phone, businessName, firstStoreName), strings.TrimSpace(actingActorID), strings.TrimSpace(correlationID), phone, businessName, firstStoreName)
}

func (s *Service) Submit(ctx context.Context, caseID string, expectedVersion int, idempotencyKey, actingActorID, correlationID string) (postgres.JoiningCaseResult, error) {
	if err := s.requireOperator(ctx, actingActorID); err != nil {
		return postgres.JoiningCaseResult{}, err
	}
	current, err := postgres.ReadJoiningCase(ctx, s.db, caseID)
	if err != nil {
		return postgres.JoiningCaseResult{}, err
	}
	actorRole, err := s.identity.ProvisionPartnerWithContext(ctx, identityintegration.ActorInput{PhoneE164: current.Case.ContactPhoneE164}, correlationID, actingActorID)
	if err != nil {
		return postgres.JoiningCaseResult{}, err
	}
	if actorRole.Role != "partner" || strings.TrimSpace(actorRole.ActorID) == "" {
		return postgres.JoiningCaseResult{}, ErrPartnerIdentityUnavailable
	}
	return postgres.SubmitJoiningCase(ctx, s.db, caseID, actorRole.ActorID, expectedVersion, strings.TrimSpace(idempotencyKey), postgres.HashJoiningCaseSubmit(caseID, actorRole.ActorID, expectedVersion), strings.TrimSpace(actingActorID), strings.TrimSpace(correlationID))
}

func (s *Service) Review(ctx context.Context, caseID, decision, correctionReason string, expectedVersion int, idempotencyKey, actingActorID, correlationID string) (postgres.JoiningCaseResult, error) {
	if err := s.requireOperator(ctx, actingActorID); err != nil {
		return postgres.JoiningCaseResult{}, err
	}
	decision = strings.ToLower(strings.TrimSpace(decision))
	correctionReason = strings.TrimSpace(correctionReason)
	if decision != "approved" && decision != "needs_correction" {
		return postgres.JoiningCaseResult{}, postgres.ErrJoiningCaseInvalidDecision
	}
	if decision == "needs_correction" && (len(correctionReason) < 5 || len(correctionReason) > 500) {
		return postgres.JoiningCaseResult{}, errors.New("a correction reason of 5 to 500 characters is required")
	}
	return postgres.ReviewJoiningCase(ctx, s.db, caseID, decision, correctionReason, expectedVersion, strings.TrimSpace(idempotencyKey), postgres.HashJoiningCaseReview(caseID, decision, correctionReason, expectedVersion), strings.TrimSpace(actingActorID), strings.TrimSpace(correlationID))
}

func (s *Service) ReadForOperator(ctx context.Context, caseID, actingActorID string) (postgres.JoiningCaseResult, error) {
	if err := s.requireOperator(ctx, actingActorID); err != nil {
		return postgres.JoiningCaseResult{}, err
	}
	return postgres.ReadJoiningCase(ctx, s.db, caseID)
}

func (s *Service) ReadForPartner(ctx context.Context, accessToken string) (postgres.JoiningCaseResult, error) {
	identity, err := s.identity.ReadSession(ctx, strings.TrimSpace(accessToken))
	if err != nil {
		return postgres.JoiningCaseResult{}, err
	}
	if identity.Role != "partner" || identity.Surface != "app-partner" || strings.TrimSpace(identity.Subject) == "" {
		return postgres.JoiningCaseResult{}, ErrPartnerSessionForbidden
	}
	return postgres.ReadJoiningCaseForPartner(ctx, s.db, identity.Subject)
}

func (s *Service) requireOperator(ctx context.Context, actorID string) error {
	operator, err := s.identity.ReadActorRole(ctx, strings.TrimSpace(actorID), "operator")
	if err != nil {
		return err
	}
	if operator.Role != "operator" || !operator.Enabled || !operator.SecurityEnabled || operator.ActivatedAt == nil {
		return ErrOperatorNotActive
	}
	return nil
}
