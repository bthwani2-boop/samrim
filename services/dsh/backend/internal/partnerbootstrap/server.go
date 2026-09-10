package partnerbootstrap

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/auth"
	contract "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/contract"
	identityboundary "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/identityboundary"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	identityclient "github.com/bthwani2-boop/samrim/services/identity/clients/go"
)

const CreatePermission = "partner.bootstrap.create"

type Server struct {
	identity *identityboundary.Client
	auth     *auth.ServiceToken
	db       *sql.DB
}

func New(identity *identityboundary.Client, accessToken string, db *sql.DB) (*Server, error) {
	if identity == nil || db == nil {
		return nil, errors.New("partner bootstrap configuration is invalid")
	}
	authorizer, err := auth.NewServiceToken(accessToken)
	if err != nil {
		return nil, err
	}
	return &Server{identity: identity, auth: authorizer, db: db}, nil
}

func (s *Server) Register(mux *http.ServeMux) {
	mux.HandleFunc("POST /dsh/partner-bootstrap", s.create)
	mux.HandleFunc("GET /dsh/partner-bootstrap/{partnerActorId}", s.readForOperator)
	mux.HandleFunc("GET /dsh/partner-bootstrap/self", s.readForPartner)
}

func (s *Server) create(w http.ResponseWriter, r *http.Request) {
	if !s.auth.Authorized(r) {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "service authentication is required")
		return
	}
	if r.Header.Get("X-Actor-ID") != "" || r.Header.Get("If-Match") != "" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "X-Actor-ID and If-Match are forbidden")
		return
	}
	actingActorID, correlationID, idempotencyKey, ok := requiredMutationHeaders(w, r)
	if !ok {
		return
	}
	var input contract.CreatePartnerBootstrapRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	ownerActorID := strings.TrimSpace(input.PartnerActorID)
	storeName := strings.TrimSpace(input.StoreName)
	if ownerActorID == "" || len(ownerActorID) > 128 || len(storeName) < 2 || len(storeName) > 160 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "partnerActorId and a storeName of 2 to 160 characters are required")
		return
	}
	if err := s.authorizeOperator(r.Context(), actingActorID); err != nil {
		writeAuthorizationError(w, err)
		return
	}
	partner, err := s.identity.ReadActorRole(r.Context(), ownerActorID, "partner")
	if err != nil {
		writeIdentityError(w, err)
		return
	}
	if !partner.Enabled || !partner.SecurityEnabled || partner.ActivatedAt == nil {
		writeError(w, http.StatusConflict, "PARTNER_NOT_ACTIVE", "partner actor is not active")
		return
	}
	record, err := postgres.CreatePartnerBootstrap(r.Context(), s.db, idempotencyKey, postgres.HashBootstrapRequest(ownerActorID, storeName), actingActorID, correlationID, ownerActorID, storeName)
	if err != nil {
		writeStorageError(w, err)
		return
	}
	status := http.StatusCreated
	if record.Replayed {
		status = http.StatusOK
	}
	writeBootstrap(w, status, record)
}

func (s *Server) readForOperator(w http.ResponseWriter, r *http.Request) {
	if !s.auth.Authorized(r) {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "service authentication is required")
		return
	}
	actingActorID := strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID"))
	if actingActorID == "" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "X-Acting-Actor-ID is required")
		return
	}
	if err := s.authorizeOperator(r.Context(), actingActorID); err != nil {
		writeAuthorizationError(w, err)
		return
	}
	record, err := postgres.ReadPartnerBootstrap(r.Context(), s.db, strings.TrimSpace(r.PathValue("partnerActorId")))
	if err != nil {
		writeStorageError(w, err)
		return
	}
	writeBootstrap(w, http.StatusOK, record)
}

func (s *Server) readForPartner(w http.ResponseWriter, r *http.Request) {
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
	record, err := postgres.ReadPartnerBootstrap(r.Context(), s.db, identity.Subject)
	if err != nil {
		writeStorageError(w, err)
		return
	}
	writeBootstrap(w, http.StatusOK, record)
}

func (s *Server) authorizeOperator(ctx context.Context, actorID string) error {
	actorID = strings.TrimSpace(actorID)
	if actorID == "" {
		return errors.New("acting actor is required")
	}
	for _, role := range []string{"operator", "platform_owner"} {
		view, err := s.identity.ReadActorRole(ctx, actorID, role)
		if err != nil {
			var identityErr *identityclient.Error
			if errors.As(err, &identityErr) && identityErr.Status == http.StatusNotFound {
				continue
			}
			return err
		}
		if view.Enabled && view.SecurityEnabled && view.ActivatedAt != nil {
			return nil
		}
	}
	return errForbidden
}

var errForbidden = errors.New("acting actor lacks partner bootstrap permission")

func requiredMutationHeaders(w http.ResponseWriter, r *http.Request) (string, string, string, bool) {
	acting := strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID"))
	correlation := strings.TrimSpace(r.Header.Get("X-Correlation-ID"))
	idempotency := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	if len(acting) == 0 || len(acting) > 128 || len(correlation) < 8 || len(correlation) > 128 || len(idempotency) < 8 || len(idempotency) > 128 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "X-Acting-Actor-ID, X-Correlation-ID, and Idempotency-Key are required")
		return "", "", "", false
	}
	return acting, correlation, idempotency, true
}

func bearerToken(r *http.Request) string {
	value := strings.TrimSpace(r.Header.Get("Authorization"))
	if !strings.HasPrefix(value, "Bearer ") {
		return ""
	}
	return strings.TrimSpace(strings.TrimPrefix(value, "Bearer "))
}

func writeIdentityError(w http.ResponseWriter, err error) {
	var identityErr *identityclient.Error
	if errors.As(err, &identityErr) {
		status := identityErr.Status
		if status < 400 || status > 599 {
			status = http.StatusBadGateway
		}
		if status == http.StatusNotFound {
			writeError(w, status, "PARTNER_NOT_FOUND", "partner actor was not found")
			return
		}
		writeError(w, status, identityErr.Code, identityErr.Message)
		return
	}
	writeError(w, http.StatusBadGateway, "IDENTITY_UNAVAILABLE", "identity service is unavailable")
}

func writeAuthorizationError(w http.ResponseWriter, err error) {
	if errors.Is(err, errForbidden) {
		writeError(w, http.StatusForbidden, "FORBIDDEN", "acting actor lacks partner bootstrap permission")
		return
	}
	writeIdentityError(w, err)
}

func writeStorageError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, postgres.ErrBootstrapNotFound):
		writeError(w, http.StatusNotFound, "NOT_FOUND", "partner bootstrap was not found")
	case errors.Is(err, postgres.ErrIdempotencyConflict):
		writeError(w, http.StatusConflict, "IDEMPOTENCY_CONFLICT", "Idempotency-Key was already used with a different request")
	case errors.Is(err, postgres.ErrAlreadyBootstrapped):
		writeError(w, http.StatusConflict, "PARTNER_ALREADY_BOOTSTRAPPED", "partner already has a canonical organization and first store")
	default:
		writeError(w, http.StatusBadGateway, "DSH_STORAGE_UNAVAILABLE", "DSH persistence is unavailable")
	}
}

func writeBootstrap(w http.ResponseWriter, status int, record postgres.BootstrapRecord) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(contract.PartnerBootstrapResponse{
		PartnerOrganization: contract.PartnerOrganizationView{ID: record.Organization.ID, OwnerActorID: record.Organization.OwnerActorID, Version: record.Organization.Version, CreatedAt: record.Organization.CreatedAt, UpdatedAt: record.Organization.UpdatedAt},
		FirstStore:          contract.StoreView{ID: record.Store.ID, PartnerOrganizationID: record.Store.PartnerOrganizationID, Name: record.Store.Name, Version: record.Store.Version, CreatedAt: record.Store.CreatedAt, UpdatedAt: record.Store.UpdatedAt},
		IdempotentReplay:    record.Replayed,
	})
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{"error": map[string]string{"code": code, "message": message}})
}

func decodeJSON(w http.ResponseWriter, r *http.Request, target any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 32*1024)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "request body is invalid")
		return false
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "request body must contain exactly one JSON value")
		return false
	}
	return true
}
