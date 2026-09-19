package transporthttp

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/contract"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

func (s *CatalogServer) listOwnProductProposals(w http.ResponseWriter, r *http.Request) {
	if bearerToken(r) == "" {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "partner session is required")
		return
	}
	limit, ok := proposalLimit(w, r)
	if !ok {
		return
	}
	cursor := strings.TrimSpace(r.URL.Query().Get("cursor"))
	if len(cursor) > 2048 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "cursor is too long")
		return
	}
	page, err := s.service.ListProductProposalsForPartner(r.Context(), bearerToken(r), r.URL.Query().Get("state"), limit, cursor)
	if err != nil {
		writeCatalogError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, contract.CatalogProductProposalListResponse{Proposals: toProductProposals(page.Proposals), NextCursor: page.NextCursor})
}

func (s *CatalogServer) createProductProposal(w http.ResponseWriter, r *http.Request) {
	correlation, idempotency, _, ok := requiredPartnerOfferHeaders(w, r, false)
	if !ok {
		return
	}
	var input contract.CreateCatalogProductProposalRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	proposal, err := s.service.CreateProductProposal(r.Context(), bearerToken(r), postgres.CatalogProductProposalInput{
		ID: input.ID, VerticalID: input.VerticalID, CategoryID: input.CategoryID, ProposedName: input.ProposedName,
		ProposedBrand: optionalRequestString(input.ProposedBrand), ProposedVariantTitle: input.ProposedVariantTitle,
		ProposedMeasurementKind: string(input.ProposedMeasurementKind), ProposedBaseUnit: string(input.ProposedBaseUnit),
		ProposedIdentifierType: optionalRequestString(input.ProposedIdentifierType), ProposedIdentifierValue: optionalRequestString(input.ProposedIdentifierValue), ProposedImageURI: optionalRequestString(input.ProposedImageUri),
	}, idempotency, correlation)
	if err != nil {
		writeCatalogError(w, err)
		return
	}
	writeJSON(w, responseStatus(proposal.Replayed), contract.CatalogProductProposalResponse{Proposal: toProductProposal(proposal.Proposal), IdempotentReplay: proposal.Replayed})
}

func (s *CatalogServer) submitProductProposal(w http.ResponseWriter, r *http.Request) {
	correlation, idempotency, expected, ok := requiredPartnerOfferHeaders(w, r, true)
	if !ok {
		return
	}
	proposal, err := s.service.SubmitProductProposal(r.Context(), bearerToken(r), r.PathValue("proposalId"), expected, idempotency, correlation)
	if err != nil {
		writeCatalogError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, contract.CatalogProductProposalResponse{Proposal: toProductProposal(proposal.Proposal), IdempotentReplay: proposal.Replayed})
}

func (s *CatalogServer) updateProductProposal(w http.ResponseWriter, r *http.Request) {
	correlation, idempotency, expected, ok := requiredPartnerOfferHeaders(w, r, true)
	if !ok {
		return
	}
	var input contract.UpdateCatalogProductProposalRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	proposal, err := s.service.UpdateProductProposal(r.Context(), bearerToken(r), r.PathValue("proposalId"), postgres.CatalogProductProposalInput{
		VerticalID: input.VerticalID, CategoryID: input.CategoryID, ProposedName: input.ProposedName,
		ProposedBrand: optionalRequestString(input.ProposedBrand), ProposedVariantTitle: input.ProposedVariantTitle,
		ProposedMeasurementKind: string(input.ProposedMeasurementKind), ProposedBaseUnit: string(input.ProposedBaseUnit),
		ProposedIdentifierType: optionalRequestString(input.ProposedIdentifierType), ProposedIdentifierValue: optionalRequestString(input.ProposedIdentifierValue), ProposedImageURI: optionalRequestString(input.ProposedImageUri),
	}, expected, idempotency, correlation)
	if err != nil {
		writeCatalogError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, contract.CatalogProductProposalResponse{Proposal: toProductProposal(proposal.Proposal), IdempotentReplay: proposal.Replayed})
}

func (s *CatalogServer) previewCatalogImport(w http.ResponseWriter, r *http.Request) {
	acting, correlation, idempotency, ok := requiredMutationHeaders(w, r)
	if !ok {
		return
	}
	var input contract.CatalogImportPreviewRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	result, err := s.service.PreviewCatalogImport(r.Context(), acting, input, idempotency, correlation)
	if err != nil {
		writeCatalogError(w, err)
		return
	}
	writeJSON(w, responseStatus(result.Replayed), contract.CatalogImportPreviewResponse{Run: toCatalogImportRun(result.Run), Items: toCatalogImportItems(result.Items), IdempotentReplay: result.Replayed})
}

func (s *CatalogServer) readCatalogImportRun(w http.ResponseWriter, r *http.Request) {
	if !s.auth.Authorized(r) {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "service authentication is required")
		return
	}
	acting := strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID"))
	if acting == "" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "X-Acting-Actor-ID is required")
		return
	}
	result, err := s.service.ReadCatalogImportRun(r.Context(), acting, r.PathValue("runId"))
	if err != nil {
		writeCatalogError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, contract.CatalogImportRunResponse{Run: toCatalogImportRun(result.Run), Items: toCatalogImportItems(result.Items)})
}

func (s *CatalogServer) commitCatalogImport(w http.ResponseWriter, r *http.Request) {
	acting, correlation, idempotency, ok := requiredMutationHeaders(w, r)
	if !ok {
		return
	}
	result, err := s.service.CommitCatalogImport(r.Context(), acting, r.PathValue("runId"), idempotency, correlation)
	if err != nil {
		writeCatalogError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, contract.CatalogImportCommitResponse{Run: toCatalogImportRun(result.Run), Items: toCatalogImportItems(result.Items), IdempotentReplay: result.Replayed})
}

func toCatalogImportRun(item postgres.CatalogImportRunRecord) contract.CatalogImportRun {
	return contract.CatalogImportRun{ID: item.ID, ActingActorID: item.ActingActorID, SourceSha256: item.SourceSHA256, Mode: item.Mode, State: item.State, AcceptedCount: item.AcceptedCount, ConflictCount: item.ConflictCount, CreatedAt: item.CreatedAt}
}

func toCatalogImportItems(items []postgres.CatalogImportItemRecord) []contract.CatalogImportItem {
	values := make([]contract.CatalogImportItem, 0, len(items))
	for _, item := range items {
		values = append(values, contract.CatalogImportItem{RowNumber: item.RowNumber, StableKey: item.StableKey, Classification: item.Classification, ProductID: optionalProductValue(item.ProductID), VariantID: optionalProductValue(item.VariantID), ErrorCode: optionalProductValue(item.ErrorCode), ErrorMessage: optionalProductValue(item.ErrorMessage), Committed: item.Committed})
	}
	return values
}

func (s *CatalogServer) listProductProposalReviewQueue(w http.ResponseWriter, r *http.Request) {
	if !s.auth.Authorized(r) {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "service authentication is required")
		return
	}
	acting := strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID"))
	if acting == "" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "X-Acting-Actor-ID is required")
		return
	}
	limit, ok := proposalLimit(w, r)
	if !ok {
		return
	}
	cursor := strings.TrimSpace(r.URL.Query().Get("cursor"))
	if len(cursor) > 2048 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "cursor is too long")
		return
	}
	page, err := s.service.ListProductProposalsForReview(r.Context(), acting, r.URL.Query().Get("state"), limit, cursor)
	if err != nil {
		writeCatalogError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, contract.CatalogProductProposalListResponse{Proposals: toProductProposals(page.Proposals), NextCursor: page.NextCursor})
}

func (s *CatalogServer) reviewProductProposal(w http.ResponseWriter, r *http.Request) {
	if !s.auth.Authorized(r) {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "service authentication is required")
		return
	}
	acting, correlation, idempotency, expected, ok := requiredVersionedCaseHeaders(w, r)
	if !ok {
		return
	}
	var input contract.ReviewCatalogProductProposalRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	proposal, err := s.service.ReviewProductProposal(r.Context(), acting, r.PathValue("proposalId"), input.State, input.Reason, expected, idempotency, correlation)
	if err != nil {
		writeCatalogError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, contract.CatalogProductProposalResponse{Proposal: toProductProposal(proposal.Proposal), IdempotentReplay: proposal.Replayed})
}

func proposalLimit(w http.ResponseWriter, r *http.Request) (int, bool) {
	limit := 50
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 || parsed > 100 {
			writeError(w, http.StatusBadRequest, "INVALID_INPUT", "limit must be between 1 and 100")
			return 0, false
		}
		limit = parsed
	}
	return limit, true
}

func toProductProposals(items []postgres.CatalogProductProposalRecord) []contract.CatalogProductProposal {
	values := make([]contract.CatalogProductProposal, 0, len(items))
	for _, item := range items {
		values = append(values, toProductProposal(item))
	}
	return values
}

func toProductProposal(item postgres.CatalogProductProposalRecord) contract.CatalogProductProposal {
	return contract.CatalogProductProposal{ID: item.ID, PartnerActorID: item.PartnerActorID, VerticalID: item.VerticalID, CategoryID: item.CategoryID, ProposedName: item.ProposedName, ProposedBrand: optionalProductValue(item.ProposedBrand), ProposedVariantTitle: item.ProposedVariantTitle, ProposedMeasurementKind: contract.MeasurementKind(item.ProposedMeasurementKind), ProposedBaseUnit: contract.BaseUnit(item.ProposedBaseUnit), ProposedIdentifierType: optionalProductValue(item.ProposedIdentifierType), ProposedIdentifierValue: optionalProductValue(item.ProposedIdentifierValue), ProposedImageUri: optionalProductValue(item.ProposedImageURI), State: item.State, CorrectionReason: optionalProductValue(item.CorrectionReason), ReviewedBy: optionalProductValue(item.ReviewedBy), Version: item.Version, CreatedAt: item.CreatedAt, UpdatedAt: item.UpdatedAt}
}
