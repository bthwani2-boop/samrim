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
	mux.HandleFunc("GET /dsh/operator/partners/{partnerActorId}/payout-state", s.readOperatorPayoutState)
	mux.HandleFunc("GET /dsh/partners/me/payout-state", s.readOwnPayoutState)
	mux.HandleFunc("POST /dsh/partners/me/payout-intents", s.createOwnPayoutIntent)
	mux.HandleFunc("GET /dsh/operator/partners/{partnerActorId}/official-wallet-destination", s.readOperatorDestination)
	mux.HandleFunc("POST /dsh/operator/partners/{partnerActorId}/official-wallet-destination", s.createOperatorDestination)
	mux.HandleFunc("POST /dsh/operator/partners/{partnerActorId}/official-wallet-destination/{destinationId}/verify", s.verifyOperatorDestination)
	mux.HandleFunc("POST /dsh/operator/partners/{partnerActorId}/official-wallet-destination/{destinationId}/activate", s.activateOperatorDestination)
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
		writeWLTPartnerFinanceError(w, err)
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
		writeWLTPartnerFinanceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"summary": summary})
}

func (s *PartnerFinanceServer) readOwnPayoutState(w http.ResponseWriter, r *http.Request) {
	identity, ok := s.requirePartnerSession(w, r)
	if !ok {
		return
	}
	state, err := s.payment.ReadPartnerPayoutState(r.Context(), identity.Subject)
	if err != nil {
		writeWLTPartnerFinanceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"state": state})
}

func (s *PartnerFinanceServer) readOperatorPayoutState(w http.ResponseWriter, r *http.Request) {
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
	state, err := s.payment.ReadPartnerPayoutState(r.Context(), partnerActorID)
	if err != nil {
		writeWLTPartnerFinanceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"state": state})
}

func (s *PartnerFinanceServer) createOwnPayoutIntent(w http.ResponseWriter, r *http.Request) {
	identity, ok := s.requirePartnerSession(w, r)
	if !ok {
		return
	}
	correlation, idempotency, ok := requiredPartnerFinanceMutationHeaders(w, r)
	if !ok {
		return
	}
	var input struct {
		AmountMode  string `json:"amountMode"`
		AmountMinor *int64 `json:"amountMinor"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	payout, replayed, err := s.payment.CreatePayoutIntent(r.Context(), "partner", identity.Subject, input.AmountMode, input.AmountMinor, idempotency, correlation)
	if err != nil {
		writeWLTPartnerFinanceError(w, err)
		return
	}
	status := http.StatusCreated
	if replayed {
		status = http.StatusOK
	}
	writeJSON(w, status, map[string]any{"payout": payout, "idempotentReplay": replayed})
}

func (s *PartnerFinanceServer) readOperatorDestination(w http.ResponseWriter, r *http.Request) {
	if !s.authorizeOperator(w, r) {
		return
	}
	acting := strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID"))
	if !s.requireOperator(w, r.Context(), acting) {
		return
	}
	destination, err := s.payment.ReadOfficialWalletDestination(r.Context(), "partner", r.PathValue("partnerActorId"))
	if err != nil {
		writeWLTPartnerFinanceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"destination": destination})
}

func (s *PartnerFinanceServer) createOperatorDestination(w http.ResponseWriter, r *http.Request) {
	if !s.authorizeOperator(w, r) {
		return
	}
	acting, correlation, idempotency, ok := requiredMutationHeaders(w, r)
	if !ok || !s.requireOperator(w, r.Context(), acting) {
		return
	}
	var input struct {
		ProviderKey                   string `json:"providerKey"`
		WalletIdentifier              string `json:"walletIdentifier"`
		BeneficiaryName               string `json:"beneficiaryName"`
		ChangeReason                  string `json:"changeReason"`
		VerificationEvidenceReference string `json:"verificationEvidenceReference"`
		ChangeEvidenceReference       string `json:"changeEvidenceReference"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	destination, replayed, err := s.payment.CreateOfficialWalletDestination(r.Context(), wlt.OfficialWalletDestination{ActorType: "partner", ActorID: strings.TrimSpace(r.PathValue("partnerActorId")), ProviderKey: input.ProviderKey, BeneficiaryName: input.BeneficiaryName}, input.WalletIdentifier, input.ChangeReason, input.VerificationEvidenceReference, input.ChangeEvidenceReference, idempotency, correlation, acting)
	if err != nil {
		writeWLTPartnerFinanceError(w, err)
		return
	}
	status := http.StatusCreated
	if replayed {
		status = http.StatusOK
	}
	writeJSON(w, status, map[string]any{"destination": destination, "idempotentReplay": replayed})
}

func (s *PartnerFinanceServer) verifyOperatorDestination(w http.ResponseWriter, r *http.Request) {
	if !s.authorizeOperator(w, r) {
		return
	}
	acting, correlation, idempotency, ok := requiredMutationHeaders(w, r)
	if !ok || !s.requireOperator(w, r.Context(), acting) {
		return
	}
	var input struct {
		EvidenceReference string `json:"evidenceReference"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	if !s.destinationBelongsToPartner(w, r) {
		return
	}
	destination, err := s.payment.VerifyOfficialWalletDestination(r.Context(), r.PathValue("destinationId"), input.EvidenceReference, idempotency, correlation, acting)
	if err != nil {
		writeWLTPartnerFinanceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"destination": destination})
}

func (s *PartnerFinanceServer) activateOperatorDestination(w http.ResponseWriter, r *http.Request) {
	if !s.authorizeOperator(w, r) {
		return
	}
	acting, correlation, idempotency, ok := requiredMutationHeaders(w, r)
	if !ok || !s.requireOperator(w, r.Context(), acting) {
		return
	}
	if !s.destinationBelongsToPartner(w, r) {
		return
	}
	var input struct{}
	if !decodeJSON(w, r, &input) {
		return
	}
	destination, err := s.payment.ActivateOfficialWalletDestination(r.Context(), r.PathValue("destinationId"), idempotency, correlation, acting)
	if err != nil {
		writeWLTPartnerFinanceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"destination": destination})
}

func (s *PartnerFinanceServer) destinationBelongsToPartner(w http.ResponseWriter, r *http.Request) bool {
	destination, err := s.payment.ReadOfficialWalletDestination(r.Context(), "partner", r.PathValue("partnerActorId"))
	if err != nil {
		writeWLTPartnerFinanceError(w, err)
		return false
	}
	if destination.ID != strings.TrimSpace(r.PathValue("destinationId")) {
		writeError(w, http.StatusConflict, "DESTINATION_OWNER_MISMATCH", "destination does not belong to the requested partner")
		return false
	}
	return true
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

func (s *PartnerFinanceServer) requirePartnerSession(w http.ResponseWriter, r *http.Request) (identityclient.ActorIdentity, bool) {
	token := bearerToken(r)
	if token == "" {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "partner session is required")
		return identityclient.ActorIdentity{}, false
	}
	identity, err := s.identity.ReadSession(r.Context(), token)
	if err != nil {
		writeIdentityError(w, err)
		return identityclient.ActorIdentity{}, false
	}
	if identity.Role != "partner" || strings.TrimSpace(identity.Subject) == "" {
		writeError(w, http.StatusForbidden, "FORBIDDEN", "an active app-partner session is required")
		return identityclient.ActorIdentity{}, false
	}
	return identity, true
}

func requiredPartnerFinanceMutationHeaders(w http.ResponseWriter, r *http.Request) (string, string, bool) {
	if r.Header.Get("X-Actor-ID") != "" || r.Header.Get("X-Acting-Actor-ID") != "" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "client actor authority headers are forbidden")
		return "", "", false
	}
	correlation := strings.TrimSpace(r.Header.Get("X-Correlation-ID"))
	idempotency := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	if len(correlation) < 8 || len(correlation) > 128 || len(idempotency) < 8 || len(idempotency) > 128 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "X-Correlation-ID and Idempotency-Key are required")
		return "", "", false
	}
	return correlation, idempotency, true
}

func writeWLTPartnerFinanceError(w http.ResponseWriter, err error) {
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
