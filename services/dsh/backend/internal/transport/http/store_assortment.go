package transporthttp

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/contract"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

func (s *CatalogServer) listAssortment(w http.ResponseWriter, r *http.Request) {
	if bearerToken(r) == "" {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "partner session is required")
		return
	}
	assortments, err := s.service.ListForPartner(r.Context(), bearerToken(r), r.PathValue("storeId"))
	if err != nil {
		writeCatalogError(w, err)
		return
	}
	writeAssortments(w, http.StatusOK, assortments)
}

func (s *CatalogServer) createAssortment(w http.ResponseWriter, r *http.Request) {
	correlation, idempotency, _, ok := requiredPartnerAssortmentHeaders(w, r, false)
	if !ok {
		return
	}
	var input contract.CreateStoreAssortmentRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	result, err := s.service.CreateStoreAssortment(r.Context(), bearerToken(r), r.PathValue("storeId"), input.ProductID, int64(input.PriceMinor), idempotency, correlation)
	if err != nil {
		writeCatalogError(w, err)
		return
	}
	writeAssortment(w, responseStatus(result.Replayed), result)
}

func (s *CatalogServer) updateAssortment(w http.ResponseWriter, r *http.Request) {
	correlation, idempotency, expected, ok := requiredPartnerAssortmentHeaders(w, r, true)
	if !ok {
		return
	}
	var input contract.UpdateStoreAssortmentRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	result, err := s.service.UpdateStoreAssortment(r.Context(), bearerToken(r), r.PathValue("storeId"), r.PathValue("productId"), int64(input.PriceMinor), input.Availability, string(input.PublicationState), expected, idempotency, correlation)
	if err != nil {
		writeCatalogError(w, err)
		return
	}
	writeAssortment(w, http.StatusOK, result)
}

func requiredPartnerAssortmentHeaders(w http.ResponseWriter, r *http.Request, versioned bool) (string, string, int, bool) {
	if bearerToken(r) == "" {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "partner session is required")
		return "", "", 0, false
	}
	if r.Header.Get("X-Actor-ID") != "" || r.Header.Get("X-Acting-Actor-ID") != "" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "assortment ownership comes from the canonical partner session")
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

func toStoreAssortment(assortment postgres.StoreAssortmentRecord) contract.StoreAssortment {
	return contract.StoreAssortment{StoreID: assortment.StoreID, ProductID: assortment.ProductID, CanonicalName: assortment.Product.CanonicalName, Brand: optionalProductValue(assortment.Product.Brand), Barcode: optionalProductValue(assortment.Product.Barcode), CanonicalImageUrl: optionalProductValue(assortment.Product.CanonicalImageURL), SellUnit: contract.SellUnit(assortment.Product.SellUnit), ProductActive: assortment.Product.Active, ProductVersion: assortment.Product.Version, PriceMinor: int(assortment.PriceMinor), Currency: assortment.Currency, Availability: assortment.Availability, PublicationState: contract.AssortmentPublicationState(assortment.PublicationState), Version: assortment.Version, CreatedAt: assortment.CreatedAt, UpdatedAt: assortment.UpdatedAt}
}

func writeAssortments(w http.ResponseWriter, status int, assortments []postgres.StoreAssortmentRecord) {
	views := make([]contract.StoreAssortment, 0, len(assortments))
	for _, assortment := range assortments {
		views = append(views, toStoreAssortment(assortment))
	}
	writeJSON(w, status, contract.StoreAssortmentListResponse{Assortments: views})
}

func writeAssortment(w http.ResponseWriter, status int, result postgres.StoreAssortmentResult) {
	writeJSON(w, status, contract.StoreAssortmentResponse{Assortment: toStoreAssortment(result.Assortment), IdempotentReplay: result.Replayed})
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}
