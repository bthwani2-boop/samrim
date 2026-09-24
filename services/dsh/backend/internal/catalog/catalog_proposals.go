package catalog

import (
	"context"
	"net/url"
	"strings"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

func (s *Service) CreateProductProposal(ctx context.Context, accessToken string, input postgres.CatalogProductProposalInput, idempotencyKey, correlationID string) (postgres.CatalogProductProposalResult, error) {
	identity, err := s.requirePartnerIdentity(ctx, accessToken)
	if err != nil {
		return postgres.CatalogProductProposalResult{}, err
	}
	normalized, err := normalizeProductProposalInput(input)
	if err != nil {
		return postgres.CatalogProductProposalResult{}, err
	}
	normalized.PartnerActorID = identity.Subject
	return postgres.CreateCatalogProductProposal(ctx, s.db, normalized, strings.TrimSpace(idempotencyKey), postgres.HashCatalogProductProposalCreateRequest(normalized), identity.Subject, strings.TrimSpace(correlationID))
}

func (s *Service) ListProductProposalsForPartner(ctx context.Context, accessToken, state string, limit int, cursor string) (postgres.CatalogProductProposalPage, error) {
	identity, err := s.requirePartnerIdentity(ctx, accessToken)
	if err != nil {
		return postgres.CatalogProductProposalPage{}, err
	}
	return postgres.ListCatalogProductProposalsForPartner(ctx, s.db, identity.Subject, strings.TrimSpace(state), limit, strings.TrimSpace(cursor))
}

func (s *Service) ListProductProposalsForReview(ctx context.Context, actingActorID, state string, limit int, cursor string) (postgres.CatalogProductProposalPage, error) {
	if err := s.requireOperator(ctx, actingActorID); err != nil {
		return postgres.CatalogProductProposalPage{}, err
	}
	return postgres.ListCatalogProductProposalsForReview(ctx, s.db, strings.TrimSpace(state), limit, strings.TrimSpace(cursor))
}

func (s *Service) SubmitProductProposal(ctx context.Context, accessToken, proposalID string, expectedVersion int, idempotencyKey, correlationID string) (postgres.CatalogProductProposalResult, error) {
	identity, err := s.requirePartnerIdentity(ctx, accessToken)
	if err != nil {
		return postgres.CatalogProductProposalResult{}, err
	}
	proposal, err := postgres.ReadCatalogProductProposal(ctx, s.db, proposalID)
	if err != nil {
		return postgres.CatalogProductProposalResult{}, err
	}
	if proposal.PartnerActorID != identity.Subject {
		return postgres.CatalogProductProposalResult{}, ErrStoreOwnershipForbidden
	}
	requestHash := postgres.HashCatalogProductProposalTransitionRequest(proposalID, expectedVersion)
	return postgres.SubmitCatalogProductProposal(ctx, s.db, strings.TrimSpace(proposalID), expectedVersion, strings.TrimSpace(idempotencyKey), requestHash, identity.Subject, strings.TrimSpace(correlationID))
}

func (s *Service) UpdateProductProposal(ctx context.Context, accessToken, proposalID string, input postgres.CatalogProductProposalInput, expectedVersion int, idempotencyKey, correlationID string) (postgres.CatalogProductProposalResult, error) {
	identity, err := s.requirePartnerIdentity(ctx, accessToken)
	if err != nil {
		return postgres.CatalogProductProposalResult{}, err
	}
	proposal, err := postgres.ReadCatalogProductProposal(ctx, s.db, proposalID)
	if err != nil {
		return postgres.CatalogProductProposalResult{}, err
	}
	if proposal.PartnerActorID != identity.Subject {
		return postgres.CatalogProductProposalResult{}, ErrStoreOwnershipForbidden
	}
	input.ID = proposal.ID
	normalized, err := normalizeProductProposalInput(input)
	if err != nil {
		return postgres.CatalogProductProposalResult{}, err
	}
	normalized.PartnerActorID = identity.Subject
	requestHash := postgres.HashCatalogProductProposalUpdateRequest(proposal.ID, normalized, expectedVersion)
	return postgres.UpdateCatalogProductProposal(ctx, s.db, proposal.ID, normalized, expectedVersion, strings.TrimSpace(idempotencyKey), requestHash, identity.Subject, strings.TrimSpace(correlationID))
}

func (s *Service) ReviewProductProposal(ctx context.Context, actingActorID, proposalID, state, reason string, expectedVersion int, idempotencyKey, correlationID string) (postgres.CatalogProductProposalResult, error) {
	if err := s.requireOperator(ctx, actingActorID); err != nil {
		return postgres.CatalogProductProposalResult{}, err
	}
	state = strings.ToLower(strings.TrimSpace(state))
	reason = strings.TrimSpace(reason)
	requestHash := postgres.HashCatalogProductProposalReviewRequest(proposalID, state, reason, expectedVersion)
	return postgres.ReviewCatalogProductProposal(ctx, s.db, strings.TrimSpace(proposalID), state, reason, expectedVersion, strings.TrimSpace(idempotencyKey), requestHash, strings.TrimSpace(actingActorID), strings.TrimSpace(correlationID))
}

func normalizeProductProposalInput(input postgres.CatalogProductProposalInput) (postgres.CatalogProductProposalInput, error) {
	name, err := normalizeProductName(input.ProposedName)
	if err != nil {
		return postgres.CatalogProductProposalInput{}, err
	}
	variantTitle := strings.Join(strings.Fields(strings.TrimSpace(input.ProposedVariantTitle)), " ")
	if variantTitle == "" {
		variantTitle = "الافتراضي"
	}
	kind := strings.ToUpper(strings.TrimSpace(input.ProposedMeasurementKind))
	baseUnit := strings.ToUpper(strings.TrimSpace(input.ProposedBaseUnit))
	if (kind == "DISCRETE" && baseUnit != "COUNT") || (kind != "DISCRETE" && (baseUnit != "GRAM" && baseUnit != "MILLILITER")) || (kind != "DISCRETE" && kind != "MEASURED" && kind != "VARIABLE_MEASURE") {
		return postgres.CatalogProductProposalInput{}, postgres.ErrCatalogProposalInvalid
	}
	if strings.TrimSpace(input.ID) == "" || strings.TrimSpace(input.VerticalID) == "" || strings.TrimSpace(input.CategoryID) == "" {
		return postgres.CatalogProductProposalInput{}, postgres.ErrCatalogProposalInvalid
	}
	brand, err := normalizeOptionalText(input.ProposedBrand, 160)
	if err != nil {
		return postgres.CatalogProductProposalInput{}, err
	}
	identifierType := normalizeOptionalPointer(input.ProposedIdentifierType, true)
	identifierValue := normalizeOptionalPointer(input.ProposedIdentifierValue, false)
	if identifierValue != nil && (identifierType == nil || !identifierPattern.MatchString(*identifierValue)) {
		return postgres.CatalogProductProposalInput{}, postgres.ErrCatalogIdentifierInvalid
	}
	imageURI := normalizeOptionalPointer(input.ProposedImageURI, false)
	if imageURI != nil {
		parsed, parseErr := url.ParseRequestURI(*imageURI)
		if parseErr != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Hostname() == "" || parsed.User != nil {
			return postgres.CatalogProductProposalInput{}, ErrCatalogProductImageInvalid
		}
	}
	return postgres.CatalogProductProposalInput{ID: strings.TrimSpace(input.ID), VerticalID: strings.TrimSpace(input.VerticalID), CategoryID: strings.TrimSpace(input.CategoryID), ProposedName: name, ProposedBrand: brand, ProposedVariantTitle: variantTitle, ProposedMeasurementKind: kind, ProposedBaseUnit: baseUnit, ProposedIdentifierType: identifierType, ProposedIdentifierValue: identifierValue, ProposedImageURI: imageURI, AttributeValues: normalizeCatalogAttributeValues(input.AttributeValues), VariantAttributeValues: normalizeCatalogAttributeValues(input.VariantAttributeValues)}, nil
}

func normalizeOptionalPointer(value *string, upper bool) *string {
	if value == nil {
		return nil
	}
	normalized := strings.TrimSpace(*value)
	if upper {
		normalized = strings.ToUpper(normalized)
	}
	if normalized == "" {
		return nil
	}
	return &normalized
}
