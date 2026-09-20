package transporthttp

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/contract"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

func requiredPartnerOfferHeaders(w http.ResponseWriter, r *http.Request, versioned bool) (string, string, int, bool) {
	if bearerToken(r) == "" {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "partner session is required")
		return "", "", 0, false
	}
	if r.Header.Get("X-Actor-ID") != "" || r.Header.Get("X-Acting-Actor-ID") != "" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "offer ownership comes from the canonical partner session")
		return "", "", 0, false
	}
	correlation := strings.TrimSpace(r.Header.Get("X-Correlation-ID"))
	idempotency := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	if len(correlation) < 8 || len(correlation) > 128 || len(idempotency) < 8 || len(idempotency) > 128 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "X-Correlation-ID and Idempotency-Key are required")
		return "", "", 0, false
	}
	if !versioned {
		return correlation, idempotency, 0, true
	}
	expected, err := strconv.Atoi(strings.TrimSpace(r.Header.Get("X-Expected-Version")))
	if err != nil || expected < 1 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "X-Expected-Version must be a positive integer")
		return "", "", 0, false
	}
	return correlation, idempotency, expected, true
}

func toStoreOffer(item postgres.CatalogStoreOfferRecord) contract.CatalogStoreOffer {
	return contract.CatalogStoreOffer{OfferID: item.ID, StoreID: item.StoreID, VariantID: item.VariantID, ProductID: item.Product.ID, ProductName: item.Product.CanonicalName, Brand: optionalProductValue(item.Product.Brand), MeasurementKind: contract.MeasurementKind(item.Variant.MeasurementKind), BaseUnit: contract.BaseUnit(item.Variant.BaseUnit), ProductActive: item.Product.Active, VariantActive: item.Variant.Active, ProductVersion: item.Product.Version, PriceMinor: int(item.PriceMinor), Currency: item.Currency, QuantityPolicy: item.QuantityPolicy, QuantityMinBaseUnits: int(quantityValue(item.QuantityMinBaseUnits)), QuantityMaxBaseUnits: int(quantityValue(item.QuantityMaxBaseUnits)), QuantityStepBaseUnits: int(quantityValue(item.QuantityStepBaseUnits)), PricingBasis: item.PricingBasis, PricingUnitBaseUnits: int(item.PricingUnitBaseUnits), InventoryPolicy: item.InventoryPolicy, Availability: item.Availability, PublicationState: contract.StoreOfferPublicationState(item.PublicationState), Media: toCatalogMedia(item.Product.Media), ModifierGroups: toCatalogModifierGroups(item.ModifierGroups), Version: item.Version, CreatedAt: item.CreatedAt, UpdatedAt: item.UpdatedAt}
}

func toCatalogMedia(items []postgres.CatalogMediaRecord) []contract.CatalogMedia {
	values := make([]contract.CatalogMedia, 0, len(items))
	for _, item := range items {
		values = append(values, contract.CatalogMedia{Uri: item.URI, Role: item.Role, Ordinal: item.Ordinal})
	}
	return values
}

func toCatalogModifierGroups(items []postgres.CatalogModifierGroupRecord) []contract.CatalogModifierGroup {
	values := make([]contract.CatalogModifierGroup, 0, len(items))
	for _, item := range items {
		options := make([]contract.CatalogModifierOption, 0, len(item.Options))
		for _, option := range item.Options {
			options = append(options, contract.CatalogModifierOption{ID: option.ID, GroupID: option.GroupID, NameAr: option.NameAr, PriceDeltaMinor: int(option.PriceDeltaMinor), Availability: option.Availability, Ordinal: option.Ordinal, Version: option.Version})
		}
		values = append(values, contract.CatalogModifierGroup{ID: item.ID, StoreID: item.StoreID, NameAr: item.NameAr, Required: item.Required, MinSelections: item.MinSelections, MaxSelections: item.MaxSelections, Active: item.Active, Version: item.Version, Options: options})
	}
	return values
}

func quantityValue(value *int64) int64 {
	if value == nil {
		return 0
	}
	return *value
}

func writeOffers(w http.ResponseWriter, status int, items []postgres.CatalogStoreOfferRecord) {
	values := make([]contract.CatalogStoreOffer, 0, len(items))
	for _, item := range items {
		values = append(values, toStoreOffer(item))
	}
	writeJSON(w, status, contract.CatalogStoreOfferListResponse{Offers: values})
}
func writeOffer(w http.ResponseWriter, status int, result postgres.CatalogStoreOfferResult) {
	writeJSON(w, status, contract.CatalogStoreOfferResponse{Offer: toStoreOffer(result.Offer), IdempotentReplay: result.Replayed})
}
