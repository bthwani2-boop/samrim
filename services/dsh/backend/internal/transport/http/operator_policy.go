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

type OperatorPolicyServer struct {
	auth     *auth.ServiceToken
	identity *identityintegration.Client
	payment  *wlt.Client
	db       *sql.DB
}

func NewOperatorPolicy(identity *identityintegration.Client, accessToken string, payment *wlt.Client, db *sql.DB) (*OperatorPolicyServer, error) {
	authorizer, err := auth.NewServiceToken(strings.TrimSpace(accessToken))
	if err != nil {
		return nil, err
	}
	if identity == nil || payment == nil || db == nil {
		return nil, &identityclient.Error{Status: http.StatusInternalServerError, Code: "CONFIGURATION_ERROR", Message: "operator policy dependencies are required"}
	}
	return &OperatorPolicyServer{auth: authorizer, identity: identity, payment: payment, db: db}, nil
}

func (s *OperatorPolicyServer) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /dsh/operator/policy-history", s.readPolicyHistory)
	mux.HandleFunc("GET /dsh/operator/policy-registry", s.readOperatorPolicyRegistry)
}

func (s *OperatorPolicyServer) authorizeOperator(w http.ResponseWriter, r *http.Request) bool {
	if s.auth.Authorized(r) {
		return true
	}
	writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "service authentication is required")
	return false
}

func (s *OperatorPolicyServer) requireOperator(w http.ResponseWriter, ctx context.Context, actorID string) bool {
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

func (s *OperatorPolicyServer) requirePermission(w http.ResponseWriter, ctx context.Context, actorID, permission string) bool {
	if err := s.identity.RequireOperatorPermission(ctx, actorID, permission); err != nil {
		writeIdentityError(w, err)
		return false
	}
	return true
}

func (s *OperatorPolicyServer) requirePlatformPolicyPermission(w http.ResponseWriter, ctx context.Context, actorID string) bool {
	return s.requirePermission(w, ctx, actorID, "platform_policies")
}
