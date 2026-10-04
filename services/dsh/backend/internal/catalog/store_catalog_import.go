package catalog

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strings"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

func (s *Service) PreviewPartnerStoreCatalogImport(ctx context.Context, accessToken, storeID, filename string, data []byte, idempotencyKey, correlationID string) (postgres.CatalogImportPreviewResult, error) {
	actorID, err := s.requireStoreOwner(ctx, accessToken, storeID)
	if err != nil {
		return postgres.CatalogImportPreviewResult{}, err
	}
	return s.previewStoreCatalogImport(ctx, actorID, "PARTNER", storeID, "", filename, data, idempotencyKey, correlationID)
}

func (s *Service) PreviewFieldStoreCatalogImport(ctx context.Context, accessToken, joiningCaseID, filename string, data []byte, idempotencyKey, correlationID string) (postgres.CatalogImportPreviewResult, error) {
	actorID, scope, err := s.requireFieldCatalog(ctx, accessToken, joiningCaseID)
	if err != nil {
		return postgres.CatalogImportPreviewResult{}, err
	}
	return s.previewStoreCatalogImport(ctx, actorID, "FIELD", scope.StoreID, scope.JoiningCaseID, filename, data, idempotencyKey, correlationID)
}

func (s *Service) PreviewOperatorStoreCatalogImport(ctx context.Context, actorID, storeID, filename string, data []byte, idempotencyKey, correlationID string) (postgres.CatalogImportPreviewResult, error) {
	if err := s.requireOperatorPermission(ctx, actorID, "catalog"); err != nil {
		return postgres.CatalogImportPreviewResult{}, err
	}
	return s.previewStoreCatalogImport(ctx, strings.TrimSpace(actorID), "OPERATOR", storeID, "", filename, data, idempotencyKey, correlationID)
}

func (s *Service) previewStoreCatalogImport(ctx context.Context, actorID, actorRole, storeID, joiningCaseID, filename string, data []byte, idempotencyKey, correlationID string) (postgres.CatalogImportPreviewResult, error) {
	storeID = strings.TrimSpace(storeID)
	actorID = strings.TrimSpace(actorID)
	idempotencyKey = strings.TrimSpace(idempotencyKey)
	correlationID = strings.TrimSpace(correlationID)
	if storeID == "" || actorID == "" || idempotencyKey == "" || correlationID == "" {
		return postgres.CatalogImportPreviewResult{}, postgres.ErrCatalogImportInvalid
	}
	rows, err := ParseStoreCatalogImportFile(filename, data)
	if err != nil {
		return postgres.CatalogImportPreviewResult{}, err
	}
	sourceDigest := sha256.Sum256(data)
	sourceSHA := hex.EncodeToString(sourceDigest[:])
	runScope := sha256.Sum256([]byte("store-offers\x00" + storeID + "\x00" + joiningCaseID + "\x00" + sourceSHA))
	runID := "store_catalog_import_" + hex.EncodeToString(runScope[:16])

	items := make([]postgres.CatalogImportItemRecord, 0, len(rows))
	hashInputs := make([]postgres.CatalogImportItemInput, 0, len(rows))
	seen := make(map[string]struct{}, len(rows))
	for _, fileRow := range rows {
		storeInput := &postgres.StoreCatalogImportItemInput{PriceMinor: fileRow.PriceMinor}
		item := postgres.CatalogImportItemRecord{RowNumber: fileRow.RowNumber, StableKey: fmt.Sprintf("store-offer-row-%d", fileRow.RowNumber), Classification: "READY", StoreOfferInput: storeInput}
		if fileRow.ErrorCode != "" {
			item.Classification = "INVALID_INPUT"
			item.ErrorCode = stringPtr(fileRow.ErrorCode)
			item.ErrorMessage = stringPtr(fileRow.ErrorMessage)
		} else if _, duplicate := seen[fileRow.Barcode]; duplicate {
			item.Classification = "DUPLICATE_INPUT"
			item.ErrorCode = stringPtr("DUPLICATE_INPUT")
			item.ErrorMessage = stringPtr("barcode is repeated in this import")
		} else {
			seen[fileRow.Barcode] = struct{}{}
			resolution, resolveErr := postgres.ResolveCatalogIdentifier(ctx, s.db, storeID, fileRow.Barcode)
			if resolveErr != nil {
				return postgres.CatalogImportPreviewResult{}, resolveErr
			}
			item.VariantID = stringPtr(resolution.VariantID)
			switch resolution.Outcome {
			case "UNKNOWN_IDENTIFIER":
				item.Classification = "NEEDS_REVIEW"
				item.ErrorCode = stringPtr("UNKNOWN_IDENTIFIER")
				item.ErrorMessage = stringPtr("unknown barcode was held for catalog review; it will not create a product")
			case "SHARED_PRODUCT_MATCH", "STORE_LOCAL_PRODUCT_MATCH":
				storeInput.VariantID = resolution.VariantID
				storeInput.Create = defaultImportedOffer(storeID, resolution.VariantID, fileRow.PriceMinor, resolution.MeasurementKind)
			case "EXISTING_STORE_OFFER":
				storeInput.VariantID = resolution.VariantID
				storeInput.StoreOfferID = resolution.StoreOfferID
				current, readErr := postgres.ReadCatalogOffer(ctx, s.db, resolution.StoreOfferID)
				if readErr != nil {
					return postgres.CatalogImportPreviewResult{}, readErr
				}
				if current.StoreID != storeID {
					return postgres.CatalogImportPreviewResult{}, ErrStoreOwnershipForbidden
				}
				storeInput.ExpectedVersion = current.Version
				storeInput.Update = postgres.CatalogOfferUpdateInput{
					PriceMinor: fileRow.PriceMinor, Availability: current.Availability, PublicationState: current.PublicationState,
					QuantityPolicy: current.QuantityPolicy, QuantityMinBaseUnits: offerQuantity(current.QuantityMinBaseUnits),
					QuantityMaxBaseUnits: offerQuantity(current.QuantityMaxBaseUnits), QuantityStepBaseUnits: offerQuantity(current.QuantityStepBaseUnits),
					PricingBasis: current.PricingBasis, PricingUnitBaseUnits: current.PricingUnitBaseUnits,
					InventoryPolicy: current.InventoryPolicy, InventoryOnHandBaseUnits: current.InventoryOnHandBaseUnits,
				}
			case "AMBIGUOUS_IDENTIFIER", "UNAVAILABLE_IN_STORE", "VARIABLE_MEASURE_IDENTIFIER":
				item.Classification = "CONFLICT_EXISTING"
				item.ErrorCode = stringPtr(resolution.Outcome)
				item.ErrorMessage = stringPtr("identifier cannot be used to update a customer-orderable store offer")
			default:
				return postgres.CatalogImportPreviewResult{}, postgres.ErrCatalogImportInvalid
			}
		}
		hashInputs = append(hashInputs, postgres.CatalogImportItemInput{RowNumber: item.RowNumber, StableKey: item.StableKey, StoreOfferInput: storeInput})
		items = append(items, item)
	}
	run := postgres.CatalogImportRunRecord{ID: runID, ActingActorID: actorID, SourceSHA256: sourceSHA, Purpose: "STORE_OFFERS", ActorRole: actorRole, StoreID: storeID, JoiningCaseID: strings.TrimSpace(joiningCaseID)}
	return postgres.CreateCatalogImportPreview(ctx, s.db, run, items, idempotencyKey, postgres.HashCatalogImportPreviewRequest(run.ID, run.SourceSHA256, hashInputs), correlationID)
}

func defaultImportedOffer(storeID, variantID string, priceMinor int64, measurementKind string) postgres.CatalogOfferInput {
	quantityPolicy := measurementKind
	pricingBasis := "PER_MEASURE"
	pricingUnit := int64(1000)
	minimum, maximum, step := int64(1), int64(100000), int64(1)
	if measurementKind == "DISCRETE" {
		pricingBasis = "PER_UNIT"
		pricingUnit = 1
		maximum = 100
	}
	return postgres.CatalogOfferInput{
		StoreID: storeID, VariantID: variantID, PriceMinor: priceMinor,
		QuantityPolicy: quantityPolicy, QuantityMinBaseUnits: minimum, QuantityMaxBaseUnits: maximum,
		QuantityStepBaseUnits: step, PricingBasis: pricingBasis, PricingUnitBaseUnits: pricingUnit,
		InventoryPolicy: "AVAILABILITY_ONLY",
	}
}

func offerQuantity(value *int64) int64 {
	if value == nil {
		return 0
	}
	return *value
}

func (s *Service) ReadPartnerStoreCatalogImport(ctx context.Context, accessToken, storeID, runID string) (postgres.CatalogImportPreviewResult, error) {
	actorID, err := s.requireStoreOwner(ctx, accessToken, storeID)
	if err != nil {
		return postgres.CatalogImportPreviewResult{}, err
	}
	return s.readStoreCatalogImport(ctx, actorID, "PARTNER", storeID, "", runID)
}

func (s *Service) ReadFieldStoreCatalogImport(ctx context.Context, accessToken, joiningCaseID, runID string) (postgres.CatalogImportPreviewResult, error) {
	actorID, scope, err := s.requireFieldCatalog(ctx, accessToken, joiningCaseID)
	if err != nil {
		return postgres.CatalogImportPreviewResult{}, err
	}
	return s.readStoreCatalogImport(ctx, actorID, "FIELD", scope.StoreID, scope.JoiningCaseID, runID)
}

func (s *Service) ReadOperatorStoreCatalogImport(ctx context.Context, actorID, runID string) (postgres.CatalogImportPreviewResult, error) {
	if err := s.requireOperatorPermission(ctx, actorID, "catalog"); err != nil {
		return postgres.CatalogImportPreviewResult{}, err
	}
	result, err := postgres.ReadCatalogImportRun(ctx, s.db, runID)
	if err != nil {
		return result, err
	}
	if result.Run.Purpose != "STORE_OFFERS" || result.Run.ActorRole != "OPERATOR" || result.Run.ActingActorID != strings.TrimSpace(actorID) {
		return postgres.CatalogImportPreviewResult{}, ErrOperatorNotActive
	}
	return result, nil
}

func (s *Service) readStoreCatalogImport(ctx context.Context, actorID, actorRole, storeID, joiningCaseID, runID string) (postgres.CatalogImportPreviewResult, error) {
	result, err := postgres.ReadCatalogImportRun(ctx, s.db, runID)
	if err != nil {
		return result, err
	}
	if result.Run.Purpose != "STORE_OFFERS" || result.Run.ActorRole != actorRole || result.Run.ActingActorID != strings.TrimSpace(actorID) || result.Run.StoreID != strings.TrimSpace(storeID) || result.Run.JoiningCaseID != strings.TrimSpace(joiningCaseID) {
		switch actorRole {
		case "FIELD":
			return postgres.CatalogImportPreviewResult{}, ErrFieldCatalogSessionForbidden
		case "OPERATOR":
			return postgres.CatalogImportPreviewResult{}, ErrOperatorNotActive
		default:
			return postgres.CatalogImportPreviewResult{}, ErrStoreOwnershipForbidden
		}
	}
	return result, nil
}

func (s *Service) CommitPartnerStoreCatalogImport(ctx context.Context, accessToken, storeID, runID, idempotencyKey, correlationID string) (postgres.CatalogImportCommitResult, error) {
	actorID, err := s.requireStoreOwner(ctx, accessToken, storeID)
	if err != nil {
		return postgres.CatalogImportCommitResult{}, err
	}
	if _, err = s.readStoreCatalogImport(ctx, actorID, "PARTNER", storeID, "", runID); err != nil {
		return postgres.CatalogImportCommitResult{}, err
	}
	return s.commitStoreCatalogImport(ctx, actorID, "PARTNER", storeID, runID, idempotencyKey, correlationID)
}

func (s *Service) CommitFieldStoreCatalogImport(ctx context.Context, accessToken, joiningCaseID, runID, idempotencyKey, correlationID string) (postgres.CatalogImportCommitResult, error) {
	actorID, scope, err := s.requireFieldCatalog(ctx, accessToken, joiningCaseID)
	if err != nil {
		return postgres.CatalogImportCommitResult{}, err
	}
	if _, err = s.readStoreCatalogImport(ctx, actorID, "FIELD", scope.StoreID, scope.JoiningCaseID, runID); err != nil {
		return postgres.CatalogImportCommitResult{}, err
	}
	return s.commitStoreCatalogImport(ctx, actorID, "FIELD", scope.StoreID, runID, idempotencyKey, correlationID)
}

func (s *Service) CommitOperatorStoreCatalogImport(ctx context.Context, actorID, runID, idempotencyKey, correlationID string) (postgres.CatalogImportCommitResult, error) {
	if err := s.requireOperatorPermission(ctx, actorID, "catalog"); err != nil {
		return postgres.CatalogImportCommitResult{}, err
	}
	preview, err := s.ReadOperatorStoreCatalogImport(ctx, actorID, runID)
	if err != nil {
		return postgres.CatalogImportCommitResult{}, err
	}
	return s.commitStoreCatalogImport(ctx, actorID, "OPERATOR", preview.Run.StoreID, runID, idempotencyKey, correlationID)
}

func (s *Service) commitStoreCatalogImport(ctx context.Context, actorID, actorRole, storeID, runID, idempotencyKey, correlationID string) (postgres.CatalogImportCommitResult, error) {
	preview, err := postgres.ReadCatalogImportRun(ctx, s.db, runID)
	if err != nil {
		return postgres.CatalogImportCommitResult{}, err
	}
	if preview.Run.Purpose != "STORE_OFFERS" || preview.Run.ActorRole != actorRole || preview.Run.ActingActorID != strings.TrimSpace(actorID) || preview.Run.StoreID != strings.TrimSpace(storeID) || (preview.Run.Mode == "preview" && preview.Run.State != "previewed") {
		return postgres.CatalogImportCommitResult{}, postgres.ErrCatalogImportInvalid
	}
	if !((preview.Run.Mode == "preview" && preview.Run.State == "previewed") || (preview.Run.Mode == "commit" && preview.Run.State == "rejected")) {
		return postgres.CatalogImportCommitResult{}, postgres.ErrCatalogImportInvalid
	}
	provenance := map[string]string{"FIELD": "FIELD_INITIAL_CATALOG", "PARTNER": "PARTNER", "OPERATOR": "CONTROL_PANEL"}[actorRole]
	for _, item := range preview.Items {
		if item.Classification != "READY" && item.Classification != "FAILED" {
			continue
		}
		if item.StoreOfferInput == nil {
			return postgres.CatalogImportCommitResult{}, postgres.ErrCatalogImportInvalid
		}
		input := item.StoreOfferInput
		itemKey := "store-catalog-import-" + postgres.HashCatalogQuickPriceItemKey("store-catalog-import", preview.Run.ID, fmt.Sprintf("%d", item.RowNumber))[:48]
		rowCorrelation := "store-catalog-import-" + postgres.HashCatalogQuickPriceItemKey("store-catalog-import-correlation", preview.Run.ID, fmt.Sprintf("row:%d", item.RowNumber))[:48]
		var offer postgres.CatalogStoreOfferResult
		if input.StoreOfferID == "" {
			input.Create.StoreID = storeID
			offer, err = postgres.CreateCatalogOfferWithProvenance(ctx, s.db, input.Create, itemKey, postgres.HashCatalogOfferCreateRequest(input.Create), actorID, rowCorrelation, provenance)
		} else {
			offer, err = postgres.UpdateCatalogOfferWithProvenance(ctx, s.db, input.StoreOfferID, input.Update, input.ExpectedVersion, itemKey, postgres.HashCatalogOfferUpdateRequest(input.StoreOfferID, input.Update, input.ExpectedVersion), actorID, rowCorrelation, provenance)
		}
		if err != nil {
			if markErr := postgres.MarkCatalogImportItem(ctx, s.db, preview.Run.ID, item.RowNumber, "FAILED", "", input.VariantID, importErrorCode(err), importErrorMessage(err), false); markErr != nil {
				return postgres.CatalogImportCommitResult{}, markErr
			}
			continue
		}
		classification := "IMPORTED"
		if offer.Replayed {
			classification = "REPLAYED"
		}
		if err = postgres.MarkCatalogImportItem(ctx, s.db, preview.Run.ID, item.RowNumber, classification, "", input.VariantID, "", "", true); err != nil {
			return postgres.CatalogImportCommitResult{}, err
		}
	}
	return postgres.CompleteCatalogImport(ctx, s.db, preview.Run.ID, strings.TrimSpace(idempotencyKey), postgres.HashCatalogImportCommitRequest(preview.Run.ID), actorID, strings.TrimSpace(correlationID))
}
