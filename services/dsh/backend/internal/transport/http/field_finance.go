package transporthttp

import (
	"context"
	"net/http"
	"strings"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/auth"
	identityintegration "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/identity"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/wlt"
	identityclient "github.com/bthwani2-boop/samrim/services/identity/clients/go"
)

type FieldFinanceServer struct {
	auth     *auth.ServiceToken
	identity *identityintegration.Client
	payment  *wlt.Client
}

func NewFieldFinance(identity *identityintegration.Client, accessToken string, payment *wlt.Client) (*FieldFinanceServer, error) {
	authorizer, err := auth.NewServiceToken(strings.TrimSpace(accessToken))
	if err != nil {
		return nil, err
	}
	if identity == nil || payment == nil {
		return nil, &identityclient.Error{Status: http.StatusInternalServerError, Code: "CONFIGURATION_ERROR", Message: "Field finance dependencies are required"}
	}
	return &FieldFinanceServer{auth: authorizer, identity: identity, payment: payment}, nil
}

func (s *FieldFinanceServer) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /dsh/fields/me/financial-summary", s.readOwnSummary)
	mux.HandleFunc("GET /dsh/operator/fields/{fieldActorId}/financial-summary", s.readOperatorSummary)
	mux.HandleFunc("POST /dsh/operator/field-commission-policies", s.createPolicy)
	mux.HandleFunc("GET /dsh/operator/field-commission-policies", s.readPolicyByScope)
	mux.HandleFunc("GET /dsh/operator/field-commission-policies/{policyId}", s.readPolicy)
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
	policy, replayed, err := s.payment.CreateFieldCommissionPolicy(r.Context(), input.ScopeType, input.ScopeID, input.RewardMinor, input.RoundingUnitMinor, input.ExpectedVersion, input.Reason, idempotency, correlation, acting)
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
	policy, err := s.payment.ReadFieldCommissionPolicyByScope(r.Context(), r.URL.Query().Get("scopeType"), r.URL.Query().Get("scopeId"))
	if err != nil {
		writeWLTFinanceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"policy": policy})
}

func (s *FieldFinanceServer) readPolicy(w http.ResponseWriter, r *http.Request) {
	if !s.authorizeOperator(w, r) {
		return
	}
	acting := strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID"))
	if !s.requireOperator(w, r.Context(), acting) {
		return
	}
	policy, err := s.payment.ReadFieldCommissionPolicy(r.Context(), r.PathValue("policyId"))
	if err != nil {
		writeWLTFinanceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"policy": policy})
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

func (s *FieldFinanceServer) requirePlatformPolicyPermission(w http.ResponseWriter, ctx context.Context, actorID string) bool {
	permission, err := s.identity.ReadOperatorPermission(ctx, actorID, "platform_policies")
	if err != nil {
		writeIdentityError(w, err)
		return false
	}
	if !permission.Enabled {
		writeError(w, http.StatusForbidden, "FORBIDDEN", "Platform Policies permission is required")
		return false
	}
	return true
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
