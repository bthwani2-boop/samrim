package transporthttp

import (
	"database/sql"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/auth"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/contract"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/field"
	identityintegration "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/identity"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/joiningcase"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	identityclient "github.com/bthwani2-boop/samrim/services/identity/clients/go"
)

type FieldServer struct {
	auth    *auth.ServiceToken
	service *field.Service
}

func NewField(identityClient *identityintegration.Client, accessToken string, db *sql.DB) (*FieldServer, error) {
	authorizer, err := auth.NewServiceToken(strings.TrimSpace(accessToken))
	if err != nil {
		return nil, err
	}
	service, err := field.New(identityClient, db)
	if err != nil {
		return nil, err
	}
	return &FieldServer{auth: authorizer, service: service}, nil
}

func (s *FieldServer) Register(mux *http.ServeMux) {
	mux.HandleFunc("POST /dsh/fields/admissions", s.admit)
	mux.HandleFunc("GET /dsh/fields/admissions/{admissionId}", s.readAdmission)
	mux.HandleFunc("GET /dsh/fields/actors/{actorId}/admission", s.readAdmissionForActor)
	mux.HandleFunc("GET /dsh/fields/me", s.readOwnAdmission)
	mux.HandleFunc("POST /dsh/fields/{actorId}/identity-role", s.setRole)
	mux.HandleFunc("POST /dsh/field/joining-cases", s.createJoiningCase)
	mux.HandleFunc("GET /dsh/field/joining-cases", s.listJoiningCases)
	mux.HandleFunc("GET /dsh/field/joining-cases/{caseId}", s.readJoiningCase)
	mux.HandleFunc("POST /dsh/field/joining-cases/{caseId}/submit", s.submitJoiningCase)
}

func (s *FieldServer) admit(w http.ResponseWriter, r *http.Request) {
	if !s.authorizedService(w, r) {
		return
	}
	acting, correlation, idempotency, _, ok := captainHeaders(w, r, false)
	if !ok || acting == "" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "Field admission attribution is required")
		return
	}
	var input contract.FieldAdmissionRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	admission, replayed, err := s.service.Admit(r.Context(), input.ContactPhoneE164, idempotency, acting, correlation)
	if err != nil {
		writeFieldError(w, err)
		return
	}
	status := http.StatusCreated
	if replayed {
		status = http.StatusOK
	}
	writeJSON(w, status, contract.FieldAdmissionResponse{Admission: toFieldAdmission(admission), IdempotentReplay: replayed})
}

func (s *FieldServer) readAdmission(w http.ResponseWriter, r *http.Request) {
	if !s.authorizedService(w, r) {
		return
	}
	acting := strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID"))
	if acting == "" || len(acting) > 128 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "X-Acting-Actor-ID is required")
		return
	}
	admission, err := s.service.ReadForOperator(r.Context(), r.PathValue("admissionId"), acting)
	if err != nil {
		writeFieldError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, contract.FieldAdmissionResponse{Admission: toFieldAdmission(admission)})
}

func (s *FieldServer) readAdmissionForActor(w http.ResponseWriter, r *http.Request) {
	if !s.authorizedService(w, r) {
		return
	}
	acting := strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID"))
	if acting == "" || len(acting) > 128 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "X-Acting-Actor-ID is required")
		return
	}
	admission, err := s.service.ReadForOperatorByActor(r.Context(), r.PathValue("actorId"), acting)
	if err != nil {
		writeFieldError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, contract.FieldAdmissionResponse{Admission: toFieldAdmission(admission)})
}

func (s *FieldServer) readOwnAdmission(w http.ResponseWriter, r *http.Request) {
	admission, err := s.service.ReadForField(r.Context(), bearerToken(r))
	if err != nil {
		writeFieldError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, contract.FieldAdmissionResponse{Admission: toFieldAdmission(admission)})
}

func (s *FieldServer) setRole(w http.ResponseWriter, r *http.Request) {
	if !s.authorizedService(w, r) {
		return
	}
	acting, correlation, idempotency, expected, ok := captainHeaders(w, r, true)
	if !ok || acting == "" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "Field role mutation attribution is required")
		return
	}
	var input contract.ManagedRoleMutationRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	if err := s.service.SetManagedRoleEnabled(r.Context(), r.PathValue("actorId"), acting, correlation, idempotency, input.Reason, expected, input.Enabled); err != nil {
		writeFieldError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *FieldServer) createJoiningCase(w http.ResponseWriter, r *http.Request) {
	if bearerToken(r) == "" {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "Field session is required")
		return
	}
	if r.Header.Get("X-Actor-ID") != "" || r.Header.Get("X-Acting-Actor-ID") != "" || r.Header.Get("If-Match") != "" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "client actor authority headers are forbidden")
		return
	}
	correlation, idempotency, ok := requiredFieldMutationHeaders(w, r)
	if !ok {
		return
	}
	var input contract.CreateJoiningCaseRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	result, err := s.service.CreateJoiningCase(r.Context(), bearerToken(r), idempotency, correlation, input.ContactPhoneE164, input.BusinessName, input.FirstStoreName, input.ServiceCityID, input.FirstStoreVerticalID)
	if err != nil {
		writeFieldError(w, err)
		return
	}
	writeFieldCaseResult(w, responseStatus(result.Replayed), result)
}

func (s *FieldServer) listJoiningCases(w http.ResponseWriter, r *http.Request) {
	limit := 25
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil {
			writeFieldError(w, postgres.ErrJoiningCaseInvalidLimit)
			return
		}
		limit = parsed
	}
	result, err := s.service.ListJoiningCases(r.Context(), bearerToken(r), limit)
	if err != nil {
		writeFieldError(w, err)
		return
	}
	items := make([]contract.JoiningCaseSummary, 0, len(result.Cases))
	for _, item := range result.Cases {
		items = append(items, contract.JoiningCaseSummary{ID: item.ID, ContactPhoneE164: item.ContactPhoneE164, BusinessName: item.BusinessName, FirstStoreName: item.FirstStoreName, ServiceCityID: item.FirstStoreServiceCityID, FirstStoreVerticalID: item.FirstStoreVerticalID, State: contract.JoiningCaseState(item.State), CorrectionReason: item.CorrectionReason, Version: item.Version, CreatedAt: item.CreatedAt, UpdatedAt: item.UpdatedAt})
	}
	writeJSON(w, http.StatusOK, contract.JoiningCaseListResponse{Cases: items})
}

func (s *FieldServer) readJoiningCase(w http.ResponseWriter, r *http.Request) {
	result, err := s.service.ReadJoiningCase(r.Context(), bearerToken(r), r.PathValue("caseId"))
	if err != nil {
		writeFieldError(w, err)
		return
	}
	writeFieldCaseResult(w, http.StatusOK, result)
}

func (s *FieldServer) submitJoiningCase(w http.ResponseWriter, r *http.Request) {
	if bearerToken(r) == "" {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "Field session is required")
		return
	}
	correlation, idempotency, expected, ok := requiredPartnerCaseHeaders(w, r)
	if !ok {
		return
	}
	result, err := s.service.SubmitJoiningCase(r.Context(), bearerToken(r), r.PathValue("caseId"), expected, idempotency, correlation)
	if err != nil {
		writeFieldError(w, err)
		return
	}
	writeFieldCaseResult(w, http.StatusOK, result)
}

func (s *FieldServer) authorizedService(w http.ResponseWriter, r *http.Request) bool {
	if s.auth.Authorized(r) {
		return true
	}
	writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "service authentication is required")
	return false
}

func writeFieldCaseResult(w http.ResponseWriter, status int, result postgres.JoiningCaseResult) {
	view := contract.JoiningCaseView{ID: result.Case.ID, ContactPhoneE164: result.Case.ContactPhoneE164, BusinessName: result.Case.BusinessName, FirstStoreName: result.Case.FirstStoreName, ServiceCityID: result.Case.FirstStoreServiceCityID, FirstStoreVerticalID: result.Case.FirstStoreVerticalID, State: contract.JoiningCaseState(result.Case.State), CorrectionReason: result.Case.CorrectionReason, Version: result.Case.Version, CreatedAt: result.Case.CreatedAt, UpdatedAt: result.Case.UpdatedAt}
	writeJSON(w, status, contract.JoiningCaseResponse{Case: view, IdempotentReplay: result.Replayed})
}

func requiredFieldMutationHeaders(w http.ResponseWriter, r *http.Request) (string, string, bool) {
	correlation := strings.TrimSpace(r.Header.Get("X-Correlation-ID"))
	idempotency := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	if len(correlation) < 8 || len(correlation) > 128 || len(idempotency) < 8 || len(idempotency) > 128 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "X-Correlation-ID and Idempotency-Key are required")
		return "", "", false
	}
	return correlation, idempotency, true
}

func toFieldAdmission(value postgres.FieldAdmission) contract.FieldAdmission {
	return contract.FieldAdmission{ID: value.ID, ActorID: value.ActorID, State: value.State, Version: value.Version, CreatedAt: value.CreatedAt, UpdatedAt: value.UpdatedAt}
}

func writeFieldError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, field.ErrInvalidInput), errors.Is(err, joiningcase.ErrInvalidInput):
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "Field input is invalid")
	case errors.Is(err, field.ErrOperatorNotActive), errors.Is(err, field.ErrFieldSessionForbidden):
		writeError(w, http.StatusForbidden, "FORBIDDEN", "the authenticated actor is not permitted for this Field operation")
	case errors.Is(err, postgres.ErrFieldAdmissionNotFound):
		writeError(w, http.StatusNotFound, "NOT_FOUND", "Field admission was not found")
	case errors.Is(err, postgres.ErrFieldAdmissionExists), errors.Is(err, postgres.ErrFieldAdmissionConflict), errors.Is(err, postgres.ErrFieldOperationConflict), errors.Is(err, postgres.ErrFieldVersionConflict), errors.Is(err, postgres.ErrJoiningCaseVersion), errors.Is(err, postgres.ErrJoiningCaseState), errors.Is(err, postgres.ErrJoiningCaseExists), errors.Is(err, postgres.ErrJoiningCaseActor), errors.Is(err, postgres.ErrJoiningCaseRebind):
		writeError(w, http.StatusConflict, "VERSION_OR_STATE_CONFLICT", "Field or joining-case state is stale or not actionable")
	case errors.Is(err, postgres.ErrJoiningCaseNotFound):
		writeError(w, http.StatusNotFound, "NOT_FOUND", "joining case was not found")
	default:
		var identityErr *identityclient.Error
		if errors.As(err, &identityErr) {
			writeIdentityError(w, err)
			return
		}
		writeJoiningCaseError(w, err)
	}
}
