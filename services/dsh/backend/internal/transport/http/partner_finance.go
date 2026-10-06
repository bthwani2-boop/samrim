package transporthttp

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/auth"
	identityintegration "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/identity"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/wlt"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storeaccess"
	identityclient "github.com/bthwani2-boop/samrim/services/identity/clients/go"
)

type PartnerFinanceServer struct {
	auth        *auth.ServiceToken
	identity    *identityintegration.Client
	payment     *wlt.Client
	db          *sql.DB
	storeAccess *storeaccess.Service
}

type partnerCommissionRemittanceRequest struct {
	AmountMinor         int64  `json:"amountMinor"`
	RemittanceReference string `json:"remittanceReference"`
	EvidenceDocumentID  string `json:"evidenceDocumentId"`
}

type partnerCommissionRemittanceResponse struct {
	Remittance       wlt.PartnerCommissionRemittance `json:"remittance"`
	IdempotentReplay bool                            `json:"idempotentReplay"`
}

func NewPartnerFinance(identity *identityintegration.Client, accessToken string, payment *wlt.Client, db *sql.DB) (*PartnerFinanceServer, error) {
	authorizer, err := auth.NewServiceToken(strings.TrimSpace(accessToken))
	if err != nil {
		return nil, err
	}
	if identity == nil || payment == nil || db == nil {
		return nil, &identityclient.Error{Status: http.StatusInternalServerError, Code: "CONFIGURATION_ERROR", Message: "partner finance dependencies are required"}
	}
	storeAccessService, err := storeaccess.New(identity, db, payment)
	if err != nil {
		return nil, err
	}
	return &PartnerFinanceServer{auth: authorizer, identity: identity, payment: payment, db: db, storeAccess: storeAccessService}, nil
}

func (s *PartnerFinanceServer) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /dsh/partners/me/financial-summary", s.readOwnSummary)
	mux.HandleFunc("GET /dsh/operator/partner-commission-receivables", s.listOperatorCommissionReceivables)
	mux.HandleFunc("GET /dsh/operator/partners/{partnerActorId}/financial-summary", s.readOperatorSummary)
	mux.HandleFunc("GET /dsh/operator/partners/{partnerActorId}/store-payout-recipients", s.readOperatorStorePayoutRecipients)
	mux.HandleFunc("POST /dsh/operator/partners/{partnerActorId}/commission-remittances", s.recordCommissionRemittance)
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
	if identity.Role != "partner" || identity.Surface != "app-partner" || strings.TrimSpace(identity.Subject) == "" {
		writeError(w, http.StatusForbidden, "FORBIDDEN", "an active app-partner session is required")
		return
	}
	stores, err := postgres.ListPartnerFinanceStores(r.Context(), s.db, identity.Subject, "finance_read")
	if err != nil {
		writeError(w, 500, "STORAGE_UNAVAILABLE", "finance scope is unavailable")
		return
	}
	stores, err = selectPartnerFinanceScope(stores, r.URL.Query()["storeId"])
	if err != nil {
		writeError(w, 403, "FORBIDDEN", "finance_read authority is required for every included Store")
		return
	}
	fullOwner := ""
	if len(r.URL.Query()["storeId"]) == 0 {
		fullOwner = identity.Subject
	}
	summary, err := readPartnerScopedFinance(r.Context(), s.payment, stores, fullOwner)
	if err != nil {
		writeWLTFinanceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"summary": summary})
}

func maskPartnerFinancePhone(phone string) string {
	phone = strings.TrimSpace(phone)
	if len(phone) <= 6 {
		if phone == "" {
			return ""
		}
		return "***"
	}
	return phone[:4] + strings.Repeat("*", len(phone)-7) + phone[len(phone)-3:]
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
	actorIDs := make([]string, 0, len(result.Items))
	for _, item := range result.Items {
		actorIDs = append(actorIDs, item.PartnerActorID)
	}
	presentations, err := postgres.ReadPartnerFinancePresentations(r.Context(), s.db, actorIDs)
	if err != nil {
		writeError(w, http.StatusBadGateway, "DSH_STORAGE_UNAVAILABLE", "Partner presentation is unavailable")
		return
	}
	phones := make(map[string]string, len(actorIDs))
	if len(actorIDs) > 0 {
		roles, roleErr := s.identity.ReadActorRoles(r.Context(), "partner", actorIDs)
		if roleErr != nil {
			writeIdentityError(w, roleErr)
			return
		}
		for _, role := range roles.Items {
			if role.Role == "partner" && role.ActorID != "" {
				phones[role.ActorID] = maskPartnerFinancePhone(role.PhoneE164)
			}
		}
	}
	items := make([]map[string]any, 0, len(result.Items))
	for _, item := range result.Items {
		presentation := presentations[item.PartnerActorID]
		items = append(items, map[string]any{
			"partnerActorId":                       item.PartnerActorID,
			"businessName":                         strings.TrimSpace(presentation.BusinessName),
			"partnerPhoneMasked":                   phones[item.PartnerActorID],
			"currency":                             item.Currency,
			"outstandingCommissionReceivableMinor": item.OutstandingCommissionReceivableMinor,
			"profileState":                         item.ProfileState,
		})
	}
	response := map[string]any{"items": items, "limit": result.Limit}
	if result.NextCursor != "" {
		response["nextCursor"] = result.NextCursor
	}
	writeJSON(w, http.StatusOK, response)
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

func (s *PartnerFinanceServer) readOperatorStorePayoutRecipients(w http.ResponseWriter, r *http.Request) {
	if !s.authorizeOperator(w, r) {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "service authentication is required")
		return
	}
	acting := strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID"))
	if !s.requireOperator(w, r.Context(), acting) || !s.requirePermission(w, r.Context(), acting, "finance") {
		return
	}
	partnerActorID := strings.TrimSpace(r.PathValue("partnerActorId"))
	if partnerActorID == "" || len(partnerActorID) > 128 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "partnerActorId is required")
		return
	}
	readback, storeNames, beneficiaryProfiles, err := s.storeAccess.ReadStorePayoutRecipientsForPartner(r.Context(), partnerActorID)
	if err != nil {
		if errors.Is(err, storeaccess.ErrInvalidInput) {
			writeError(w, http.StatusBadRequest, "INVALID_INPUT", "partnerActorId is invalid")
			return
		}
		var identityErr *identityclient.Error
		if errors.As(err, &identityErr) {
			writeIdentityError(w, err)
			return
		}
		writeWLTFinanceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"readback": readback, "storeNames": storeNames, "beneficiaryProfiles": beneficiaryProfiles})
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
	input.EvidenceDocumentID = strings.TrimSpace(input.EvidenceDocumentID)
	if input.AmountMinor <= 0 || len(input.RemittanceReference) < 1 || len(input.RemittanceReference) > 128 || len(input.EvidenceDocumentID) < 1 || len(input.EvidenceDocumentID) > 128 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "positive amount, remittance reference, and stored transfer receipt are required")
		return
	}
	result, replayed, err := s.payment.RecordPartnerCommissionRemittance(r.Context(), partnerActorID, input.AmountMinor, input.RemittanceReference, input.EvidenceDocumentID, idempotencyKey, correlationID, acting)
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
