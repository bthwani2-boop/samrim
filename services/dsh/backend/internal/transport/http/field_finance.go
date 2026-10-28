package transporthttp

import (
	"context"
	"database/sql"
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
	db       *sql.DB
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
	mux.HandleFunc("GET /dsh/operator/fields/{fieldActorId}/financial-summary", s.readOperatorSummary)
	mux.HandleFunc("GET /dsh/operator/policy-history", s.readPolicyHistory)
	mux.HandleFunc("GET /dsh/operator/policy-registry", s.readOperatorPolicyRegistry)
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
