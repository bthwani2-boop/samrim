package transporthttp

import (
	"database/sql"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/contract"
	identityintegration "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/identity"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/locationcore"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	identityclient "github.com/bthwani2-boop/samrim/services/identity/clients/go"
)

type LocationCoreServer struct {
	service *locationcore.Service
}

func NewLocationCore(identityClient *identityintegration.Client, db *sql.DB) (*LocationCoreServer, error) {
	service, err := locationcore.New(identityClient, db)
	if err != nil {
		return nil, err
	}
	return &LocationCoreServer{service: service}, nil
}

func (s *LocationCoreServer) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /dsh/addresses", s.listAddresses)
	mux.HandleFunc("POST /dsh/addresses", s.createAddress)
	mux.HandleFunc("GET /dsh/addresses/{addressId}", s.readAddress)
	mux.HandleFunc("POST /dsh/addresses/{addressId}", s.updateAddress)
	mux.HandleFunc("GET /dsh/stores/{storeId}/delivery-origin", s.readStoreOrigin)
}

func (s *LocationCoreServer) listAddresses(w http.ResponseWriter, r *http.Request) {
	if bearerToken(r) == "" {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "client session is required")
		return
	}
	limit := 50
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 || parsed > 50 {
			writeError(w, http.StatusBadRequest, "INVALID_INPUT", "limit must be between 1 and 50")
			return
		}
		limit = parsed
	}
	result, err := s.service.ListOwnAddresses(r.Context(), bearerToken(r), limit, r.URL.Query().Get("cursor"))
	if err != nil {
		writeLocationError(w, err)
		return
	}
	values := make([]contract.DeliveryAddress, 0, len(result.Addresses))
	for _, address := range result.Addresses {
		values = append(values, toDeliveryAddress(address))
	}
	writeJSON(w, http.StatusOK, contract.DeliveryAddressListResponse{Addresses: values, NextCursor: result.NextCursor})
}

func (s *LocationCoreServer) readAddress(w http.ResponseWriter, r *http.Request) {
	if bearerToken(r) == "" {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "client session is required")
		return
	}
	address, err := s.service.ReadOwnAddress(r.Context(), bearerToken(r), r.PathValue("addressId"))
	if err != nil {
		writeLocationError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, contract.DeliveryAddressResponse{Address: toDeliveryAddress(address)})
}

func (s *LocationCoreServer) createAddress(w http.ResponseWriter, r *http.Request) {
	correlation, idempotency, _, ok := requiredLocationHeaders(w, r, false, false)
	if !ok {
		return
	}
	var input contract.CreateDeliveryAddressRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	result, err := s.service.CreateOwnAddress(r.Context(), bearerToken(r), input.ServiceCityID, input.AddressText, input.Latitude, input.Longitude, idempotency, correlation)
	if err != nil {
		writeLocationError(w, err)
		return
	}
	status := http.StatusCreated
	if result.Replayed {
		status = http.StatusOK
	}
	writeJSON(w, status, contract.DeliveryAddressResponse{Address: toDeliveryAddress(result.Address), IdempotentReplay: result.Replayed})
}

func (s *LocationCoreServer) updateAddress(w http.ResponseWriter, r *http.Request) {
	correlation, idempotency, expectedVersion, ok := requiredLocationHeaders(w, r, true, false)
	if !ok {
		return
	}
	var input contract.UpdateDeliveryAddressRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	result, err := s.service.UpdateOwnAddress(r.Context(), bearerToken(r), r.PathValue("addressId"), input.ServiceCityID, input.AddressText, input.Latitude, input.Longitude, expectedVersion, idempotency, correlation)
	if err != nil {
		writeLocationError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, contract.DeliveryAddressResponse{Address: toDeliveryAddress(result.Address), IdempotentReplay: result.Replayed})
}

func (s *LocationCoreServer) readStoreOrigin(w http.ResponseWriter, r *http.Request) {
	if bearerToken(r) == "" {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "partner session is required")
		return
	}
	origin, available, err := s.service.ReadStoreOrigin(r.Context(), bearerToken(r), r.PathValue("storeId"))
	if err != nil {
		writeLocationError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, contract.StoreDeliveryOriginResponse{StoreID: origin.StoreID, OriginVersion: origin.OriginVersion, Origin: deliveryOriginValue(origin, available)})
}

func requiredLocationHeaders(w http.ResponseWriter, r *http.Request, versioned, allowZeroVersion bool) (string, string, int, bool) {
	if bearerToken(r) == "" {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "a user session is required")
		return "", "", 0, false
	}
	if r.Header.Get("X-Actor-ID") != "" || r.Header.Get("X-Acting-Actor-ID") != "" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "location ownership comes from the canonical session")
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
	expectedVersion, err := strconv.Atoi(strings.TrimSpace(r.Header.Get("X-Expected-Version")))
	minimumVersion := 1
	if allowZeroVersion {
		minimumVersion = 0
	}
	if err != nil || expectedVersion < minimumVersion {
		message := "X-Expected-Version must be a positive integer"
		if allowZeroVersion {
			message = "X-Expected-Version must be a non-negative integer"
		}
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", message)
		return "", "", 0, false
	}
	return correlation, idempotency, expectedVersion, true
}

func toDeliveryAddress(address postgres.DeliveryAddressRecord) contract.DeliveryAddress {
	return contract.DeliveryAddress{ID: address.ID, ServiceCityID: address.ServiceCityID, AddressText: address.AddressText, Latitude: address.Latitude, Longitude: address.Longitude, Version: address.Version, CreatedAt: address.CreatedAt, UpdatedAt: address.UpdatedAt}
}

func toDeliveryOrigin(origin postgres.StoreDeliveryOriginRecord) *contract.DeliveryOrigin {
	return &contract.DeliveryOrigin{Latitude: origin.Latitude, Longitude: origin.Longitude}
}

func deliveryOriginValue(origin postgres.StoreDeliveryOriginRecord, available bool) *contract.DeliveryOrigin {
	if !available {
		return nil
	}
	return toDeliveryOrigin(origin)
}

func writeLocationError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, locationcore.ErrLocationInputInvalid), errors.Is(err, postgres.ErrDeliveryAddressInvalidLimit), errors.Is(err, postgres.ErrDeliveryAddressInvalidCursor), errors.Is(err, postgres.ErrServiceCityNotFound):
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "location facts are invalid")
	case errors.Is(err, postgres.ErrDeliveryAddressNotFound), errors.Is(err, postgres.ErrStoreOriginNotFound), errors.Is(err, postgres.ErrStoreNotFound):
		writeError(w, http.StatusNotFound, "NOT_FOUND", "location record was not found")
	case errors.Is(err, locationcore.ErrClientSessionForbidden), errors.Is(err, locationcore.ErrPartnerSessionForbidden):
		writeError(w, http.StatusForbidden, "FORBIDDEN", "the authenticated session cannot access this location record")
	case errors.Is(err, postgres.ErrDeliveryAddressIdempotency), errors.Is(err, postgres.ErrStoreOriginIdempotency):
		writeError(w, http.StatusConflict, "IDEMPOTENCY_CONFLICT", "Idempotency-Key was already used with different location facts")
	case errors.Is(err, postgres.ErrDeliveryAddressVersion), errors.Is(err, postgres.ErrStoreOriginVersion):
		writeError(w, http.StatusConflict, "VERSION_CONFLICT", "location record version is stale")
	default:
		var identityErr *identityclient.Error
		if errors.As(err, &identityErr) {
			writeIdentityError(w, err)
			return
		}
		writeError(w, http.StatusBadGateway, "DSH_STORAGE_UNAVAILABLE", "DSH persistence or Identity is unavailable")
	}
}
