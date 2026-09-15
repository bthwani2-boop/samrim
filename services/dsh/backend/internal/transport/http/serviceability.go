package transporthttp

import (
	"database/sql"
	"errors"
	"net/http"
	"strings"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/contract"
	identityintegration "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/identity"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/serviceability"
	identityclient "github.com/bthwani2-boop/samrim/services/identity/clients/go"
)

type ServiceabilityServer struct {
	service *serviceability.Service
}

func NewServiceability(identityClient *identityintegration.Client, db *sql.DB) (*ServiceabilityServer, error) {
	service, err := serviceability.New(identityClient, db)
	if err != nil {
		return nil, err
	}
	return NewServiceabilityWithService(service)
}

func NewServiceabilityWithService(service *serviceability.Service) (*ServiceabilityServer, error) {
	if service == nil {
		return nil, errors.New("serviceability configuration is invalid")
	}
	return &ServiceabilityServer{service: service}, nil
}

func (s *ServiceabilityServer) Register(mux *http.ServeMux) {
	mux.HandleFunc("POST /dsh/serviceability", s.evaluate)
}

func (s *ServiceabilityServer) evaluate(w http.ResponseWriter, r *http.Request) {
	if bearerToken(r) == "" {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "client session is required")
		return
	}
	var input contract.ServiceabilityRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	if strings.TrimSpace(input.StoreID) == "" || strings.TrimSpace(input.AddressID) == "" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "storeId and addressId are required")
		return
	}
	result, err := s.service.Evaluate(r.Context(), bearerToken(r), input.StoreID, input.AddressID)
	if err != nil {
		writeServiceabilityError(w, err)
		return
	}
	facts := result.Facts
	writeJSON(w, http.StatusOK, contract.ServiceabilityResponse{
		Status: contract.ServiceabilityStatus(result.Status),
		Evidence: contract.ServiceabilityEvidence{
			StoreID: facts.StoreID, StoreVersion: facts.StoreVersion,
			AddressID: facts.AddressID, AddressVersion: facts.AddressVersion,
			StoreServiceCityID:   nullableString(facts.StoreServiceCityID),
			AddressServiceCityID: nullableString(facts.AddressServiceCityID),
			ServiceCityID:        nullableString(facts.ServiceCityID), ServiceCityVersion: facts.ServiceCityVersion,
			PolicyVersion: serviceability.PolicyVersion, EvaluatedAt: facts.EvaluatedAt,
		},
	})
}

func writeServiceabilityError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, serviceability.ErrClientSessionForbidden):
		writeError(w, http.StatusForbidden, "FORBIDDEN", "an active app-client session is required")
	default:
		var identityErr *identityclient.Error
		if errors.As(err, &identityErr) {
			writeIdentityError(w, err)
			return
		}
		writeError(w, http.StatusBadGateway, "DSH_STORAGE_UNAVAILABLE", "DSH persistence or Identity is unavailable")
	}
}
