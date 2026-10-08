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

type fieldJoiningCaseDraftRequest struct {
	contract.CreateFieldJoiningCaseDraftRequest
	FirstStoreProofNumber *string  `json:"firstStoreProofNumber"`
	FirstStoreLatitude    *float64 `json:"firstStoreLatitude"`
	FirstStoreLongitude   *float64 `json:"firstStoreLongitude"`
}

func (input *fieldJoiningCaseDraftRequest) applyDraftScalars() bool {
	if input.FirstStoreProofNumber != nil {
		input.CreateFieldJoiningCaseDraftRequest.FirstStoreProofNumber = *input.FirstStoreProofNumber
	}
	if (input.FirstStoreLatitude == nil) != (input.FirstStoreLongitude == nil) {
		return false
	}
	if input.FirstStoreLatitude == nil {
		input.CreateFieldJoiningCaseDraftRequest.FirstStoreLatitude = 0
		input.CreateFieldJoiningCaseDraftRequest.FirstStoreLongitude = 0
	} else {
		input.CreateFieldJoiningCaseDraftRequest.FirstStoreLatitude = *input.FirstStoreLatitude
		input.CreateFieldJoiningCaseDraftRequest.FirstStoreLongitude = *input.FirstStoreLongitude
	}
	return true
}

func (input fieldJoiningCaseDraftRequest) createRequest() contract.CreateJoiningCaseRequest {
	draft := input.CreateFieldJoiningCaseDraftRequest
	return contract.CreateJoiningCaseRequest{
		ContactPhoneE164: draft.ContactPhoneE164, OwnerFullName: draft.OwnerFullName, BusinessName: draft.BusinessName,
		FirstStoreName: draft.FirstStoreName, WalletProviderKey: draft.WalletProviderKey, FirstStoreAddress: draft.FirstStoreAddress,
		ServiceCityID: draft.ServiceCityID, FirstStoreVerticalID: draft.FirstStoreVerticalID,
		FirstStoreCommercialTypeID: draft.FirstStoreCommercialTypeID, FirstStoreLatitude: draft.FirstStoreLatitude,
		FirstStoreLongitude: draft.FirstStoreLongitude, FirstStoreWorkingHours: contract.StoreWeeklyWorkingHours{Intervals: draft.FirstStoreWorkingHours.Intervals},
		FirstStoreProofType: draft.FirstStoreProofType, FirstStoreProofNumber: draft.FirstStoreProofNumber,
		FirstStoreNotes: draft.FirstStoreNotes, FirstStoreFulfillmentModes: draft.FirstStoreFulfillmentModes,
	}
}

func NewField(identityClient *identityintegration.Client, accessToken string, db *sql.DB, evidenceKeys *postgres.JoiningCaseEvidenceKeyring) (*FieldServer, error) {
	authorizer, err := auth.NewServiceToken(strings.TrimSpace(accessToken))
	if err != nil {
		return nil, err
	}
	service, err := field.New(identityClient, db, evidenceKeys)
	if err != nil {
		return nil, err
	}
	return &FieldServer{auth: authorizer, service: service}, nil
}

func (s *FieldServer) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /dsh/fields/admissions", s.listAdmissions)
	mux.HandleFunc("POST /dsh/fields/admissions", s.admit)
	mux.HandleFunc("PATCH /dsh/fields/admissions/{admissionId}/profile", s.updateAdmissionProfile)
	mux.HandleFunc("POST /dsh/fields/admissions/{admissionId}/profile-review", s.reviewAdmissionProfile)
	mux.HandleFunc("POST /dsh/fields/admissions/{admissionId}/approve", s.approveAdmission)
	mux.HandleFunc("POST /dsh/fields/admissions/{admissionId}/provision", s.provisionAdmission)
	mux.HandleFunc("GET /dsh/fields/admissions/{admissionId}", s.readAdmission)
	mux.HandleFunc("GET /dsh/fields/actors/{actorId}/admission", s.readAdmissionForActor)
	mux.HandleFunc("GET /dsh/fields/me", s.readOwnAdmission)
	mux.HandleFunc("POST /dsh/fields/{actorId}/identity-role", s.setRole)
	mux.HandleFunc("POST /dsh/fields/{actorId}/reenrollment", s.authorizeReenrollment)
	mux.HandleFunc("POST /dsh/field/joining-cases", s.createJoiningCase)
	mux.HandleFunc("PATCH /dsh/field/joining-cases/{caseId}/draft", s.updateJoiningCaseDraft)
	mux.HandleFunc("GET /dsh/field/joining-cases", s.listJoiningCases)
	mux.HandleFunc("GET /dsh/field/joining-cases/{caseId}", s.readJoiningCase)
	mux.HandleFunc("POST /dsh/field/joining-cases/{caseId}/submit", s.submitJoiningCase)
	mux.HandleFunc("POST /dsh/field/joining-cases/{caseId}/proof-image", s.uploadJoiningCaseProofImage)
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
	admission, replayed, err := s.service.Admit(r.Context(), input.FullNameAr, input.ContactPhoneE164, input.ServiceCityID, input.WalletProviderKey, input.AllServiceCities, input.ServiceCityIds, idempotency, acting, correlation)
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

func (s *FieldServer) listAdmissions(w http.ResponseWriter, r *http.Request) {
	if !s.authorizedService(w, r) {
		return
	}
	acting := strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID"))
	if acting == "" || len(acting) > 128 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "X-Acting-Actor-ID is required")
		return
	}
	limit := 25
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 || parsed > 50 {
			writeError(w, http.StatusBadRequest, "INVALID_INPUT", "limit must be between 1 and 50")
			return
		}
		limit = parsed
	}
	query := strings.TrimSpace(r.URL.Query().Get("q"))
	cursor := strings.TrimSpace(r.URL.Query().Get("cursor"))
	sort := strings.TrimSpace(r.URL.Query().Get("sort"))
	state := strings.TrimSpace(r.URL.Query().Get("state"))
	serviceCityID := strings.TrimSpace(r.URL.Query().Get("serviceCityId"))
	if len([]rune(query)) > 100 || len(cursor) > 1024 || len(serviceCityID) > 128 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "Field admission search or cursor is invalid")
		return
	}
	page, err := s.service.ListAdmissionsForOperator(r.Context(), query, state, sort, serviceCityID, limit, cursor, acting)
	if err != nil {
		writeFieldError(w, err)
		return
	}
	items := make([]contract.FieldAdmission, 0, len(page.Admissions))
	for _, v := range page.Admissions {
		items = append(items, toFieldAdmission(v))
	}
	writeJSON(w, http.StatusOK, contract.FieldAdmissionListResponse{Admissions: items, NextCursor: page.NextCursor})
}

func (s *FieldServer) updateAdmissionProfile(w http.ResponseWriter, r *http.Request) {
	if !s.authorizedService(w, r) {
		return
	}
	acting, correlation, idempotency, expected, ok := captainHeaders(w, r, true)
	if !ok || acting == "" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "Field profile mutation attribution and current version are required")
		return
	}
	var input contract.FieldAdmissionProfileRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	admission, replayed, err := s.service.UpdateAdmissionProfile(r.Context(), r.PathValue("admissionId"), input.FullNameAr, input.WalletProviderKey, input.AllServiceCities, input.ServiceCityIds, expected, idempotency, acting, correlation)
	if err != nil {
		writeFieldError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, contract.FieldAdmissionResponse{Admission: toFieldAdmission(admission), IdempotentReplay: replayed})
}

func (s *FieldServer) reviewAdmissionProfile(w http.ResponseWriter, r *http.Request) {
	if !s.authorizedService(w, r) {
		return
	}
	acting, correlation, idempotency, expected, ok := captainHeaders(w, r, true)
	if !ok || acting == "" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "Field profile review attribution and current version are required")
		return
	}
	admission, replayed, err := s.service.ReviewAdmissionProfile(r.Context(), r.PathValue("admissionId"), expected, idempotency, acting, correlation)
	if err != nil {
		writeFieldError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, contract.FieldAdmissionResponse{Admission: toFieldAdmission(admission), IdempotentReplay: replayed})
}

func (s *FieldServer) approveAdmission(w http.ResponseWriter, r *http.Request) {
	if !s.authorizedService(w, r) {
		return
	}
	acting, correlation, idempotency, expectedVersion, ok := captainHeaders(w, r, true)
	if !ok || acting == "" || idempotency == "" || expectedVersion < 1 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "Field approval attribution, Idempotency-Key, and X-Expected-Version are required")
		return
	}
	admission, replayed, err := s.service.Approve(r.Context(), r.PathValue("admissionId"), expectedVersion, idempotency, acting, correlation)
	if err != nil {
		writeFieldError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, contract.FieldAdmissionResponse{Admission: toFieldAdmission(admission), IdempotentReplay: replayed})
}

func (s *FieldServer) provisionAdmission(w http.ResponseWriter, r *http.Request) {
	if !s.authorizedService(w, r) {
		return
	}
	acting, correlation, idempotency, _, ok := captainHeaders(w, r, false)
	if !ok || acting == "" || idempotency == "" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "Field role provisioning attribution and Idempotency-Key are required")
		return
	}
	admission, err := s.service.Provision(r.Context(), r.PathValue("admissionId"), idempotency, acting, correlation)
	if err != nil {
		writeFieldError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, contract.FieldAdmissionResponse{Admission: toFieldAdmission(admission), IdempotentReplay: false})
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
	if !authorizedFieldSession(w, r) {
		return
	}
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

func (s *FieldServer) authorizeReenrollment(w http.ResponseWriter, r *http.Request) {
	if !s.authorizedService(w, r) {
		return
	}
	if r.Header.Get("X-Actor-ID") != "" || r.Header.Get("If-Match") != "" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "legacy actor and version headers are forbidden")
		return
	}
	acting := strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID"))
	correlation := strings.TrimSpace(r.Header.Get("X-Correlation-ID"))
	expectedAdmissionVersion, err := strconv.Atoi(strings.TrimSpace(r.Header.Get("X-Expected-Version")))
	if acting == "" || len(acting) > 128 || len(correlation) < 8 || len(correlation) > 128 || err != nil || expectedAdmissionVersion < 1 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "acting actor, correlation ID, and positive admission version are required")
		return
	}
	var input contract.ManagedRoleReenrollmentRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	if err := s.service.AuthorizeReenrollment(r.Context(), r.PathValue("actorId"), acting, correlation, input.Reason, expectedAdmissionVersion, input.ExpectedActorVersion, input.ExpectedRoleVersion); err != nil {
		writeFieldError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *FieldServer) createJoiningCase(w http.ResponseWriter, r *http.Request) {
	if !authorizedFieldSession(w, r) {
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
	var input fieldJoiningCaseDraftRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	if !input.applyDraftScalars() {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "both firstStoreLatitude and firstStoreLongitude must be provided together")
		return
	}
	result, err := s.service.CreateJoiningCaseDraft(r.Context(), bearerToken(r), idempotency, correlation, input.createRequest())
	if err != nil {
		writeFieldError(w, err)
		return
	}
	writeFieldCaseResult(w, responseStatus(result.Replayed), result)
}

func (s *FieldServer) updateJoiningCaseDraft(w http.ResponseWriter, r *http.Request) {
	if !authorizedFieldSession(w, r) {
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
	expectedVersion, err := strconv.Atoi(strings.TrimSpace(r.Header.Get("X-Expected-Version")))
	if err != nil || expectedVersion < 1 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "X-Expected-Version must be a positive integer")
		return
	}
	var input fieldJoiningCaseDraftRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	if !input.applyDraftScalars() {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "both firstStoreLatitude and firstStoreLongitude must be provided together")
		return
	}
	result, err := s.service.UpdateJoiningCaseDraft(r.Context(), bearerToken(r), r.PathValue("caseId"), expectedVersion, idempotency, correlation, input.createRequest(), input.FirstStoreProofNumber == nil)
	if err != nil {
		writeFieldError(w, err)
		return
	}
	writeFieldCaseResult(w, responseStatus(result.Replayed), result)
}

func (s *FieldServer) listJoiningCases(w http.ResponseWriter, r *http.Request) {
	if !authorizedFieldSession(w, r) {
		return
	}
	limit := 25
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil {
			writeFieldError(w, postgres.ErrJoiningCaseInvalidLimit)
			return
		}
		limit = parsed
	}
	result, err := s.service.ListJoiningCases(r.Context(), bearerToken(r), r.URL.Query().Get("q"), limit, r.URL.Query().Get("cursor"))
	if err != nil {
		writeFieldError(w, err)
		return
	}
	items := make([]contract.JoiningCaseSummary, 0, len(result.Cases))
	for _, item := range result.Cases {
		items = append(items, contract.JoiningCaseSummary{ID: item.ID, ContactPhoneE164: item.ContactPhoneE164, BusinessName: item.BusinessName, FirstStoreName: item.FirstStoreName, WalletProviderKey: item.WalletProviderKey, ServiceCityID: item.FirstStoreServiceCityID, FirstStoreVerticalID: item.FirstStoreVerticalID, FirstStoreCommercialTypeID: item.FirstStoreCommercialTypeID, FirstStoreLatitude: nullableFloatValue(item.FirstStoreLatitude), FirstStoreLongitude: nullableFloatValue(item.FirstStoreLongitude), Origin: contract.JoiningCaseOrigin(item.Origin), State: contract.JoiningCaseState(item.State), CorrectionReason: item.CorrectionReason, Version: item.Version, CreatedAt: item.CreatedAt, UpdatedAt: item.UpdatedAt})
	}
	writeJSON(w, http.StatusOK, contract.JoiningCaseListResponse{Cases: items, NextCursor: result.NextCursor})
}

func (s *FieldServer) readJoiningCase(w http.ResponseWriter, r *http.Request) {
	if !authorizedFieldSession(w, r) {
		return
	}
	result, err := s.service.ReadJoiningCase(r.Context(), bearerToken(r), r.PathValue("caseId"))
	if err != nil {
		writeFieldError(w, err)
		return
	}
	writeFieldCaseResult(w, http.StatusOK, result)
}

func (s *FieldServer) submitJoiningCase(w http.ResponseWriter, r *http.Request) {
	if !authorizedFieldSession(w, r) {
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

func (s *FieldServer) uploadJoiningCaseProofImage(w http.ResponseWriter, r *http.Request) {
	if !authorizedFieldSession(w, r) {
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
	expectedVersion, err := strconv.Atoi(strings.TrimSpace(r.Header.Get("X-Expected-Version")))
	if err != nil || expectedVersion < 1 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "X-Expected-Version must be a positive integer")
		return
	}
	data, contentType, ok := readMultipartImageUpload(w, r, "a valid proof image upload is required")
	if !ok {
		return
	}
	result, err := s.service.UploadJoiningCaseProofImage(r.Context(), bearerToken(r), r.PathValue("caseId"), idempotency, correlation, expectedVersion, contentType, data)
	if err != nil {
		writeFieldError(w, err)
		return
	}
	writeFieldCaseResult(w, responseStatus(result.Replayed), result)
}

func (s *FieldServer) authorizedService(w http.ResponseWriter, r *http.Request) bool {
	if s.auth.Authorized(r) {
		return true
	}
	writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "service authentication is required")
	return false
}

func authorizedFieldSession(w http.ResponseWriter, r *http.Request) bool {
	if bearerToken(r) != "" {
		return true
	}
	writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "Field session is required")
	return false
}

func writeFieldCaseResult(w http.ResponseWriter, status int, result postgres.JoiningCaseResult) {
	view := toJoiningCaseView(result.Case)
	view.PartnerActorID = result.Case.PartnerActorID
	view.ReviewedBy = result.Case.ReviewedBy
	view.StoreProfileImage = toStoreProfileImage(result.Case.StoreProfileImage)
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
	return contract.FieldAdmission{ID: value.ID, ActorID: value.ActorID, FullNameAr: value.FullNameAr, ContactPhoneE164: value.PhoneE164, ServiceCityID: value.ServiceCityID, AllServiceCities: value.AllServiceCities, ServiceCityIds: value.ServiceCityIDs, WalletProviderKey: value.WalletProviderKey, State: value.State, RequiresProfileReview: value.RequiresProfileReview, Version: value.Version, CreatedAt: value.CreatedAt, UpdatedAt: value.UpdatedAt}
}

func writeFieldError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, field.ErrInvalidInput), errors.Is(err, joiningcase.ErrInvalidInput):
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "Field input is invalid")
	case errors.Is(err, field.ErrOperatorNotActive), errors.Is(err, field.ErrFieldSessionForbidden):
		writeError(w, http.StatusForbidden, "FORBIDDEN", "the authenticated actor is not permitted for this Field operation")
	case errors.Is(err, postgres.ErrFieldAdmissionNotFound):
		writeError(w, http.StatusNotFound, "NOT_FOUND", "Field admission was not found")
	case errors.Is(err, postgres.ErrServiceCityNotFound):
		writeError(w, http.StatusNotFound, "SERVICE_CITY_NOT_FOUND", "the selected service city was not found")
	case errors.Is(err, postgres.ErrServiceCityInvalid):
		writeError(w, http.StatusBadRequest, "INVALID_SERVICE_CITY", "the selected service city is inactive or invalid")
	case errors.Is(err, postgres.ErrFieldAdmissionExists), errors.Is(err, postgres.ErrFieldAdmissionConflict), errors.Is(err, postgres.ErrFieldAdmissionNotEligible), errors.Is(err, postgres.ErrFieldAdmissionRegistry), errors.Is(err, field.ErrManagedRoleNotEligible), errors.Is(err, postgres.ErrFieldOperationConflict), errors.Is(err, postgres.ErrFieldVersionConflict), errors.Is(err, postgres.ErrJoiningCaseVersion), errors.Is(err, postgres.ErrJoiningCaseState), errors.Is(err, postgres.ErrJoiningCaseActor), errors.Is(err, postgres.ErrJoiningCaseRebind):
		writeError(w, http.StatusConflict, "VERSION_OR_STATE_CONFLICT", "Field or joining-case state is stale or not actionable")
	case errors.Is(err, postgres.ErrJoiningCaseNotFound):
		writeError(w, http.StatusNotFound, "NOT_FOUND", "joining case was not found")
	case errors.Is(err, postgres.ErrJoiningCaseExists):
		writeError(w, http.StatusConflict, "JOINING_CASE_EXISTS", "an active joining case already exists for this phone")
	default:
		var identityErr *identityclient.Error
		if errors.As(err, &identityErr) {
			writeIdentityError(w, err)
			return
		}
		writeJoiningCaseError(w, err)
	}
}
