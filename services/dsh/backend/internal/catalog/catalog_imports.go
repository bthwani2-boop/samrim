package catalog

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/contract"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

func (s *Service) PreviewCatalogImport(ctx context.Context, actingActorID string, input contract.CatalogImportPreviewRequest, idempotencyKey, correlationID string) (postgres.CatalogImportPreviewResult, error) {
	if err := s.requireOperator(ctx, actingActorID); err != nil {
		return postgres.CatalogImportPreviewResult{}, err
	}
	if strings.TrimSpace(input.RunID) == "" || strings.TrimSpace(input.SourceSha256) == "" || len(input.Rows) == 0 {
		return postgres.CatalogImportPreviewResult{}, postgres.ErrCatalogImportInvalid
	}
	items := make([]postgres.CatalogImportItemRecord, 0, len(input.Rows))
	hashInputs := make([]postgres.CatalogImportItemInput, 0, len(input.Rows))
	seen := make(map[string]struct{}, len(input.Rows))
	for _, row := range input.Rows {
		item := postgres.CatalogImportItemRecord{RowNumber: row.RowNumber, StableKey: strings.TrimSpace(row.StableKey), Classification: "READY"}
		item.Input = postgres.CatalogProductInput{VerticalID: row.VerticalID, Scope: row.Scope, StoreID: row.StoreID, CanonicalName: row.CanonicalName, Brand: optionalImportPointer(row.Brand), VariantTitle: row.VariantTitle, MeasurementKind: string(row.MeasurementKind), BaseUnit: string(row.BaseUnit), CategoryIDs: row.CategoryIds, IdentifierType: row.IdentifierType, IdentifierValue: row.IdentifierValue, ImageURI: row.ImageUri}
		normalized, err := normalizeCatalogProductInput(item.Input)
		if err != nil || item.RowNumber < 1 || item.StableKey == "" {
			item.Classification = "INVALID_INPUT"
			item.ErrorCode = stringPtr("INVALID_INPUT")
			item.ErrorMessage = stringPtr(importErrorMessage(err))
		} else {
			item.Input = normalized
			if _, duplicate := seen[item.StableKey]; duplicate {
				item.Classification = "DUPLICATE_INPUT"
				item.ErrorCode = stringPtr("DUPLICATE_INPUT")
				item.ErrorMessage = stringPtr("stableKey is repeated in this import")
			} else {
				seen[item.StableKey] = struct{}{}
				productID, variantID, sameFacts, matchErr := postgres.FindCatalogImportMatch(ctx, s.db, normalized)
				if matchErr != nil {
					return postgres.CatalogImportPreviewResult{}, matchErr
				}
				if productID != "" {
					item.ProductID, item.VariantID = stringPtr(productID), stringPtr(variantID)
					if sameFacts {
						item.Classification = "DUPLICATE_EXISTING"
					} else {
						item.Classification = "CONFLICT_EXISTING"
					}
				}
			}
		}
		items = append(items, item)
		hashInputs = append(hashInputs, postgres.CatalogImportItemInput{RowNumber: row.RowNumber, StableKey: row.StableKey, Input: item.Input})
	}
	run := postgres.CatalogImportRunRecord{ID: strings.TrimSpace(input.RunID), ActingActorID: strings.TrimSpace(actingActorID), SourceSHA256: strings.TrimSpace(input.SourceSha256)}
	return postgres.CreateCatalogImportPreview(ctx, s.db, run, items, strings.TrimSpace(idempotencyKey), postgres.HashCatalogImportPreviewRequest(run.ID, run.SourceSHA256, hashInputs), strings.TrimSpace(correlationID))
}

func (s *Service) ReadCatalogImportRun(ctx context.Context, actingActorID, runID string) (postgres.CatalogImportPreviewResult, error) {
	if err := s.requireOperator(ctx, actingActorID); err != nil {
		return postgres.CatalogImportPreviewResult{}, err
	}
	result, err := postgres.ReadCatalogImportRun(ctx, s.db, runID)
	if err != nil {
		return result, err
	}
	if result.Run.ActingActorID != strings.TrimSpace(actingActorID) {
		return postgres.CatalogImportPreviewResult{}, ErrOperatorNotActive
	}
	return result, nil
}

func (s *Service) CommitCatalogImport(ctx context.Context, actingActorID, runID, idempotencyKey, correlationID string) (postgres.CatalogImportCommitResult, error) {
	if err := s.requireOperator(ctx, actingActorID); err != nil {
		return postgres.CatalogImportCommitResult{}, err
	}
	preview, err := postgres.ReadCatalogImportRun(ctx, s.db, runID)
	if err != nil {
		return postgres.CatalogImportCommitResult{}, err
	}
	if preview.Run.ActingActorID != strings.TrimSpace(actingActorID) {
		return postgres.CatalogImportCommitResult{}, ErrOperatorNotActive
	}
	if !((preview.Run.Mode == "preview" && preview.Run.State == "previewed") || (preview.Run.Mode == "commit" && (preview.Run.State == "rejected" || preview.Run.State == "committed"))) {
		return postgres.CatalogImportCommitResult{}, postgres.ErrCatalogImportInvalid
	}
	for _, item := range preview.Items {
		if item.Classification != "READY" && item.Classification != "FAILED" {
			continue
		}
		itemKey := "catalog-import-product-" + preview.Run.ID + "-" + strconv.Itoa(item.RowNumber)
		created, createErr := s.CreateCatalogProduct(ctx, actingActorID, item.Input, itemKey, "catalog-import-"+preview.Run.ID+"-"+strconv.Itoa(item.RowNumber))
		if createErr != nil {
			if markErr := postgres.MarkCatalogImportItem(ctx, s.db, preview.Run.ID, item.RowNumber, "FAILED", "", "", importErrorCode(createErr), importErrorMessage(createErr), false); markErr != nil {
				return postgres.CatalogImportCommitResult{}, markErr
			}
			continue
		}
		classification := "IMPORTED"
		if created.Replayed {
			classification = "REPLAYED"
		}
		if markErr := postgres.MarkCatalogImportItem(ctx, s.db, preview.Run.ID, item.RowNumber, classification, created.Product.ID, firstVariantID(created.Product), "", "", true); markErr != nil {
			return postgres.CatalogImportCommitResult{}, markErr
		}
	}
	return postgres.CompleteCatalogImport(ctx, s.db, preview.Run.ID, strings.TrimSpace(idempotencyKey), postgres.HashCatalogImportCommitRequest(preview.Run.ID), strings.TrimSpace(actingActorID), strings.TrimSpace(correlationID))
}

func optionalImportPointer(value string) *string {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	return &value
}

func stringPtr(value string) *string { return &value }

func firstVariantID(product postgres.CatalogProductRecord) string {
	if len(product.Variants) == 0 {
		return ""
	}
	return product.Variants[0].ID
}

func importErrorCode(err error) string {
	switch {
	case errors.Is(err, postgres.ErrCatalogDuplicateIdentifier):
		return "DUPLICATE_IDENTIFIER"
	case errors.Is(err, postgres.ErrCatalogCategoryNotFound):
		return "CATEGORY_INVALID"
	case errors.Is(err, postgres.ErrCatalogProductOwnership):
		return "OWNERSHIP_INVALID"
	default:
		return "IMPORT_COMMIT_FAILED"
	}
}

func importErrorMessage(err error) string {
	if err == nil {
		return "import row is invalid"
	}
	return fmt.Sprintf("%s", err)
}
