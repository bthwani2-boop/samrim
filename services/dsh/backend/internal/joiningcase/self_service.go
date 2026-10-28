package joiningcase

import (
	"context"
	"errors"
	"strings"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/contract"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	identityclient "github.com/bthwani2-boop/samrim/services/identity/clients/go"
)

var ErrSelfServiceApplicantIdentityMismatch = errors.New("self-service applicant Identity account no longer matches the registered case")

// Identity authenticates the applicant as a client before Partner admission.
// This never creates a Partner role or bypasses the Operator review.
func (s *Service) selfServiceApplicant(ctx context.Context, token string) (string, string, error) {
	session, err := s.identity.ReadSession(ctx, strings.TrimSpace(token))
	if err != nil {
		return "", "", err
	}
	if session.Role != "client" || session.Surface != "app-client" || strings.TrimSpace(session.Subject) == "" {
		return "", "", ErrPartnerSessionForbidden
	}
	actor, err := s.identity.ReadActorRole(ctx, session.Subject, "client")
	if err != nil {
		return "", "", err
	}
	if !validProspectIdentity(session, actor) {
		return "", "", ErrPartnerSessionForbidden
	}
	return session.Subject, actor.PhoneE164, nil
}

func validProspectIdentity(session identityclient.ActorIdentity, actor identityclient.ActorRoleView) bool {
	return session.Role == "client" && session.Surface == "app-client" && strings.TrimSpace(session.Subject) != "" && actor.ActorID == session.Subject && actor.Role == "client" && actor.Enabled && actor.SecurityEnabled && strings.TrimSpace(actor.PhoneE164) != ""
}

func (s *Service) CreateSelfService(ctx context.Context, input contract.CreateJoiningCaseRequest, accessToken, idempotencyKey, correlationID string) (postgres.JoiningCaseResult, error) {
	actorID, phone, err := s.selfServiceApplicant(ctx, accessToken)
	if err != nil {
		return postgres.JoiningCaseResult{}, err
	}
	request, err := NormalizeCreateRequest(input)
	if err != nil {
		return postgres.JoiningCaseResult{}, err
	}
	if request.Phone != phone {
		return postgres.JoiningCaseResult{}, ErrPartnerSessionForbidden
	}
	if request.WalletProviderKey != "" {
		active, err := postgres.IsActiveWalletProvider(ctx, s.db, request.WalletProviderKey)
		if err != nil {
			return postgres.JoiningCaseResult{}, err
		}
		if !active {
			return postgres.JoiningCaseResult{}, ErrInvalidInput
		}
	}
	hash, err := HashCreateRequest(s.evidenceKeys, "self-service-joining-case", actorID, request)
	if err != nil {
		return postgres.JoiningCaseResult{}, err
	}
	return postgres.CreateSelfServiceJoiningCase(ctx, s.db, postgres.CreateJoiningCaseInput{
		IdempotencyKey: strings.TrimSpace(idempotencyKey), RequestHash: hash, ActingActorID: actorID, CorrelationID: strings.TrimSpace(correlationID), EvidenceKeyring: s.evidenceKeys, Request: request,
	})
}

func (s *Service) ReadSelfService(ctx context.Context, accessToken string) (postgres.JoiningCaseResult, error) {
	actorID, phone, err := s.selfServiceApplicant(ctx, accessToken)
	if err != nil {
		return postgres.JoiningCaseResult{}, err
	}
	return postgres.ReadSelfServiceJoiningCase(ctx, s.db, actorID, phone)
}
