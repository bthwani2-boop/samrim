package transporthttp

import (
	"context"
	"net/http"
	"strconv"
	"strings"
	"unicode/utf8"

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

type partnerCommissionRemittanceRequest struct {
	AmountMinor         int64  `json:"amountMinor"`
	RemittanceReference string `json:"remittanceReference"`
	EvidenceReference   string `json:"evidenceReference"`
}

type partnerCommissionRemittanceResponse struct {
	Remittance       wlt.PartnerCommissionRemittance `json:"remittance"`
	IdempotentReplay bool                            `json:"idempotentReplay"`
}

type partnerStoreCommissionPolicyUpdateRequest struct {
	StoreID           string `json:"storeId"`
	FulfillmentMode   string `json:"fulfillmentMode"`
	CommissionRateBps int    `json:"commissionRateBps"`
	ExpectedVersion   int    `json:"expectedVersion"`
	Reason            string `json:"reason"`
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
	mux.HandleFunc("GET /dsh/operator/partner-commission-receivables", s.listOperatorCommissionReceivables)
	mux.HandleFunc("GET /dsh/operator/partners/{partnerActorId}/financial-summary", s.readOperatorSummary)
	mux.HandleFunc("POST /dsh/operator/partners/{partnerActorId}/commission-remittances", s.recordCommissionRemittance)
	mux.HandleFunc("GET /dsh/operator/partner-store-commission-policies", s.readStoreCommissionPolicies)
	mux.HandleFunc("POST /dsh/operator/partner-store-commission-policies", s.updateStoreCommissionPolicy)
}

func (s *PartnerFinanceServer) readStoreCommissionPolicies(w http.ResponseWriter, r *http.Request) {
	if !s.authorizeOperator(w, r) {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "service authentication is required")
		return
	}
	acting := strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID"))
	if !s.requireOperator(w, r.Context(), acting) {
		return
	}
	if !s.requirePermission(w, r.Context(), acting, "finance") {
		return
	}
	storeID := strings.TrimSpace(r.URL.Query().Get("storeId"))
	if storeID == "" || len(storeID) > 128 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "storeId is required")
		return
	}
	result, err := s.payment.ReadPartnerStoreCommissionPolicies(r.Context(), storeID)
	if err != nil {
		writeWLTFinanceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *PartnerFinanceServer) updateStoreCommissionPolicy(w http.ResponseWriter, r *http.Request) {
	if !s.authorizeOperator(w, r) {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "service authentication is required")
		return
	}
	acting, correlationID, idempotencyKey, ok := requiredMutationHeaders(w, r)
	if !ok || !s.requireOperator(w, r.Context(), acting) {
		return
	}
	if !s.requirePermission(w, r.Context(), acting, "finance") {
		return
	}
	var input partnerStoreCommissionPolicyUpdateRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	input.StoreID = strings.TrimSpace(input.StoreID)
	input.FulfillmentMode = strings.TrimSpace(input.FulfillmentMode)
	input.Reason = strings.TrimSpace(input.Reason)
	validMode := input.FulfillmentMode == "BTHWANI_CAPTAIN" || input.FulfillmentMode == "PARTNER_CAPTAIN" || input.FulfillmentMode == "CUSTOMER_PICKUP"
	if input.StoreID == "" || len(input.StoreID) > 128 || !validMode || input.CommissionRateBps < 0 || input.CommissionRateBps > 10000 || input.ExpectedVersion < 1 || utf8.RuneCountInString(input.Reason) < 8 || utf8.RuneCountInString(input.Reason) > 500 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "store commission policy fields are invalid")
		return
	}
	result, err := s.payment.UpdatePartnerStoreCommissionPolicy(r.Context(), input.StoreID, input.FulfillmentMode, input.CommissionRateBps, input.ExpectedVersion, input.Reason, idempotencyKey, correlationID, acting)
	if err != nil {
		writeWLTFinanceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
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

func (s *PartnerFinanceServer) listOperatorCommissionReceivables(w http.ResponseWriter, r *http.Request) {
	if !s.authorizeOperator(w, r) {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "service authentication is required")
		return
	}
	acting := strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID"))
	if !s.requireOperator(w, r.Context(), acting) || !s.requirePermission(w, r.Context(), acting, "finance") {
		return
	}
	query := r.URL.Query()
	search := strings.TrimSpace(query.Get("search"))
	sortKey := strings.ToLower(strings.TrimSpace(query.Get("sort")))
	if sortKey == "" {
		sortKey = "actor_asc"
	}
	cursor := strings.TrimSpace(query.Get("cursor"))
	limit := 50
	if raw := strings.TrimSpace(query.Get("limit")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 || parsed > 100 {
			writeError(w, http.StatusBadRequest, "INVALID_INPUT", "partner commission receivable registry limit is invalid")
			return
		}
		limit = parsed
	}
	if utf8.RuneCountInString(search) > 128 || len(cursor) > 1024 || (sortKey != "actor_asc" && sortKey != "actor_desc") {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "partner commission receivable registry query is invalid")
		return
	}
	result, err := s.payment.ListPartnerCommissionReceivables(r.Context(), acting, search, sortKey, cursor, limit)
	if err != nil {
		writeWLTFinanceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
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
	if !s.requirePermission(w, r.Context(), acting, "finance") {
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

func (s *PartnerFinanceServer) recordCommissionRemittance(w http.ResponseWriter, r *http.Request) {
	if !s.authorizeOperator(w, r) {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "service authentication is required")
		return
	}
	acting := strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID"))
	if !s.requireOperator(w, r.Context(), acting) {
		return
	}
	if !s.requirePermission(w, r.Context(), acting, "finance") {
		return
	}
	correlationID := strings.TrimSpace(r.Header.Get("X-Correlation-ID"))
	idempotencyKey := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	if len(correlationID) < 8 || len(correlationID) > 128 || len(idempotencyKey) < 8 || len(idempotencyKey) > 128 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "X-Correlation-ID and Idempotency-Key are required")
		return
	}
	partnerActorID := strings.TrimSpace(r.PathValue("partnerActorId"))
	if partnerActorID == "" || len(partnerActorID) > 128 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "partnerActorId is required")
		return
	}
	var input partnerCommissionRemittanceRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	input.RemittanceReference = strings.TrimSpace(input.RemittanceReference)
	input.EvidenceReference = strings.TrimSpace(input.EvidenceReference)
	if input.AmountMinor <= 0 || len(input.RemittanceReference) < 1 || len(input.RemittanceReference) > 128 || len(input.EvidenceReference) < 1 || len(input.EvidenceReference) > 512 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "positive amount, remittance reference, and verification evidence are required")
		return
	}
	result, replayed, err := s.payment.RecordPartnerCommissionRemittance(r.Context(), partnerActorID, input.AmountMinor, input.RemittanceReference, input.EvidenceReference, idempotencyKey, correlationID, acting)
	if err != nil {
		writeWLTFinanceError(w, err)
		return
	}
	status := http.StatusCreated
	if replayed {
		status = http.StatusOK
	}
	writeJSON(w, status, partnerCommissionRemittanceResponse{Remittance: result, IdempotentReplay: replayed})
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
	if operator.Role != "operator" || !operator.Enabled || !operator.SecurityEnabled || operator.ActivatedAt == nil {
		writeError(w, http.StatusForbidden, "FORBIDDEN", "an active control operator session is required")
		return false
	}
	return true
}

func (s *PartnerFinanceServer) requirePermission(w http.ResponseWriter, ctx context.Context, actorID, permission string) bool {
	if err := s.identity.RequireOperatorPermission(ctx, actorID, permission); err != nil {
		writeIdentityError(w, err)
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
