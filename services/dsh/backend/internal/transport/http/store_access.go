package transporthttp

import (
	"database/sql"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/auth"
	identityintegration "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/identity"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/wlt"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storeaccess"
	identityclient "github.com/bthwani2-boop/samrim/services/identity/clients/go"
)

type StoreAccessServer struct {
	operatorAuth *auth.ServiceToken
	service      *storeaccess.Service
}

type storeAccessCreateRequest struct {
	DelegatePhoneE164 string   `json:"delegatePhoneE164"`
	Permissions       []string `json:"permissions"`
}

type storeAccessTransitionRequest struct {
	State           string `json:"state"`
	ExpectedVersion int    `json:"expectedVersion"`
}

type storeAccessPermissionsRequest struct {
	Permissions     []string `json:"permissions"`
	ExpectedVersion int      `json:"expectedVersion"`
}

type storeAccessDecisionRequest struct {
	Decision        string `json:"decision"`
	ExpectedVersion int    `json:"expectedVersion"`
}

type storeAccessActivationRequest struct {
	ExpectedVersion int `json:"expectedVersion"`
}

type storeAccessMutationResponse struct {
	Grant            postgres.StoreAccessGrant `json:"grant"`
	IdempotentReplay bool                      `json:"idempotentReplay"`
}

func NewStoreAccess(identity *identityintegration.Client, operatorServiceToken string, db *sql.DB, wltClient *wlt.Client) (*StoreAccessServer, error) {
	operatorAuth, err := auth.NewServiceToken(strings.TrimSpace(operatorServiceToken))
	if err != nil {
		return nil, err
	}
	service, err := storeaccess.New(identity, db, wltClient)
	if err != nil {
		return nil, err
	}
	return &StoreAccessServer{operatorAuth: operatorAuth, service: service}, nil
}

func (s *StoreAccessServer) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /dsh/partner/stores", s.listAccessibleStores)
	mux.HandleFunc("GET /dsh/partner/stores/{storeId}/access", s.listForOwner)
	mux.HandleFunc("POST /dsh/partner/stores/{storeId}/access/invitations", s.createForOwner)
	mux.HandleFunc("PATCH /dsh/partner/stores/{storeId}/access/{grantId}", s.transitionForOwner)
	mux.HandleFunc("PUT /dsh/partner/stores/{storeId}/access/{grantId}/permissions", s.updatePermissionsForOwner)
	mux.HandleFunc("GET /dsh/partner/store-payout-recipients", s.listStorePayoutRecipients)
	mux.HandleFunc("PUT /dsh/partner/stores/{storeId}/payout-recipient", s.selectStorePayoutRecipient)
	mux.HandleFunc("POST /dsh/partner/stores/{storeId}/payout-recipient/revert", s.revertStorePayoutRecipient)
	mux.HandleFunc("GET /dsh/actor/store-access-invitations", s.listForDelegate)
	mux.HandleFunc("POST /dsh/actor/store-access-invitations/{grantId}/decision", s.decideForDelegate)
	mux.HandleFunc("POST /dsh/partner/store-access-invitations/{grantId}/activate", s.activateForDelegate)
	mux.HandleFunc("GET /dsh/operations/store-access-role-admissions", s.listRoleAdmissionsForOperator)
	mux.HandleFunc("POST /dsh/operations/store-access-role-admissions/{grantId}/provision", s.admitPartnerRoleForOperator)
}

func (s *StoreAccessServer) listAccessibleStores(w http.ResponseWriter, r *http.Request) {
	limit := 25
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 || parsed > 50 {
			writeError(w, http.StatusBadRequest, "INVALID_INPUT", "limit must be between 1 and 50")
			return
		}
		limit = parsed
	}
	page, err := s.service.ListAccessibleStores(r.Context(), bearerToken(r), limit, r.URL.Query().Get("cursor"))
	if err != nil {
		writeStoreAccessError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, page)
}

func (s *StoreAccessServer) listForOwner(w http.ResponseWriter, r *http.Request) {
	grants, err := s.service.ListForOwner(r.Context(), bearerToken(r), r.PathValue("storeId"))
	if err != nil {
		writeStoreAccessError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": grants})
}

func (s *StoreAccessServer) createForOwner(w http.ResponseWriter, r *http.Request) {
	correlationID, idempotencyKey, ok := storeAccessMutationHeaders(w, r)
	if !ok {
		return
	}
	var request storeAccessCreateRequest
	if !decodeJSON(w, r, &request) {
		return
	}
	grant, replayed, err := s.service.CreateForPartner(r.Context(), bearerToken(r), r.PathValue("storeId"), request.DelegatePhoneE164, request.Permissions, idempotencyKey, correlationID)
	if err != nil {
		writeStoreAccessError(w, err)
		return
	}
	status := http.StatusCreated
	if replayed {
		status = http.StatusOK
	}
	writeJSON(w, status, storeAccessMutationResponse{Grant: grant, IdempotentReplay: replayed})
}

func (s *StoreAccessServer) transitionForOwner(w http.ResponseWriter, r *http.Request) {
	correlationID, idempotencyKey, ok := storeAccessMutationHeaders(w, r)
	if !ok {
		return
	}
	var request storeAccessTransitionRequest
	if !decodeJSON(w, r, &request) {
		return
	}
	grant, replayed, err := s.service.TransitionForOwner(r.Context(), bearerToken(r), r.PathValue("storeId"), r.PathValue("grantId"), request.State, request.ExpectedVersion, idempotencyKey, correlationID)
	if err != nil {
		writeStoreAccessError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, storeAccessMutationResponse{Grant: grant, IdempotentReplay: replayed})
}

func (s *StoreAccessServer) updatePermissionsForOwner(w http.ResponseWriter, r *http.Request) {
	correlationID, idempotencyKey, ok := storeAccessMutationHeaders(w, r)
	if !ok {
		return
	}
	var request storeAccessPermissionsRequest
	if !decodeJSON(w, r, &request) {
		return
	}
	grant, replayed, err := s.service.UpdatePermissionsForOwner(r.Context(), bearerToken(r), r.PathValue("storeId"), r.PathValue("grantId"), request.Permissions, request.ExpectedVersion, idempotencyKey, correlationID)
	if err != nil {
		writeStoreAccessError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, storeAccessMutationResponse{Grant: grant, IdempotentReplay: replayed})
}

func (s *StoreAccessServer) listForDelegate(w http.ResponseWriter, r *http.Request) {
	grants, err := s.service.ListForDelegate(r.Context(), bearerToken(r))
	if err != nil {
		writeStoreAccessError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": grants})
}

func (s *StoreAccessServer) decideForDelegate(w http.ResponseWriter, r *http.Request) {
	correlationID, idempotencyKey, ok := storeAccessMutationHeaders(w, r)
	if !ok {
		return
	}
	var request storeAccessDecisionRequest
	if !decodeJSON(w, r, &request) {
		return
	}
	grant, replayed, err := s.service.DecideForDelegate(r.Context(), bearerToken(r), r.PathValue("grantId"), request.Decision, request.ExpectedVersion, idempotencyKey, correlationID)
	if err != nil {
		writeStoreAccessError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, storeAccessMutationResponse{Grant: grant, IdempotentReplay: replayed})
}

func (s *StoreAccessServer) activateForDelegate(w http.ResponseWriter, r *http.Request) {
	correlationID, idempotencyKey, ok := storeAccessMutationHeaders(w, r)
	if !ok {
		return
	}
	var request storeAccessActivationRequest
	if !decodeJSON(w, r, &request) {
		return
	}
	grant, replayed, err := s.service.ActivateForDelegate(r.Context(), bearerToken(r), r.PathValue("grantId"), request.ExpectedVersion, idempotencyKey, correlationID)
	if err != nil {
		writeStoreAccessError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, storeAccessMutationResponse{Grant: grant, IdempotentReplay: replayed})
}

func (s *StoreAccessServer) listRoleAdmissionsForOperator(w http.ResponseWriter, r *http.Request) {
	actingActorID, ok := storeAccessOperatorActor(w, r, s.operatorAuth)
	if !ok {
		return
	}
	grants, err := s.service.ListRoleAdmissionsForOperator(r.Context(), actingActorID)
	if err != nil {
		writeStoreAccessError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": grants})
}

func (s *StoreAccessServer) admitPartnerRoleForOperator(w http.ResponseWriter, r *http.Request) {
	actingActorID, ok := storeAccessOperatorActor(w, r, s.operatorAuth)
	if !ok {
		return
	}
	correlationID, idempotencyKey, ok := storeAccessMutationHeaders(w, r)
	if !ok {
		return
	}
	grant, replayed, err := s.service.AdmitPartnerRoleForOperator(r.Context(), r.PathValue("grantId"), actingActorID, idempotencyKey, correlationID)
	if err != nil {
		writeStoreAccessError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, storeAccessMutationResponse{Grant: grant, IdempotentReplay: replayed})
}

func storeAccessOperatorActor(w http.ResponseWriter, r *http.Request, serviceAuth *auth.ServiceToken) (string, bool) {
	if !serviceAuth.Authorized(r) {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "service authentication is required")
		return "", false
	}
	if r.Header.Get("X-Actor-ID") != "" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "X-Actor-ID is forbidden; use X-Acting-Actor-ID")
		return "", false
	}
	actorID := strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID"))
	if actorID == "" || len(actorID) > 128 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "X-Acting-Actor-ID is required")
		return "", false
	}
	return actorID, true
}

func storeAccessMutationHeaders(w http.ResponseWriter, r *http.Request) (string, string, bool) {
	if r.Header.Get("X-Actor-ID") != "" || r.Header.Get("If-Match") != "" || r.Header.Get("X-Expected-Version") != "" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "legacy actor and version headers are forbidden; expectedVersion belongs in the request body")
		return "", "", false
	}
	correlationID := strings.TrimSpace(r.Header.Get("X-Correlation-ID"))
	idempotencyKey := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	if len(correlationID) < 8 || len(correlationID) > 128 || len(idempotencyKey) < 8 || len(idempotencyKey) > 128 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "bounded X-Correlation-ID and Idempotency-Key are required")
		return "", "", false
	}
	return correlationID, idempotencyKey, true
}

func writeStoreAccessError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, storeaccess.ErrInvalidInput), errors.Is(err, postgres.ErrStoreAccessConflict):
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "Store access facts are invalid")
	case errors.Is(err, storeaccess.ErrActorSecurityDisabled):
		writeError(w, http.StatusConflict, "ACTOR_SECURITY_DISABLED", "the invited Actor must have account security enabled to accept or activate this invitation")
	case errors.Is(err, storeaccess.ErrPartnerSession):
		writeError(w, http.StatusForbidden, "FORBIDDEN", "an active app-partner session is required")
	case errors.Is(err, storeaccess.ErrInvitationActorSession):
		writeError(w, http.StatusForbidden, "FORBIDDEN", "an active eligible Human Actor session is required")
	case errors.Is(err, storeaccess.ErrOperatorPermission):
		writeError(w, http.StatusForbidden, "FORBIDDEN", "an active Operator with Partners permission is required")
	case errors.Is(err, postgres.ErrStoreAccessForbidden):
		writeError(w, http.StatusForbidden, "FORBIDDEN", "the actor is not authorized to manage this Store access grant")
	case errors.Is(err, postgres.ErrStoreAccessNotFound):
		writeError(w, http.StatusNotFound, "NOT_FOUND", "Store access invitation was not found")
	case errors.Is(err, postgres.ErrStoreAccessExpired):
		writeError(w, http.StatusConflict, "INVITATION_EXPIRED", "the Store access invitation has expired")
	case errors.Is(err, postgres.ErrStoreAccessVersion):
		writeError(w, http.StatusConflict, "VERSION_CONFLICT", "Store access changed; read canonical state and retry")
	case errors.Is(err, postgres.ErrStoreAccessIdem):
		writeError(w, http.StatusConflict, "IDEMPOTENCY_CONFLICT", "Idempotency-Key was already used with different Store access facts")
	case errors.Is(err, storeaccess.ErrStoreOwnership):
		writeError(w, http.StatusForbidden, "FORBIDDEN", "only the Store owner may manage the payout recipient")
	case errors.Is(err, storeaccess.ErrGrantNotActive):
		writeError(w, http.StatusConflict, "GRANT_NOT_ACTIVE", "the selected team member does not have an active grant on this Store")
	default:
		var identityErr *identityclient.Error
		if errors.As(err, &identityErr) {
			writeIdentityError(w, err)
			return
		}
		writeError(w, http.StatusBadGateway, "DSH_STORAGE_UNAVAILABLE", "DSH persistence or Identity is unavailable")
	}
}

type storePayoutRecipientSelectBody struct {
	GrantID string `json:"grantId"`
	Reason  string `json:"reason"`
}

type storePayoutRecipientRevertBody struct {
	Reason string `json:"reason"`
}

func (s *StoreAccessServer) listStorePayoutRecipients(w http.ResponseWriter, r *http.Request) {
	readback, storeNames, beneficiaryProfiles, err := s.service.ListStorePayoutRecipients(r.Context(), bearerToken(r))
	if err != nil {
		writeStoreAccessError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"readback": readback, "storeNames": storeNames, "beneficiaryProfiles": beneficiaryProfiles})
}

func (s *StoreAccessServer) selectStorePayoutRecipient(w http.ResponseWriter, r *http.Request) {
	correlationID, idempotencyKey, ok := storeAccessMutationHeaders(w, r)
	if !ok {
		return
	}
	var request storePayoutRecipientSelectBody
	if !decodeJSON(w, r, &request) {
		return
	}
	assignment, replayed, err := s.service.SelectStorePayoutRecipientForOwner(r.Context(), bearerToken(r), r.PathValue("storeId"), request.GrantID, request.Reason, idempotencyKey, correlationID)
	if err != nil {
		writeStoreAccessError(w, err)
		return
	}
	status := http.StatusCreated
	if replayed {
		status = http.StatusOK
	}
	writeJSON(w, status, map[string]any{"assignment": assignment, "idempotentReplay": replayed})
}

func (s *StoreAccessServer) revertStorePayoutRecipient(w http.ResponseWriter, r *http.Request) {
	correlationID, idempotencyKey, ok := storeAccessMutationHeaders(w, r)
	if !ok {
		return
	}
	var request storePayoutRecipientRevertBody
	if !decodeJSON(w, r, &request) {
		return
	}
	reverted, err := s.service.RevertStorePayoutRecipientForOwner(r.Context(), bearerToken(r), r.PathValue("storeId"), request.Reason, idempotencyKey, correlationID)
	if err != nil {
		writeStoreAccessError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"state": "DEFAULT_OWNER", "idempotentReplay": reverted})
}
