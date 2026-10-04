package transporthttp

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/wlt"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/joiningcase"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	identityclient "github.com/bthwani2-boop/samrim/services/identity/clients/go"
)

func (s *JoiningCaseServer) RegisterStoreCommercialAgreementRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /dsh/field/joining-cases/{caseId}/commercial-agreements", s.readFieldStoreCommercialAgreements)
	mux.HandleFunc("GET /dsh/field/joining-cases/{caseId}/commercial-agreement-defaults", s.readFieldStoreCommissionDefaults)
	mux.HandleFunc("POST /dsh/field/joining-cases/{caseId}/commercial-agreements", s.proposeFieldStoreCommercialAgreement)
	mux.HandleFunc("GET /dsh/joining-cases/self/commercial-agreements", s.readPartnerStoreCommercialAgreements)
	mux.HandleFunc("POST /dsh/joining-cases/self/commercial-agreements/{agreementId}/accept", s.acceptPartnerStoreCommercialAgreement)
	mux.HandleFunc("GET /dsh/operator/stores/{storeId}/commercial-agreements", s.readFinanceStoreCommercialAgreements)
	mux.HandleFunc("GET /dsh/operator/store-commercial-agreements", s.listFinanceStoreCommercialAgreements)
	mux.HandleFunc("POST /dsh/operator/stores/{storeId}/commercial-agreements/{agreementId}/decision", s.decideFinanceStoreCommercialAgreement)
	mux.HandleFunc("GET /dsh/operator/commercial-store-types/{commercialStoreTypeId}/commission-defaults", s.readFinanceStoreCommissionDefaults)
	mux.HandleFunc("POST /dsh/operator/commercial-store-types/{commercialStoreTypeId}/commission-defaults", s.updateFinanceStoreCommissionDefault)
}

func (s *JoiningCaseServer) readFieldStoreCommissionDefaults(w http.ResponseWriter, r *http.Request) {
	if !authorizedFieldSession(w, r) {
		return
	}
	defaults, err := s.service.ReadStoreTypeCommissionDefaultsForField(r.Context(), bearerToken(r), r.PathValue("caseId"))
	if err != nil {
		writeStoreCommercialAgreementError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, defaults)
}

func (s *JoiningCaseServer) readFieldStoreCommercialAgreements(w http.ResponseWriter, r *http.Request) {
	if !authorizedFieldSession(w, r) {
		return
	}
	agreements, err := s.service.ReadStoreCommercialAgreementsForField(r.Context(), bearerToken(r), r.PathValue("caseId"))
	if err != nil {
		writeStoreCommercialAgreementError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{"agreements": agreements})
}

func (s *JoiningCaseServer) proposeFieldStoreCommercialAgreement(w http.ResponseWriter, r *http.Request) {
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
	var input struct {
		Rates                  []wlt.StoreCommercialAgreementRate `json:"rates"`
		ExpectedCurrentVersion int                                `json:"expectedCurrentVersion"`
		Reason                 string                             `json:"reason"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	agreement, replayed, err := s.service.ProposeStoreCommercialAgreementForField(r.Context(), bearerToken(r), r.PathValue("caseId"), joiningcase.StoreCommercialAgreementProposalInput{Rates: input.Rates, ExpectedCurrentVersion: input.ExpectedCurrentVersion, Reason: input.Reason}, idempotency, correlation)
	if err != nil {
		writeStoreCommercialAgreementError(w, err)
		return
	}
	status := http.StatusCreated
	if replayed {
		status = http.StatusOK
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, status, map[string]any{"agreement": agreement, "idempotentReplay": replayed})
}

func (s *JoiningCaseServer) readPartnerStoreCommercialAgreements(w http.ResponseWriter, r *http.Request) {
	agreements, err := s.service.ReadStoreCommercialAgreementsForPartner(r.Context(), bearerToken(r))
	if err != nil {
		writeStoreCommercialAgreementError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{"agreements": agreements})
}

func (s *JoiningCaseServer) acceptPartnerStoreCommercialAgreement(w http.ResponseWriter, r *http.Request) {
	if r.Header.Get("X-Actor-ID") != "" || r.Header.Get("X-Acting-Actor-ID") != "" || r.Header.Get("If-Match") != "" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "client actor authority headers are forbidden")
		return
	}
	correlation := strings.TrimSpace(r.Header.Get("X-Correlation-ID"))
	idempotency := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	if len(correlation) < 8 || len(correlation) > 128 || len(idempotency) < 8 || len(idempotency) > 128 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "X-Correlation-ID and Idempotency-Key are required")
		return
	}
	var input struct {
		ExpectedAgreementVersion int    `json:"expectedAgreementVersion"`
		Reason                   string `json:"reason"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	agreement, replayed, err := s.service.AcceptStoreCommercialAgreementForPartner(r.Context(), bearerToken(r), r.PathValue("agreementId"), input.ExpectedAgreementVersion, input.Reason, idempotency, correlation)
	if err != nil {
		writeStoreCommercialAgreementError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{"agreement": agreement, "idempotentReplay": replayed})
}

func (s *JoiningCaseServer) readFinanceStoreCommercialAgreements(w http.ResponseWriter, r *http.Request) {
	if !s.auth.Authorized(r) {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "service authentication is required")
		return
	}
	acting := strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID"))
	if acting == "" || len(acting) > 128 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "X-Acting-Actor-ID is required")
		return
	}
	agreements, err := s.service.ReadStoreCommercialAgreementsForFinance(r.Context(), r.PathValue("storeId"), acting)
	if err != nil {
		writeStoreCommercialAgreementError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{"agreements": agreements})
}

func (s *JoiningCaseServer) listFinanceStoreCommercialAgreements(w http.ResponseWriter, r *http.Request) {
	if !s.auth.Authorized(r) {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "service authentication is required")
		return
	}
	acting := strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID"))
	if acting == "" || len(acting) > 128 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "X-Acting-Actor-ID is required")
		return
	}
	status := strings.TrimSpace(r.URL.Query().Get("status"))
	if status != "" && status != "PARTNER_ACCEPTED" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "status must be PARTNER_ACCEPTED")
		return
	}
	limit := 50
	if rawLimit := strings.TrimSpace(r.URL.Query().Get("limit")); rawLimit != "" {
		parsed, err := strconv.Atoi(rawLimit)
		if err != nil || parsed < 1 || parsed > 50 {
			writeError(w, http.StatusBadRequest, "INVALID_INPUT", "limit must be between 1 and 50")
			return
		}
		limit = parsed
	}
	page, err := s.service.ListPartnerAcceptedStoreCommercialAgreementsForFinance(r.Context(), r.URL.Query().Get("cursor"), limit, acting)
	if err != nil {
		writeStoreCommercialAgreementError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, page)
}

func (s *JoiningCaseServer) readFinanceStoreCommissionDefaults(w http.ResponseWriter, r *http.Request) {
	if !s.auth.Authorized(r) {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "service authentication is required")
		return
	}
	acting := strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID"))
	if acting == "" || len(acting) > 128 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "X-Acting-Actor-ID is required")
		return
	}
	defaults, err := s.service.ReadStoreTypeCommissionDefaultsForFinance(r.Context(), r.PathValue("commercialStoreTypeId"), acting)
	if err != nil {
		writeStoreCommercialAgreementError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, defaults)
}

func (s *JoiningCaseServer) updateFinanceStoreCommissionDefault(w http.ResponseWriter, r *http.Request) {
	if !s.auth.Authorized(r) {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "service authentication is required")
		return
	}
	acting, correlation, idempotency, ok := requiredMutationHeaders(w, r)
	if !ok {
		return
	}
	var input struct {
		FulfillmentMode            string `json:"fulfillmentMode"`
		SuggestedCommissionRateBps int    `json:"suggestedCommissionRateBps"`
		ExpectedDefaultVersion     int    `json:"expectedDefaultVersion"`
		Reason                     string `json:"reason"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	result, err := s.service.UpdateStoreTypeCommissionDefaultForFinance(r.Context(), r.PathValue("commercialStoreTypeId"), acting, input.FulfillmentMode, input.SuggestedCommissionRateBps, input.ExpectedDefaultVersion, input.Reason, idempotency, correlation)
	if err != nil {
		writeStoreCommercialAgreementError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, result)
}

func (s *JoiningCaseServer) decideFinanceStoreCommercialAgreement(w http.ResponseWriter, r *http.Request) {
	if !s.auth.Authorized(r) {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "service authentication is required")
		return
	}
	acting, correlation, idempotency, ok := requiredMutationHeaders(w, r)
	if !ok {
		return
	}
	var input struct {
		ExpectedAgreementVersion int    `json:"expectedAgreementVersion"`
		Decision                 string `json:"decision"`
		Reason                   string `json:"reason"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	agreement, replayed, err := s.service.DecideStoreCommercialAgreementForFinance(r.Context(), r.PathValue("storeId"), r.PathValue("agreementId"), wlt.StoreCommercialAgreementDecision{AgreementVersion: input.ExpectedAgreementVersion, Decision: input.Decision, Reason: input.Reason}, idempotency, correlation, acting)
	if err != nil {
		writeStoreCommercialAgreementError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{"agreement": agreement, "idempotentReplay": replayed})
}

func writeStoreCommercialAgreementError(w http.ResponseWriter, err error) {
	var wltError *wlt.Error
	if errors.As(err, &wltError) {
		writeWLTFinanceError(w, err)
		return
	}
	var identityError *identityclient.Error
	if errors.As(err, &identityError) {
		writeIdentityError(w, err)
		return
	}
	switch {
	case errors.Is(err, joiningcase.ErrStoreAgreementInvalidInput):
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "Store commercial agreement input is invalid")
	case errors.Is(err, joiningcase.ErrStoreAgreementState):
		writeError(w, http.StatusConflict, "STATE_CONFLICT", "Store commercial agreement is not in the required state")
	case errors.Is(err, joiningcase.ErrStoreAgreementForbidden):
		writeError(w, http.StatusForbidden, "FORBIDDEN", "the current actor cannot perform this Store commercial agreement action")
	case errors.Is(err, joiningcase.ErrFieldSessionForbidden), errors.Is(err, joiningcase.ErrPartnerSessionForbidden):
		writeError(w, http.StatusForbidden, "FORBIDDEN", "an eligible Field or Partner session is required")
	case errors.Is(err, joiningcase.ErrOperatorNotActive):
		writeError(w, http.StatusForbidden, "FORBIDDEN", "an active control operator session is required")
	case errors.Is(err, postgres.ErrJoiningCaseNotFound), errors.Is(err, postgres.ErrStoreNotFound):
		writeError(w, http.StatusNotFound, "NOT_FOUND", "joining case, Store, or agreement was not found")
	case errors.Is(err, postgres.ErrCommercialStoreTypeNotFound):
		writeError(w, http.StatusNotFound, "NOT_FOUND", "commercial Store Type was not found")
	case errors.Is(err, postgres.ErrCommercialStoreTypeInvalid):
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "commercial Store Type is invalid")
	default:
		writeError(w, http.StatusBadGateway, "STORE_AGREEMENT_UNAVAILABLE", "Store commercial agreement could not be read from its canonical owner")
	}
}
