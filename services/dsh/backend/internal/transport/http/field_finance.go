package transporthttp

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/auth"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/contract"
	identityintegration "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/identity"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/wlt"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	identityclient "github.com/bthwani2-boop/samrim/services/identity/clients/go"
)

type FieldFinanceServer struct {
	auth     *auth.ServiceToken
	identity *identityintegration.Client
	payment  *wlt.Client
	db       *sql.DB
}

type fieldAcquisitionEntitlementView struct {
	wlt.FieldAcquisitionEntitlement
	StoreName string `json:"storeName"`
}

type fieldAcquisitionEntitlementPageView struct {
	Entitlements []fieldAcquisitionEntitlementView `json:"entitlements"`
	NextCursor   string                            `json:"nextCursor,omitempty"`
}

func NewFieldFinance(identity *identityintegration.Client, accessToken string, payment *wlt.Client, db *sql.DB) (*FieldFinanceServer, error) {
	authorizer, err := auth.NewServiceToken(strings.TrimSpace(accessToken))
	if err != nil {
		return nil, err
	}
	if identity == nil || payment == nil || db == nil {
		return nil, &identityclient.Error{Status: http.StatusInternalServerError, Code: "CONFIGURATION_ERROR", Message: "Field finance dependencies are required"}
	}
	return &FieldFinanceServer{auth: authorizer, identity: identity, payment: payment, db: db}, nil
}

func (s *FieldFinanceServer) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /dsh/fields/me/financial-summary", s.readOwnSummary)
	mux.HandleFunc("GET /dsh/fields/me/acquisition-entitlements", s.listOwnAcquisitionEntitlements)
	mux.HandleFunc("GET /dsh/operator/fields/{fieldActorId}/acquisition-cases", s.listOperatorAcquisitionCases)
	mux.HandleFunc("GET /dsh/operator/fields/{fieldActorId}/financial-summary", s.readOperatorSummary)
	mux.HandleFunc("POST /dsh/operator/field-acquisition-reward-policies", s.createPolicy)
	mux.HandleFunc("GET /dsh/operator/field-acquisition-reward-policies", s.readPolicyByScope)
}

func (s *FieldFinanceServer) listOperatorAcquisitionCases(w http.ResponseWriter, r *http.Request) {
	if !s.authorizeOperator(w, r) {
		return
	}
	acting := strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID"))
	if !s.requireOperator(w, r.Context(), acting) {
		return
	}
	if !s.requirePermission(w, r.Context(), acting, "partners") {
		return
	}
	fieldActorID := strings.TrimSpace(r.PathValue("fieldActorId"))
	if fieldActorID == "" || len(fieldActorID) > 128 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "fieldActorId is required")
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
	cursor := r.URL.Query().Get("cursor")
	if len(cursor) > 512 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "field acquisition case cursor is invalid")
		return
	}
	page, err := postgres.ListJoiningCasesForField(r.Context(), s.db, fieldActorID, r.URL.Query().Get("q"), limit, cursor)
	if err != nil {
		if errors.Is(err, postgres.ErrJoiningCaseInvalidLimit) || errors.Is(err, postgres.ErrJoiningCaseInvalidSearch) || errors.Is(err, postgres.ErrJoiningCaseInvalidCursor) {
			writeError(w, http.StatusBadRequest, "INVALID_INPUT", "field acquisition case query is invalid")
		} else {
			writeError(w, http.StatusBadGateway, "FIELD_ACQUISITION_READ_UNAVAILABLE", "field acquisition cases could not be read")
		}
		return
	}
	items := make([]contract.JoiningCaseSummary, 0, len(page.Cases))
	for _, item := range page.Cases {
		items = append(items, contract.JoiningCaseSummary{ID: item.ID, ContactPhoneE164: item.ContactPhoneE164, BusinessName: item.BusinessName, FirstStoreName: item.FirstStoreName, ServiceCityID: item.FirstStoreServiceCityID, FirstStoreVerticalID: item.FirstStoreVerticalID, FirstStoreCommercialTypeID: item.FirstStoreCommercialTypeID, FirstStoreLatitude: nullableFloatValue(item.FirstStoreLatitude), FirstStoreLongitude: nullableFloatValue(item.FirstStoreLongitude), Origin: contract.JoiningCaseOrigin(item.Origin), PartnerActorID: item.PartnerActorID, State: contract.JoiningCaseState(item.State), CorrectionReason: item.CorrectionReason, ReviewedBy: item.ReviewedBy, Version: item.Version, CreatedAt: item.CreatedAt, UpdatedAt: item.UpdatedAt})
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, contract.JoiningCaseListResponse{Cases: items, NextCursor: page.NextCursor})
}

func (s *FieldFinanceServer) listOwnAcquisitionEntitlements(w http.ResponseWriter, r *http.Request) {
	identity, ok := s.requireFieldSession(w, r)
	if !ok {
		return
	}
	limit := 50
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 || parsed > 100 {
			writeError(w, http.StatusBadRequest, "INVALID_INPUT", "limit must be between 1 and 100")
			return
		}
		limit = parsed
	}
	page, err := s.payment.ListFieldAcquisitionEntitlements(r.Context(), identity.Subject, r.URL.Query().Get("cursor"), limit)
	if err != nil {
		writeWLTFinanceError(w, err)
		return
	}
	view := fieldAcquisitionEntitlementPageView{Entitlements: make([]fieldAcquisitionEntitlementView, 0, len(page.Entitlements)), NextCursor: page.NextCursor}
	for _, item := range page.Entitlements {
		var storeName string
		if err := s.db.QueryRowContext(r.Context(), `SELECT name FROM dsh.stores WHERE id=$1`, item.StoreID).Scan(&storeName); err != nil {
			writeError(w, http.StatusBadGateway, "FINANCIAL_SOURCE_UNAVAILABLE", "the store for a field acquisition entitlement could not be read")
			return
		}
		view.Entitlements = append(view.Entitlements, fieldAcquisitionEntitlementView{FieldAcquisitionEntitlement: item, StoreName: storeName})
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, view)
}

func (s *FieldFinanceServer) readOwnSummary(w http.ResponseWriter, r *http.Request) {
	identity, ok := s.requireFieldSession(w, r)
	if !ok {
		return
	}
	summary, err := s.payment.ReadFieldFinancialSummary(r.Context(), identity.Subject)
	if err != nil {
		writeWLTFinanceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"summary": summary})
}

func (s *FieldFinanceServer) readOperatorSummary(w http.ResponseWriter, r *http.Request) {
	if !s.authorizeOperator(w, r) {
		return
	}
	acting := strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID"))
	if !s.requireOperator(w, r.Context(), acting) {
		return
	}
	if !s.requirePermission(w, r.Context(), acting, "finance") {
		return
	}
	fieldActorID := strings.TrimSpace(r.PathValue("fieldActorId"))
	if fieldActorID == "" || len(fieldActorID) > 128 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "fieldActorId is required")
		return
	}
	summary, err := s.payment.ReadFieldFinancialSummary(r.Context(), fieldActorID)
	if err != nil {
		writeWLTFinanceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"summary": summary})
}

func (s *FieldFinanceServer) createPolicy(w http.ResponseWriter, r *http.Request) {
	if !s.authorizeOperator(w, r) {
		return
	}
	acting, correlation, idempotency, ok := requiredMutationHeaders(w, r)
	if !ok || !s.requireOperator(w, r.Context(), acting) {
		return
	}
	if !s.requirePlatformPolicyPermission(w, r.Context(), acting) {
		return
	}
	var input struct {
		ScopeType         string `json:"scopeType"`
		ScopeID           string `json:"scopeId"`
		RewardMinor       int64  `json:"rewardMinor"`
		RoundingUnitMinor int64  `json:"roundingUnitMinor"`
		ExpectedVersion   int    `json:"expectedVersion"`
		Reason            string `json:"reason"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	if strings.TrimSpace(input.ScopeType) != "STORE_TYPE" || strings.TrimSpace(input.ScopeID) == "" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "a commercial store type policy is required")
		return
	}
	if !s.requireActiveCommercialStoreType(w, r, input.ScopeID) {
		return
	}
	policy, replayed, err := s.payment.CreateFieldAcquisitionRewardPolicy(r.Context(), input.ScopeType, input.ScopeID, input.RewardMinor, input.RoundingUnitMinor, input.ExpectedVersion, input.Reason, idempotency, correlation, acting)
	if err != nil {
		writeWLTFinanceError(w, err)
		return
	}
	status := http.StatusCreated
	if replayed {
		status = http.StatusOK
	}
	writeJSON(w, status, map[string]any{"policy": policy, "idempotentReplay": replayed})
}

func (s *FieldFinanceServer) readPolicyByScope(w http.ResponseWriter, r *http.Request) {
	if !s.authorizeOperator(w, r) {
		return
	}
	acting := strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID"))
	if !s.requireOperator(w, r.Context(), acting) {
		return
	}
	if !s.requirePermission(w, r.Context(), acting, "platform_policies") {
		return
	}
	scopeType, scopeID := strings.TrimSpace(r.URL.Query().Get("scopeType")), strings.TrimSpace(r.URL.Query().Get("scopeId"))
	if scopeType != "STORE_TYPE" || scopeID == "" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "a commercial store type policy is required")
		return
	}
	if !s.requireActiveCommercialStoreType(w, r, scopeID) {
		return
	}
	policy, err := s.payment.ReadFieldAcquisitionRewardPolicyByScope(r.Context(), scopeType, scopeID)
	if err != nil {
		writeWLTFinanceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"policy": policy})
}

func (s *FieldFinanceServer) requireActiveCommercialStoreType(w http.ResponseWriter, r *http.Request, typeID string) bool {
	item, err := postgres.ReadCommercialStoreType(r.Context(), s.db, typeID)
	if errors.Is(err, postgres.ErrCommercialStoreTypeNotFound) {
		writeError(w, http.StatusNotFound, "COMMERCIAL_STORE_TYPE_NOT_FOUND", "the commercial store type was not found")
		return false
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "COMMERCIAL_STORE_TYPE_READ_FAILED", "the commercial store type could not be verified")
		return false
	}
	if !item.Active {
		writeError(w, http.StatusBadRequest, "COMMERCIAL_STORE_TYPE_INACTIVE", "a reward policy can only be changed for an active commercial store type")
		return false
	}
	vertical, err := postgres.ReadCommerceVertical(r.Context(), s.db, item.VerticalID)
	if err != nil || !vertical.Active {
		writeError(w, http.StatusBadRequest, "COMMERCIAL_STORE_TYPE_VERTICAL_INACTIVE", "a reward policy requires an active parent vertical")
		return false
	}
	return true
}

func (s *FieldFinanceServer) authorizeOperator(w http.ResponseWriter, r *http.Request) bool {
	if s.auth.Authorized(r) {
		return true
	}
	writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "service authentication is required")
	return false
}

func (s *FieldFinanceServer) requireOperator(w http.ResponseWriter, ctx context.Context, actorID string) bool {
	if actorID == "" || len(actorID) > 128 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "X-Acting-Actor-ID is required")
		return false
	}
	operator, err := s.identity.ReadActorRole(ctx, actorID, "operator")
	if err != nil {
		writeIdentityError(w, err)
		return false
	}
	if operator.Role != "operator" || !operator.Enabled || !operator.SecurityEnabled || operator.ActivatedAt == nil {
		writeError(w, http.StatusForbidden, "FORBIDDEN", "an active control operator session is required")
		return false
	}
	return true
}

func (s *FieldFinanceServer) requirePermission(w http.ResponseWriter, ctx context.Context, actorID, permission string) bool {
	if err := s.identity.RequireOperatorPermission(ctx, actorID, permission); err != nil {
		writeIdentityError(w, err)
		return false
	}
	return true
}

func (s *FieldFinanceServer) requirePlatformPolicyPermission(w http.ResponseWriter, ctx context.Context, actorID string) bool {
	return s.requirePermission(w, ctx, actorID, "platform_policies")
}

func (s *FieldFinanceServer) requireFieldSession(w http.ResponseWriter, r *http.Request) (identityclient.ActorIdentity, bool) {
	token := bearerToken(r)
	if token == "" {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "Field session is required")
		return identityclient.ActorIdentity{}, false
	}
	identity, err := s.identity.ReadSession(r.Context(), token)
	if err != nil {
		writeIdentityError(w, err)
		return identityclient.ActorIdentity{}, false
	}
	if identity.Role != "field" || strings.TrimSpace(identity.Subject) == "" {
		writeError(w, http.StatusForbidden, "FORBIDDEN", "an active تطبيق الميداني session is required")
		return identityclient.ActorIdentity{}, false
	}
	return identity, true
}
