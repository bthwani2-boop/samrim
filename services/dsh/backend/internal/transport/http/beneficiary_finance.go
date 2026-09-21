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

// BeneficiaryFinanceServer owns the one role-scoped payout surface. The actor
// role selects the authenticated identity; WLT remains the sole amount,
// hold, destination and ledger authority.
type BeneficiaryFinanceServer struct {
	auth     *auth.ServiceToken
	identity *identityintegration.Client
	payment  *wlt.Client
}

func NewBeneficiaryFinance(identity *identityintegration.Client, accessToken string, payment *wlt.Client) (*BeneficiaryFinanceServer, error) {
	authorizer, err := auth.NewServiceToken(strings.TrimSpace(accessToken))
	if err != nil {
		return nil, err
	}
	if identity == nil || payment == nil {
		return nil, &identityclient.Error{Status: http.StatusInternalServerError, Code: "CONFIGURATION_ERROR", Message: "beneficiary finance dependencies are required"}
	}
	return &BeneficiaryFinanceServer{auth: authorizer, identity: identity, payment: payment}, nil
}

func (s *BeneficiaryFinanceServer) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /dsh/me/payout-state", s.readOwnPayoutState)
	mux.HandleFunc("POST /dsh/me/payout-intents", s.createOwnPayoutIntent)
	mux.HandleFunc("GET /dsh/operator/{actorType}/{actorId}/payout-state", s.readOperatorPayoutState)
	mux.HandleFunc("GET /dsh/operator/{actorType}/{actorId}/official-wallet-destination", s.readOperatorDestination)
	mux.HandleFunc("POST /dsh/operator/{actorType}/{actorId}/official-wallet-destination", s.createOperatorDestination)
	mux.HandleFunc("POST /dsh/operator/{actorType}/{actorId}/official-wallet-destination/{destinationId}/verify", s.verifyOperatorDestination)
	mux.HandleFunc("POST /dsh/operator/{actorType}/{actorId}/official-wallet-destination/{destinationId}/activate", s.activateOperatorDestination)
}

func (s *BeneficiaryFinanceServer) readOwnPayoutState(w http.ResponseWriter, r *http.Request) {
	identity, ok := s.requireBeneficiarySession(w, r)
	if !ok {
		return
	}
	state, err := s.payment.ReadPayoutState(r.Context(), identity.Role, identity.Subject)
	if err != nil {
		writeWLTFinanceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"state": state})
}

func (s *BeneficiaryFinanceServer) createOwnPayoutIntent(w http.ResponseWriter, r *http.Request) {
	identity, ok := s.requireBeneficiarySession(w, r)
	if !ok {
		return
	}
	correlation, idempotency, ok := requiredBeneficiaryFinanceMutationHeaders(w, r)
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
	payout, replayed, err := s.payment.CreatePayoutIntent(r.Context(), identity.Role, identity.Subject, input.AmountMode, input.AmountMinor, idempotency, correlation)
	if err != nil {
		writeWLTFinanceError(w, err)
		return
	}
	status := http.StatusCreated
	if replayed {
		status = http.StatusOK
	}
	writeJSON(w, status, map[string]any{"payout": payout, "idempotentReplay": replayed})
}

func (s *BeneficiaryFinanceServer) readOperatorPayoutState(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	acting := strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID"))
	if !s.requireOperator(w, r.Context(), acting) {
		return
	}
	actorType, actorID, ok := payoutActorPath(w, r)
	if !ok {
		return
	}
	state, err := s.payment.ReadPayoutState(r.Context(), actorType, actorID)
	if err != nil {
		writeWLTFinanceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"state": state})
}

func (s *BeneficiaryFinanceServer) readOperatorDestination(w http.ResponseWriter, r *http.Request) {
	if !s.authorizeAndRequireOperator(w, r) {
		return
	}
	actorType, actorID, ok := payoutActorPath(w, r)
	if !ok {
		return
	}
	destination, err := s.payment.ReadOfficialWalletDestination(r.Context(), actorType, actorID)
	if err != nil {
		writeWLTFinanceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"destination": destination})
}

func (s *BeneficiaryFinanceServer) createOperatorDestination(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	acting, correlation, idempotency, ok := requiredMutationHeaders(w, r)
	if !ok || !s.requireOperator(w, r.Context(), acting) {
		return
	}
	actorType, actorID, ok := payoutActorPath(w, r)
	if !ok {
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
	destination, replayed, err := s.payment.CreateOfficialWalletDestination(r.Context(), wlt.OfficialWalletDestination{ActorType: actorType, ActorID: actorID, ProviderKey: input.ProviderKey, BeneficiaryName: input.BeneficiaryName}, input.WalletIdentifier, input.ChangeReason, input.VerificationEvidenceReference, input.ChangeEvidenceReference, idempotency, correlation, acting)
	if err != nil {
		writeWLTFinanceError(w, err)
		return
	}
	status := http.StatusCreated
	if replayed {
		status = http.StatusOK
	}
	writeJSON(w, status, map[string]any{"destination": destination, "idempotentReplay": replayed})
}

func (s *BeneficiaryFinanceServer) verifyOperatorDestination(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	acting, correlation, idempotency, ok := requiredMutationHeaders(w, r)
	if !ok || !s.requireOperator(w, r.Context(), acting) {
		return
	}
	actorType, actorID, ok := payoutActorPath(w, r)
	if !ok || !s.destinationBelongsToActor(w, r, actorType, actorID) {
		return
	}
	var input struct {
		EvidenceReference string `json:"evidenceReference"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	destination, err := s.payment.VerifyOfficialWalletDestination(r.Context(), r.PathValue("destinationId"), input.EvidenceReference, idempotency, correlation, acting)
	if err != nil {
		writeWLTFinanceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"destination": destination})
}

func (s *BeneficiaryFinanceServer) activateOperatorDestination(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	acting, correlation, idempotency, ok := requiredMutationHeaders(w, r)
	if !ok || !s.requireOperator(w, r.Context(), acting) {
		return
	}
	actorType, actorID, ok := payoutActorPath(w, r)
	if !ok || !s.destinationBelongsToActor(w, r, actorType, actorID) {
		return
	}
	var input struct{}
	if !decodeJSON(w, r, &input) {
		return
	}
	destination, err := s.payment.ActivateOfficialWalletDestination(r.Context(), r.PathValue("destinationId"), idempotency, correlation, acting)
	if err != nil {
		writeWLTFinanceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"destination": destination})
}

func (s *BeneficiaryFinanceServer) authorizeAndRequireOperator(w http.ResponseWriter, r *http.Request) bool {
	if !s.authorize(w, r) {
		return false
	}
	return s.requireOperator(w, r.Context(), strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID")))
}

func (s *BeneficiaryFinanceServer) authorize(w http.ResponseWriter, r *http.Request) bool {
	if s.auth.Authorized(r) {
		return true
	}
	writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "service authentication is required")
	return false
}

func (s *BeneficiaryFinanceServer) requireOperator(w http.ResponseWriter, ctx context.Context, actorID string) bool {
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

func (s *BeneficiaryFinanceServer) requireBeneficiarySession(w http.ResponseWriter, r *http.Request) (identityclient.ActorIdentity, bool) {
	token := bearerToken(r)
	if token == "" {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "an authenticated beneficiary session is required")
		return identityclient.ActorIdentity{}, false
	}
	identity, err := s.identity.ReadSession(r.Context(), token)
	if err != nil {
		writeIdentityError(w, err)
		return identityclient.ActorIdentity{}, false
	}
	role := strings.ToLower(strings.TrimSpace(identity.Role))
	if (role != "partner" && role != "captain" && role != "field") || strings.TrimSpace(identity.Subject) == "" {
		writeError(w, http.StatusForbidden, "FORBIDDEN", "an active beneficiary session is required")
		return identityclient.ActorIdentity{}, false
	}
	identity.Role = role
	return identity, true
}

func requiredBeneficiaryFinanceMutationHeaders(w http.ResponseWriter, r *http.Request) (string, string, bool) {
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

func payoutActorPath(w http.ResponseWriter, r *http.Request) (string, string, bool) {
	actorType := strings.ToLower(strings.TrimSpace(r.PathValue("actorType")))
	actorID := strings.TrimSpace(r.PathValue("actorId"))
	if (actorType != "partner" && actorType != "captain" && actorType != "field") || actorID == "" || len(actorID) > 128 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "a valid actorType and actorId are required")
		return "", "", false
	}
	return actorType, actorID, true
}

func (s *BeneficiaryFinanceServer) destinationBelongsToActor(w http.ResponseWriter, r *http.Request, actorType, actorID string) bool {
	destination, err := s.payment.ReadOfficialWalletDestination(r.Context(), actorType, actorID)
	if err != nil {
		writeWLTFinanceError(w, err)
		return false
	}
	if destination.ID != strings.TrimSpace(r.PathValue("destinationId")) || destination.ActorType != actorType || destination.ActorID != actorID {
		writeError(w, http.StatusConflict, "DESTINATION_OWNER_MISMATCH", "destination does not belong to the requested actor")
		return false
	}
	return true
}
