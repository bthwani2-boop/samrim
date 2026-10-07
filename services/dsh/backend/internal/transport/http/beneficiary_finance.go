package transporthttp

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/auth"
	identityintegration "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/identity"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/wlt"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/walletfacts"
	identityclient "github.com/bthwani2-boop/samrim/services/identity/clients/go"
)

var officialWalletPhoneE164Pattern = walletfacts.PhoneE164Pattern

// BeneficiaryFinanceServer owns the one role-scoped payout surface. The actor
// role selects the authenticated identity; WLT remains the sole amount,
// hold, destination and ledger authority.
type BeneficiaryFinanceServer struct {
	auth     *auth.ServiceToken
	identity *identityintegration.Client
	payment  *wlt.Client
	db       *sql.DB
}

func NewBeneficiaryFinance(identity *identityintegration.Client, accessToken string, payment *wlt.Client, db *sql.DB) (*BeneficiaryFinanceServer, error) {
	authorizer, err := auth.NewServiceToken(strings.TrimSpace(accessToken))
	if err != nil {
		return nil, err
	}
	if identity == nil || payment == nil || db == nil {
		return nil, &identityclient.Error{Status: http.StatusInternalServerError, Code: "CONFIGURATION_ERROR", Message: "beneficiary finance dependencies are required"}
	}
	return &BeneficiaryFinanceServer{auth: authorizer, identity: identity, payment: payment, db: db}, nil
}

func (s *BeneficiaryFinanceServer) Register(mux *http.ServeMux) {
	mux.HandleFunc("POST /dsh/operator/actors/{actorId}/legal-name", s.submitOperatorActorLegalName)
	mux.HandleFunc("GET /dsh/operator/actors/{actorId}/legal-name/pending", s.readOperatorPendingActorLegalName)
	mux.HandleFunc("POST /dsh/operator/actors/{actorId}/legal-name/{version}/verify", s.verifyOperatorActorLegalName)
	mux.HandleFunc("GET /dsh/me/wallet", s.readOwnWallet)
	mux.HandleFunc("POST /dsh/me/funding-intents", s.createOwnFundingIntent)
	mux.HandleFunc("GET /dsh/me/funding-intents/{fundingIntentId}", s.readOwnFundingIntent)
	mux.HandleFunc("POST /dsh/me/funding-intents/{fundingIntentId}/simulate", s.simulateOwnFundingIntent)
	mux.HandleFunc("GET /dsh/me/payout-state", s.readOwnPayoutState)
	mux.HandleFunc("GET /dsh/partners/me/payout-summary", s.readPartnerPayoutSummary)
	mux.HandleFunc("POST /dsh/me/payout-intents", s.createOwnPayoutIntent)
	mux.HandleFunc("POST /dsh/partner/payout-requests", s.createPartnerPayoutRequest)
	mux.HandleFunc("GET /dsh/partner/payout-requests/{partnerActorId}/{requestId}", s.readPartnerPayoutRequest)
	mux.HandleFunc("GET /dsh/partner/payout-requests/{partnerActorId}", s.readPartnerPayoutRequest)
	mux.HandleFunc("GET /dsh/operator/{actorType}/{actorId}/payout-state", s.readOperatorPayoutState)
	mux.HandleFunc("GET /dsh/operator/{actorType}/{actorId}/official-wallet-destination", s.readOperatorDestination)
	mux.HandleFunc("GET /dsh/operator/{actorType}/{actorId}/wallet-provider-intent", s.readOperatorWalletProviderIntent)
	mux.HandleFunc("POST /dsh/operator/{actorType}/{actorId}/official-wallet-destination", s.createOperatorDestination)
	mux.HandleFunc("POST /dsh/operator/{actorType}/{actorId}/official-wallet-destination/{destinationId}/verify", s.verifyOperatorDestination)
	mux.HandleFunc("POST /dsh/operator/{actorType}/{actorId}/official-wallet-destination/{destinationId}/activate", s.activateOperatorDestination)
	s.RegisterSettlementGovernance(mux)
	s.RegisterCustomerWithdrawalGovernance(mux)
}

func (s *BeneficiaryFinanceServer) readOwnWallet(w http.ResponseWriter, r *http.Request) {
	identity, actorType, ok := s.requireFundingSession(w, r)
	if !ok {
		return
	}
	state, err := s.payment.ReadWalletState(r.Context(), actorType, identity.Subject)
	if err != nil {
		writeWLTFinanceError(w, err)
		return
	}
	intents, _, err := s.payment.ListCashInFundingIntents(r.Context(), actorType, identity.Subject, 50)
	if err != nil {
		writeWLTFinanceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"state": state, "fundingIntents": intents})
}

func (s *BeneficiaryFinanceServer) createOwnFundingIntent(w http.ResponseWriter, r *http.Request) {
	identity, actorType, ok := s.requireFundingSession(w, r)
	if !ok {
		return
	}
	correlation, idempotency, ok := requiredBeneficiaryFinanceMutationHeaders(w, r)
	if !ok {
		return
	}
	var input struct {
		AmountMinor int64 `json:"amountMinor"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	intent, simulator, replayed, err := s.payment.CreateCashInFundingIntent(r.Context(), actorType, identity.Subject, input.AmountMinor, idempotency, correlation)
	if err != nil {
		writeWLTFinanceError(w, err)
		return
	}
	status := http.StatusCreated
	if replayed {
		status = http.StatusOK
	}
	writeJSON(w, status, map[string]any{"intent": intent, "simulator": simulator, "idempotentReplay": replayed})
}

func (s *BeneficiaryFinanceServer) readOwnFundingIntent(w http.ResponseWriter, r *http.Request) {
	identity, actorType, ok := s.requireFundingSession(w, r)
	if !ok {
		return
	}
	intent, err := s.payment.ReadCashInFundingIntent(r.Context(), r.PathValue("fundingIntentId"))
	if err != nil {
		writeWLTFinanceError(w, err)
		return
	}
	if intent.ActorType != actorType || intent.ActorID != identity.Subject {
		writeError(w, http.StatusNotFound, "NOT_FOUND", "funding intent was not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"intent": intent})
}

func (s *BeneficiaryFinanceServer) simulateOwnFundingIntent(w http.ResponseWriter, r *http.Request) {
	identity, actorType, ok := s.requireFundingSession(w, r)
	if !ok {
		return
	}
	correlation, idempotency, ok := requiredBeneficiaryFinanceMutationHeaders(w, r)
	if !ok {
		return
	}
	state, err := s.payment.ReadWalletState(r.Context(), actorType, identity.Subject)
	if err != nil {
		writeWLTFinanceError(w, err)
		return
	}
	if !state.Simulator {
		writeError(w, http.StatusNotFound, "NOT_FOUND", "development simulator is not available")
		return
	}
	intentID := strings.TrimSpace(r.PathValue("fundingIntentId"))
	intent, err := s.payment.ReadCashInFundingIntent(r.Context(), intentID)
	if err != nil {
		writeWLTFinanceError(w, err)
		return
	}
	if intent.ActorType != actorType || intent.ActorID != identity.Subject || intent.ProviderKey != "DEVELOPMENT_SIMULATOR" {
		writeError(w, http.StatusNotFound, "NOT_FOUND", "funding intent was not found")
		return
	}
	var input struct {
		Outcome string `json:"outcome"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	updated, replayed, err := s.payment.SimulateCashInFundingOutcome(r.Context(), intentID, input.Outcome, identity.Subject, idempotency, correlation)
	if err != nil {
		writeWLTFinanceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"intent": updated, "simulator": true, "idempotentReplay": replayed})
}

func (s *BeneficiaryFinanceServer) readOwnPayoutState(w http.ResponseWriter, r *http.Request) {
	identity, ok := s.requireBeneficiarySession(w, r)
	if !ok {
		return
	}
	if identity.Role == "partner" {
		writeError(w, 403, "PARTNER_STORE_SCOPE_REQUIRED", "Partner finance requires the Store-scoped finance and payout endpoints")
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
	if identity.Role == "partner" {
		writeError(w, 403, "PARTNER_STORE_SCOPE_REQUIRED", "Partner finance requires the Store-scoped finance and payout endpoints")
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
	identityFacts, err := s.readCurrentOfficialWalletIdentityFacts(r.Context(), identity.Role, identity.Subject, identity.Subject)
	if err != nil {
		writeOfficialWalletIdentityReadError(w, err)
		return
	}
	payout, replayed, err := s.payment.CreatePayoutIntent(r.Context(), identity.Role, identity.Subject, input.AmountMode, input.AmountMinor, identityFacts, idempotency, correlation)
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
	if !s.requirePermission(w, r.Context(), acting, "finance") {
		return
	}
	actorType, actorID := strings.ToLower(strings.TrimSpace(r.PathValue("actorType"))), strings.TrimSpace(r.PathValue("actorId"))
	if (actorType != "partner" && actorType != "captain" && actorType != "field") || actorID == "" || len(actorID) > 128 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "a valid actorType and actorId are required")
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
	if !s.requirePermission(w, r.Context(), strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID")), "finance") {
		return
	}
	actorType, actorID := strings.ToLower(strings.TrimSpace(r.PathValue("actorType"))), strings.TrimSpace(r.PathValue("actorId"))
	if (actorType != "customer" && actorType != "partner" && actorType != "captain" && actorType != "field") || actorID == "" || len(actorID) > 128 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "a valid actorType and actorId are required")
		return
	}
	destination, err := s.payment.ReadOfficialWalletDestination(r.Context(), actorType, actorID)
	if err != nil {
		writeWLTFinanceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"destination": destination})
}

func (s *BeneficiaryFinanceServer) readOperatorWalletProviderIntent(w http.ResponseWriter, r *http.Request) {
	if !s.authorizeAndRequireOperator(w, r) {
		return
	}
	acting := strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID"))
	if !s.requirePermission(w, r.Context(), acting, "finance") {
		return
	}
	actorType := strings.ToLower(strings.TrimSpace(r.PathValue("actorType")))
	actorID := strings.TrimSpace(r.PathValue("actorId"))
	if actorType != "partner" && actorType != "captain" && actorType != "field" || actorID == "" || len(actorID) > 128 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "a valid actorType and actorId are required")
		return
	}
	intent, err := s.readWalletProviderIntent(r.Context(), actorType, actorID)
	if err != nil {
		writeWalletProviderIntentError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{"intent": map[string]string{
		"actorType":   intent.ActorType,
		"actorId":     intent.ActorID,
		"providerKey": intent.ProviderKey,
		"sourceId":    intent.SourceID,
	}})
}

func (s *BeneficiaryFinanceServer) createOperatorDestination(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	acting, correlation, idempotency, ok := requiredMutationHeaders(w, r)
	if !ok || !s.requireOperator(w, r.Context(), acting) {
		return
	}
	if !s.requirePermission(w, r.Context(), acting, "finance") {
		return
	}
	actorType, actorID, ok := payoutActorPath(w, r)
	if !ok {
		return
	}
	var input struct {
		ChangeReason                  string `json:"changeReason"`
		VerificationEvidenceReference string `json:"verificationEvidenceReference"`
		ChangeEvidenceReference       string `json:"changeEvidenceReference"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	identityFacts, err := s.readCurrentOfficialWalletIdentityFacts(r.Context(), actorType, actorID, acting)
	if errors.Is(err, errOfficialWalletIdentityNotVerified) {
		writeError(w, http.StatusConflict, "BENEFICIARY_IDENTITY_NOT_READY", "an active Identity role, verified phone, and verified canonical name are required")
		return
	}
	if err != nil {
		writeIdentityError(w, err)
		return
	}
	intent, err := s.readWalletProviderIntent(r.Context(), actorType, actorID)
	if err != nil {
		writeWalletProviderIntentError(w, err)
		return
	}
	destination, replayed, err := s.payment.CreateOfficialWalletDestination(r.Context(), wlt.OfficialWalletDestination{ActorType: actorType, ActorID: actorID, ProviderKey: intent.ProviderKey}, identityFacts, input.ChangeReason, input.VerificationEvidenceReference, input.ChangeEvidenceReference, idempotency, correlation, acting)
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

func (s *BeneficiaryFinanceServer) readWalletProviderIntent(ctx context.Context, actorType, actorID string) (postgres.WalletProviderIntent, error) {
	intent, err := postgres.ReadWalletProviderIntent(ctx, s.db, actorType, actorID)
	if err == nil || !errors.Is(err, postgres.ErrWalletProviderIntentNotFound) {
		return intent, err
	}
	legacyDestination, legacyErr := s.payment.ReadOfficialWalletDestination(ctx, actorType, actorID)
	if legacyErr != nil {
		var wltErr *wlt.Error
		if errors.As(legacyErr, &wltErr) && wltErr.Status == http.StatusNotFound {
			return postgres.WalletProviderIntent{}, err
		}
		return postgres.WalletProviderIntent{}, fmt.Errorf("read legacy official wallet provider during Finance reverification: %w", legacyErr)
	}
	if intent, ok := legacyWalletProviderIntentFromStaleDestination(actorType, actorID, legacyDestination); ok {
		return intent, nil
	}
	return postgres.WalletProviderIntent{}, err
}

func legacyWalletProviderIntentFromStaleDestination(actorType, actorID string, destination wlt.OfficialWalletDestination) (postgres.WalletProviderIntent, bool) {
	actorType, actorID = strings.ToLower(strings.TrimSpace(actorType)), strings.TrimSpace(actorID)
	provider, validProvider := postgres.NormalizeWalletProviderKey(destination.ProviderKey)
	if !validProvider || actorType == "" || actorID == "" || destination.ActorType != actorType || destination.ActorID != actorID || destination.VerificationStatus != "STALE" || destination.Status != "SUSPENDED" || strings.TrimSpace(destination.ID) == "" {
		return postgres.WalletProviderIntent{}, false
	}
	return postgres.WalletProviderIntent{
		ActorType: actorType, ActorID: actorID, ProviderKey: provider,
		SourceID: "legacy_official_wallet_destination:" + strings.TrimSpace(destination.ID),
	}, true
}

func writeWalletProviderIntentError(w http.ResponseWriter, err error) {
	if errors.Is(err, postgres.ErrWalletProviderIntentNotFound) {
		writeError(w, http.StatusConflict, "WALLET_PROVIDER_INTENT_UNAVAILABLE", "an active beneficiary with a recorded wallet provider intent is required")
		return
	}
	writeStorageError(w, err)
}

func canonicalOfficialWalletPhone(actorType, actorID string, role identityclient.ActorRoleView) (string, bool) {
	return walletfacts.CanonicalPhone(actorType, actorID, role)
}

func canonicalOfficialWalletName(actorID string, legalName identityclient.ActorLegalName) (string, int, bool) {
	return walletfacts.CanonicalName(actorID, legalName)
}

func (s *BeneficiaryFinanceServer) verifyOperatorDestination(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	acting, correlation, idempotency, ok := requiredMutationHeaders(w, r)
	if !ok || !s.requireOperator(w, r.Context(), acting) {
		return
	}
	if !s.requirePermission(w, r.Context(), acting, "finance") {
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
	identityFacts, err := s.readCurrentOfficialWalletIdentityFacts(r.Context(), actorType, actorID, acting)
	if err != nil {
		writeOfficialWalletIdentityReadError(w, err)
		return
	}
	destination, err := s.payment.VerifyOfficialWalletDestination(r.Context(), r.PathValue("destinationId"), input.EvidenceReference, identityFacts, idempotency, correlation, acting)
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
	if !s.requirePermission(w, r.Context(), acting, "finance") {
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
	identityFacts, err := s.readCurrentOfficialWalletIdentityFacts(r.Context(), actorType, actorID, acting)
	if err != nil {
		writeOfficialWalletIdentityReadError(w, err)
		return
	}
	destination, err := s.payment.ActivateOfficialWalletDestination(r.Context(), r.PathValue("destinationId"), identityFacts, idempotency, correlation, acting)
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
	actorID := strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID"))
	return s.requireOperator(w, r.Context(), actorID) && s.requirePermission(w, r.Context(), actorID, "finance")
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
	if operator.Role != "operator" || !operator.Enabled || !operator.SecurityEnabled || operator.ActivatedAt == nil {
		writeError(w, http.StatusForbidden, "FORBIDDEN", "an active control operator session is required")
		return false
	}
	return true
}

func (s *BeneficiaryFinanceServer) requirePermission(w http.ResponseWriter, ctx context.Context, actorID, permission string) bool {
	if err := s.identity.RequireOperatorPermission(ctx, actorID, permission); err != nil {
		writeIdentityError(w, err)
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
	if role == "captain" {
		admissionState, err := postgres.ReadCaptainFinancialAdmissionState(r.Context(), s.db, identity.Subject)
		if err != nil || admissionState != "eligible" {
			writeError(w, http.StatusForbidden, "FORBIDDEN", "an eligible BThwani Captain admission is required for WLT finance")
			return identityclient.ActorIdentity{}, false
		}
	}
	return identity, true
}

func (s *BeneficiaryFinanceServer) requireFundingSession(w http.ResponseWriter, r *http.Request) (identityclient.ActorIdentity, string, bool) {
	token := bearerToken(r)
	if token == "" {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "an authenticated wallet session is required")
		return identityclient.ActorIdentity{}, "", false
	}
	identity, err := s.identity.ReadSession(r.Context(), token)
	if err != nil {
		writeIdentityError(w, err)
		return identityclient.ActorIdentity{}, "", false
	}
	role := strings.ToLower(strings.TrimSpace(identity.Role))
	actorType := "customer"
	if role == "captain" {
		actorType = "captain"
		admissionState, admissionErr := postgres.ReadCaptainFinancialAdmissionState(r.Context(), s.db, identity.Subject)
		if admissionErr != nil || admissionState != "eligible" {
			writeError(w, http.StatusForbidden, "FORBIDDEN", "an eligible BThwani Captain admission is required for WLT Cash-In")
			return identityclient.ActorIdentity{}, "", false
		}
	} else if role != "client" {
		writeError(w, http.StatusForbidden, "FORBIDDEN", "Cash-In is admitted only for Customers and BThwani Captains")
		return identityclient.ActorIdentity{}, "", false
	}
	if strings.TrimSpace(identity.Subject) == "" {
		writeError(w, http.StatusForbidden, "FORBIDDEN", "an active wallet session is required")
		return identityclient.ActorIdentity{}, "", false
	}
	identity.Role = role
	return identity, actorType, true
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
