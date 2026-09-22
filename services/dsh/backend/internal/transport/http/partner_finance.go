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

type PartnerFinanceServer struct {
	auth     *auth.ServiceToken
	identity *identityintegration.Client
	payment  *wlt.Client
}

func NewPartnerFinance(identity *identityintegration.Client, accessToken string, payment *wlt.Client) (*PartnerFinanceServer, error) {
	authorizer, err := auth.NewServiceToken(strings.TrimSpace(accessToken))
	if err != nil {
		return nil, err
	}
	if identity == nil || payment == nil {
		return nil, &identityclient.Error{Status: http.StatusInternalServerError, Code: "CONFIGURATION_ERROR", Message: "partner finance dependencies are required"}
	}
	return &PartnerFinanceServer{auth: authorizer, identity: identity, payment: payment}, nil
}

func (s *PartnerFinanceServer) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /dsh/partners/me/financial-summary", s.readOwnSummary)
	mux.HandleFunc("GET /dsh/operator/partners/{partnerActorId}/financial-summary", s.readOperatorSummary)
}

func (s *PartnerFinanceServer) readOwnSummary(w http.ResponseWriter, r *http.Request) {
	token := bearerToken(r)
	if token == "" {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "partner session is required")
		return
	}
	identity, err := s.identity.ReadSession(r.Context(), token)
	if err != nil {
		writeIdentityError(w, err)
		return
	}
	if identity.Role != "partner" || strings.TrimSpace(identity.Subject) == "" {
		writeError(w, http.StatusForbidden, "FORBIDDEN", "an active app-partner session is required")
		return
	}
	summary, err := s.payment.ReadPartnerFinancialSummary(r.Context(), identity.Subject)
	if err != nil {
		writeWLTFinanceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"summary": summary})
}

func (s *PartnerFinanceServer) readOperatorSummary(w http.ResponseWriter, r *http.Request) {
	if !s.authorizeOperator(w, r) {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "service authentication is required")
		return
	}
	acting := strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID"))
	if !s.requireOperator(w, r.Context(), acting) {
		return
	}
	partnerActorID := strings.TrimSpace(r.PathValue("partnerActorId"))
	if partnerActorID == "" || len(partnerActorID) > 128 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "partnerActorId is required")
		return
	}
	summary, err := s.payment.ReadPartnerFinancialSummary(r.Context(), partnerActorID)
	if err != nil {
		writeWLTFinanceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"summary": summary})
}

func (s *PartnerFinanceServer) authorizeOperator(w http.ResponseWriter, r *http.Request) bool {
	if s.auth.Authorized(r) {
		return true
	}
	return false
}

func (s *PartnerFinanceServer) requireOperator(w http.ResponseWriter, ctx context.Context, actorID string) bool {
	if actorID == "" || len(actorID) > 128 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "X-Acting-Actor-ID is required")
		return false
	}
	operator, err := s.identity.ReadActorRole(ctx, actorID, "operator")
	if err != nil {
		writeIdentityError(w, err)
		return false
	}
	if !operator.Enabled || !operator.SecurityEnabled || operator.ActivatedAt == nil {
		writeError(w, http.StatusForbidden, "FORBIDDEN", "an active control operator session is required")
		return false
	}
	return true
}

func writeWLTFinanceError(w http.ResponseWriter, err error) {
	if wltErr, ok := err.(*wlt.Error); ok {
		status := wltErr.Status
		if status < 400 || status > 599 {
			status = http.StatusBadGateway
		}
		writeError(w, status, wltErr.Code, wltErr.Message)
		return
	}
	writeError(w, http.StatusBadGateway, "WLT_STORAGE_UNAVAILABLE", "WLT financial summary is unavailable")
}
