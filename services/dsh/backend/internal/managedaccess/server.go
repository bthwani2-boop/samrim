package managedaccess

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"

	auth "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/auth"
	contract "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/contract"
	identityboundary "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/identityboundary"
	identityclient "github.com/bthwani2-boop/samrim/services/identity/clients/go"
)

type Server struct {
	identity *identityboundary.Client
	auth     *auth.ServiceToken
}

func New(identity *identityboundary.Client, accessToken string) (*Server, error) {
	accessToken = strings.TrimSpace(accessToken)
	if identity == nil || len(accessToken) < 24 {
		return nil, errors.New("dsh managed access configuration is invalid")
	}
	authorizer, err := auth.NewServiceToken(accessToken)
	if err != nil {
		return nil, err
	}
	return &Server{identity: identity, auth: authorizer}, nil
}

func (s *Server) Register(mux *http.ServeMux) {
	mux.HandleFunc("POST /dsh/managed-roles/provision", s.provision)
	mux.HandleFunc("GET /dsh/managed-roles/status", s.statusByPhone)
	mux.HandleFunc("POST /dsh/managed-roles/disable", s.disableByPhone)
	mux.HandleFunc("POST /dsh/managed-roles/enable", s.enableByPhone)
	mux.HandleFunc("POST /dsh/managed-roles/reenrollment", s.reenrollByPhone)
}

func (s *Server) statusByPhone(w http.ResponseWriter, r *http.Request) {
	if !s.authorized(r) {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "service authentication is required")
		return
	}
	role := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("role")))
	if role != "partner" && role != "captain" && role != "field" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "role must be partner, captain, or field")
		return
	}
	phone := strings.TrimSpace(r.URL.Query().Get("phoneE164"))
	if phone == "" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "phoneE164 and role are required")
		return
	}
	view, err := s.identity.LookupRoleByPhone(r.Context(), phone, role)
	if err != nil {
		var identityErr *identityclient.Error
		if errors.As(err, &identityErr) && identityErr.Status == http.StatusNotFound {
			writeRoleStatus(w, contract.ManagedRoleStatusResponse{Role: contract.ManagedRole(role), Exists: false, Reenrollable: false, State: "not_provisioned"})
			return
		}
		writeIdentityError(w, err)
		return
	}
	canonicalState := "active"
	if !view.SecurityEnabled {
		canonicalState = "identity_disabled"
	} else if !view.Enabled {
		canonicalState = "role_disabled"
	} else if view.ActivatedAt == nil {
		canonicalState = "pending_activation"
	}
	isReenrollable := view.Enabled && view.SecurityEnabled && view.ActivatedAt != nil
	writeRoleStatus(w, contract.ManagedRoleStatusResponse{
		ActorID:         view.ActorID,
		Exists:          true,
		Enabled:         view.Enabled,
		Activated:       view.ActivatedAt != nil,
		SecurityEnabled: view.SecurityEnabled,
		Reenrollable:    isReenrollable,
		State:           canonicalState,
		Role:            contract.ManagedRole(role),
		ActorVersion:    view.ActorVersion,
		RoleVersion:     view.RoleVersion,
	})
}

func (s *Server) disableByPhone(w http.ResponseWriter, r *http.Request) {
	s.setEnabledByPhone(w, r, false)
}
func (s *Server) enableByPhone(w http.ResponseWriter, r *http.Request) {
	s.setEnabledByPhone(w, r, true)
}
func (s *Server) setEnabledByPhone(w http.ResponseWriter, r *http.Request, enabled bool) {
	if !s.authorized(r) {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "service authentication is required")
		return
	}
	if r.Header.Get("X-Actor-ID") != "" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "X-Actor-ID is forbidden; use X-Acting-Actor-ID")
		return
	}
	if r.Header.Get("If-Match") != "" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "If-Match is forbidden; use X-Expected-Version")
		return
	}
	var input contract.SetManagedRoleStateRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	role := strings.ToLower(strings.TrimSpace(string(input.Role)))
	phone := strings.TrimSpace(input.PhoneE164)
	reason := strings.TrimSpace(input.Reason)
	if (role != "partner" && role != "captain" && role != "field") || phone == "" || len(reason) < 5 || len(reason) > 500 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "phoneE164, managed role, and a reason of 5 to 500 characters are required")
		return
	}
	operatorActorID := strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID"))
	if operatorActorID == "" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "X-Acting-Actor-ID is required for managed role state mutations")
		return
	}
	rawVer := strings.TrimSpace(r.Header.Get("X-Expected-Version"))
	if rawVer == "" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "X-Expected-Version is required for managed role state mutations")
		return
	}
	v, err := strconv.Atoi(rawVer)
	if err != nil || v < 1 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "X-Expected-Version must be a positive integer >= 1")
		return
	}
	expectedVersion := v
	if err := s.identity.SetRoleEnabledByPhoneWithContext(r.Context(), phone, role, enabled, strings.TrimSpace(r.Header.Get("X-Correlation-ID")), reason, operatorActorID, expectedVersion); err != nil {
		writeIdentityError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) Ready(ctx context.Context) error { return s.identity.Readiness(ctx) }

func (s *Server) provision(w http.ResponseWriter, r *http.Request) {
	if !s.authorized(r) {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "service authentication is required")
		return
	}
	if r.Header.Get("X-Actor-ID") != "" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "X-Actor-ID is forbidden; use X-Acting-Actor-ID")
		return
	}
	if r.Header.Get("If-Match") != "" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "If-Match is forbidden; use X-Expected-Version")
		return
	}
	var input contract.ProvisionManagedRoleRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	role := strings.ToLower(strings.TrimSpace(string(input.Role)))
	if role != "partner" && role != "captain" && role != "field" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "role must be partner, captain, or field")
		return
	}
	phone := strings.TrimSpace(input.PhoneE164)
	if phone == "" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "phoneE164 and role are required")
		return
	}

	operatorActorID := strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID"))
	if operatorActorID == "" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "X-Acting-Actor-ID is required for managed role provisioning")
		return
	}
	correlationID := strings.TrimSpace(r.Header.Get("X-Correlation-ID"))

	var (
		view identityclient.ActorRoleView
		err  error
	)
	switch role {
	case "partner":
		view, err = s.identity.ProvisionPartnerWithContext(r.Context(), identityboundary.ActorInput{PhoneE164: phone}, correlationID, operatorActorID)
	case "captain":
		view, err = s.identity.ProvisionCaptainWithContext(r.Context(), identityboundary.ActorInput{PhoneE164: phone}, correlationID, operatorActorID)
	case "field":
		view, err = s.identity.ProvisionFieldWithContext(r.Context(), identityboundary.ActorInput{PhoneE164: phone}, correlationID, operatorActorID)
	}
	if err != nil {
		writeIdentityError(w, err)
		return
	}
	status := http.StatusOK
	if view.ActorCreated || view.RoleCreated {
		status = http.StatusCreated
	}
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(toRoleView(view))
}

func (s *Server) reenrollByPhone(w http.ResponseWriter, r *http.Request) {
	if !s.authorized(r) {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "service authentication is required")
		return
	}
	if r.Header.Get("X-Actor-ID") != "" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "X-Actor-ID is forbidden; use X-Acting-Actor-ID")
		return
	}
	if r.Header.Get("If-Match") != "" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "If-Match is forbidden; use X-Expected-Version")
		return
	}
	var input contract.PhoneReenrollmentRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	role := strings.ToLower(strings.TrimSpace(string(input.Role)))
	if role != "partner" && role != "captain" && role != "field" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "role must be partner, captain, or field")
		return
	}
	phone := strings.TrimSpace(input.PhoneE164)
	if phone == "" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "phoneE164 and role are required")
		return
	}
	operatorActorID := strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID"))
	if operatorActorID == "" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "X-Acting-Actor-ID is required for managed role reenrollment")
		return
	}
	correlationID := strings.TrimSpace(r.Header.Get("X-Correlation-ID"))
	if err := s.identity.AuthorizeReenrollmentByPhoneWithContext(r.Context(), phone, role, correlationID, operatorActorID); err != nil {
		writeIdentityError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) authorized(r *http.Request) bool {
	return s.auth.Authorized(r)
}

func writeIdentityError(w http.ResponseWriter, err error) {
	var identityErr *identityclient.Error
	if errors.As(err, &identityErr) {
		status := identityErr.Status
		if status < 400 || status > 599 {
			status = http.StatusBadGateway
		}
		writeError(w, status, identityErr.Code, identityErr.Message)
		return
	}
	writeError(w, http.StatusBadGateway, "IDENTITY_UNAVAILABLE", "identity service is unavailable")
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{"error": map[string]string{"code": code, "message": message}})
}

func writeRoleStatus(w http.ResponseWriter, status contract.ManagedRoleStatusResponse) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	_ = json.NewEncoder(w).Encode(status)
}

func toRoleView(view identityclient.ActorRoleView) contract.ActorRoleView {
	return contract.ActorRoleView{
		ActorID:           view.ActorID,
		PhoneE164:         view.PhoneE164,
		Role:              view.Role,
		Enabled:           view.Enabled,
		ActivatedAt:       view.ActivatedAt,
		SecurityEnabled:   view.SecurityEnabled,
		ActorVersion:      view.ActorVersion,
		RoleVersion:       view.RoleVersion,
		CredentialVersion: view.CredentialVersion,
		ActorCreated:      view.ActorCreated,
		RoleCreated:       view.RoleCreated,
	}
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
