package field

import (
	"context"
	"strings"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/contract"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/joiningcase"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

func (s *Service) CreateJoiningCaseDraft(ctx context.Context, accessToken, idempotencyKey, correlationID string, request contract.CreateJoiningCaseRequest) (postgres.JoiningCaseResult, error) {
	identity, err := s.requireEligibleField(ctx, accessToken)
	if err != nil {
		return postgres.JoiningCaseResult{}, err
	}
	normalized, err := joiningcase.NormalizeFieldDraftRequest(request)
	if err != nil {
		return postgres.JoiningCaseResult{}, ErrInvalidInput
	}
	if normalized.WalletProviderKey != "" {
		active, checkErr := postgres.IsActiveWalletProvider(ctx, s.db, normalized.WalletProviderKey)
		if checkErr != nil {
			return postgres.JoiningCaseResult{}, checkErr
		}
		if !active {
			return postgres.JoiningCaseResult{}, ErrInvalidInput
		}
	}
	idempotencyKey, correlationID = strings.TrimSpace(idempotencyKey), strings.TrimSpace(correlationID)
	if len(idempotencyKey) < 8 || len(idempotencyKey) > 128 || len(correlationID) < 8 || len(correlationID) > 128 {
		return postgres.JoiningCaseResult{}, ErrInvalidInput
	}
	requestHash, err := joiningcase.HashCreateRequest(s.evidenceKeys, "field-joining-case-create", identity.Subject, normalized)
	if err != nil {
		return postgres.JoiningCaseResult{}, err
	}
	return postgres.CreateFieldJoiningCaseDraft(ctx, s.db, postgres.CreateJoiningCaseInput{
		IdempotencyKey: idempotencyKey, RequestHash: requestHash, ActingActorID: identity.Subject,
		CorrelationID: correlationID, EvidenceKeyring: s.evidenceKeys, Request: normalized,
	})
}

func (s *Service) UpdateJoiningCaseDraft(ctx context.Context, accessToken, caseID string, expectedVersion int, idempotencyKey, correlationID string, request contract.CreateJoiningCaseRequest, preserveProofNumber bool) (postgres.JoiningCaseResult, error) {
	identity, err := s.requireEligibleField(ctx, accessToken)
	if err != nil {
		return postgres.JoiningCaseResult{}, err
	}
	normalized, err := joiningcase.NormalizeFieldDraftRequest(request)
	if err != nil {
		return postgres.JoiningCaseResult{}, ErrInvalidInput
	}
	current, readErr := postgres.ReadJoiningCaseForField(ctx, s.db, identity.Subject, caseID)
	if readErr != nil {
		return postgres.JoiningCaseResult{}, readErr
	}
	if normalized.WalletProviderKey == "" {
		normalized.WalletProviderKey = current.Case.WalletProviderKey
	}
	if normalized.WalletProviderKey != current.Case.WalletProviderKey {
		active, checkErr := postgres.IsActiveWalletProvider(ctx, s.db, normalized.WalletProviderKey)
		if checkErr != nil {
			return postgres.JoiningCaseResult{}, checkErr
		}
		if !active {
			return postgres.JoiningCaseResult{}, ErrInvalidInput
		}
	}
	caseID, idempotencyKey, correlationID = strings.TrimSpace(caseID), strings.TrimSpace(idempotencyKey), strings.TrimSpace(correlationID)
	if caseID == "" || expectedVersion < 1 || len(idempotencyKey) < 8 || len(idempotencyKey) > 128 || len(correlationID) < 8 || len(correlationID) > 128 {
		return postgres.JoiningCaseResult{}, ErrInvalidInput
	}
	input := postgres.UpdateFieldJoiningCaseDraftInput{
		CaseID: caseID, FieldActorID: identity.Subject, IdempotencyKey: idempotencyKey,
		CorrelationID: correlationID, ExpectedVersion: expectedVersion, EvidenceKeyring: s.evidenceKeys,
		PreserveProofNumber: preserveProofNumber, Request: normalized,
	}
	input.RequestHash, err = joiningcase.HashFieldDraftUpdateRequest(s.evidenceKeys, identity.Subject, caseID, expectedVersion, preserveProofNumber, normalized)
	if err != nil {
		return postgres.JoiningCaseResult{}, err
	}
	return postgres.UpdateFieldJoiningCaseDraft(ctx, s.db, input)
}
