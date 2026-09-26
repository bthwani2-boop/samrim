package transporthttp

import (
	"database/sql"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/auth"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/contract"
	identityintegration "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/identity"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/servicecity"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	identityclient "github.com/bthwani2-boop/samrim/services/identity/clients/go"
)

type ServiceCityServer struct {
	auth    *auth.ServiceToken
	service *servicecity.Service
	db      *sql.DB
}

func NewServiceCity(identityClient *identityintegration.Client, accessToken string, db *sql.DB) (*ServiceCityServer, error) {
	authorizer, err := auth.NewServiceToken(accessToken)
	if err != nil {
		return nil, err
	}
	service, err := servicecity.New(identityClient, db)
	if err != nil {
		return nil, err
	}
	return &ServiceCityServer{auth: authorizer, service: service, db: db}, nil
}

func (s *ServiceCityServer) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /dsh/public/service-cities", s.listPublic)
	mux.HandleFunc("GET /dsh/service-cities", s.list)
	mux.HandleFunc("POST /dsh/service-cities", s.create)
	mux.HandleFunc("GET /dsh/service-cities/{cityId}", s.read)
	mux.HandleFunc("PATCH /dsh/service-cities/{cityId}", s.update)
}

func (s *ServiceCityServer) listPublic(w http.ResponseWriter, r *http.Request) {
	cities, err := postgres.ListActiveServiceCities(r.Context(), s.db)
	if err != nil {
		writeError(w, http.StatusBadGateway, "DSH_STORAGE_UNAVAILABLE", "DSH persistence is unavailable")
		return
	}
	writeServiceCityList(w, cities)
}

func (s *ServiceCityServer) list(w http.ResponseWriter, r *http.Request) {
	if !s.auth.Authorized(r) {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "service authentication is required")
		return
	}
	acting := strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID"))
	if acting == "" || len(acting) > 128 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "X-Acting-Actor-ID is required")
		return
	}
	includeInactive := false
	if raw := strings.TrimSpace(r.URL.Query().Get("includeInactive")); raw != "" {
		parsed, err := strconv.ParseBool(raw)
		if err != nil {
			writeError(w, http.StatusBadRequest, "INVALID_INPUT", "includeInactive must be a boolean")
			return
		}
		includeInactive = parsed
	}
	cities, err := s.service.List(r.Context(), includeInactive, acting)
	if err != nil {
		writeServiceCityError(w, err)
		return
	}
	writeServiceCityList(w, cities)
}

func (s *ServiceCityServer) create(w http.ResponseWriter, r *http.Request) {
	if !s.auth.Authorized(r) {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "service authentication is required")
		return
	}
	acting, correlation, idempotency, ok := requiredMutationHeaders(w, r)
	if !ok {
		return
	}
	var input contract.CreateServiceCityRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	result, err := s.service.Create(r.Context(), input.DisplayNameAr, input.Active, idempotency, acting, correlation)
	if err != nil {
		writeServiceCityError(w, err)
		return
	}
	writeServiceCity(w, responseStatus(result.Replayed), result)
}

func (s *ServiceCityServer) read(w http.ResponseWriter, r *http.Request) {
	if !s.auth.Authorized(r) {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "service authentication is required")
		return
	}
	acting := strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID"))
	if acting == "" || len(acting) > 128 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "X-Acting-Actor-ID is required")
		return
	}
	city, err := s.service.Read(r.Context(), r.PathValue("cityId"), acting)
	if err != nil {
		writeServiceCityError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, contract.ServiceCityResponse{City: toServiceCity(city)})
}

func (s *ServiceCityServer) update(w http.ResponseWriter, r *http.Request) {
	if !s.auth.Authorized(r) {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "service authentication is required")
		return
	}
	acting, correlation, idempotency, expectedVersion, ok := requiredVersionedCaseHeaders(w, r)
	if !ok {
		return
	}
	var input contract.UpdateServiceCityRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	result, err := s.service.Update(r.Context(), r.PathValue("cityId"), input.DisplayNameAr, input.Active, expectedVersion, idempotency, acting, correlation)
	if err != nil {
		writeServiceCityError(w, err)
		return
	}
	writeServiceCity(w, http.StatusOK, result)
}

func writeServiceCityList(w http.ResponseWriter, cities []postgres.ServiceCityRecord) {
	values := make([]contract.ServiceCity, 0, len(cities))
	for _, city := range cities {
		values = append(values, toServiceCity(city))
	}
	writeJSON(w, http.StatusOK, contract.ServiceCityListResponse{Cities: values})
}

func writeServiceCity(w http.ResponseWriter, status int, result postgres.ServiceCityResult) {
	writeJSON(w, status, contract.ServiceCityResponse{City: toServiceCity(result.City), IdempotentReplay: result.Replayed})
}

func toServiceCity(city postgres.ServiceCityRecord) contract.ServiceCity {
	return contract.ServiceCity{ID: city.ID, DisplayNameAr: city.DisplayNameAr, Active: city.Active, Version: city.Version, CreatedAt: city.CreatedAt, UpdatedAt: city.UpdatedAt}
}

func toServiceCityRecord(city *postgres.ServiceCityRecord) contract.ServiceCity {
	if city == nil {
		return contract.ServiceCity{}
	}
	return toServiceCity(*city)
}

func writeServiceCityError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, servicecity.ErrInvalidInput), errors.Is(err, postgres.ErrServiceCityInvalid):
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "service city facts are invalid")
	case errors.Is(err, servicecity.ErrOperatorNotActive):
		writeError(w, http.StatusForbidden, "FORBIDDEN", "an active control operator session is required")
	case errors.Is(err, servicecity.ErrOperatorPermission):
		writeError(w, http.StatusForbidden, "FORBIDDEN", "Platform Policies permission is required")
	case errors.Is(err, postgres.ErrServiceCityNotFound):
		writeError(w, http.StatusNotFound, "NOT_FOUND", "service city was not found")
	case errors.Is(err, postgres.ErrServiceCityExists):
		writeError(w, http.StatusConflict, "SERVICE_CITY_EXISTS", "service city identity already exists")
	case errors.Is(err, postgres.ErrServiceCityIdempotency):
		writeError(w, http.StatusConflict, "IDEMPOTENCY_CONFLICT", "Idempotency-Key was already used with different service city facts")
	case errors.Is(err, postgres.ErrServiceCityVersion):
		writeError(w, http.StatusConflict, "VERSION_CONFLICT", "service city version is stale")
	default:
		var identityErr *identityclient.Error
		if errors.As(err, &identityErr) {
			writeIdentityError(w, err)
			return
		}
		writeError(w, http.StatusBadGateway, "DSH_STORAGE_UNAVAILABLE", "DSH persistence or Identity is unavailable")
	}
}
