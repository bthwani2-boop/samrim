package transporthttp

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/auth"
	contract "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/contract"
	identityintegration "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/identity"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/managedaccess"
)

type ManagedAccessServer struct {
	auth    *auth.ServiceToken
	service *managedaccess.Service
}

func NewManagedAccess(identityClient *identityintegration.Client, accessToken string) (*ManagedAccessServer, error) {
	authorizer, err := auth.NewServiceToken(strings.TrimSpace(accessToken))
	if err != nil {
		return nil, err
	}
	service, err := managedaccess.New(identityClient)
	if err != nil {
		return nil, err
	}
	return &ManagedAccessServer{auth: authorizer, service: service}, nil
}

func (s *ManagedAccessServer) Register(mux *http.ServeMux) {
	mux.HandleFunc("POST /dsh/managed-roles/provision", s.provision)
	mux.HandleFunc("GET /dsh/managed-roles/status", s.statusByPhone)
	mux.HandleFunc("POST /dsh/managed-roles/disable", s.disableByPhone)
	mux.HandleFunc("POST /dsh/managed-roles/enable", s.enableByPhone)
	mux.HandleFunc("POST /dsh/managed-roles/reenrollment", s.reenrollByPhone)
}

func (s *ManagedAccessServer) statusByPhone(w http.ResponseWriter, r *http.Request) {
	if !s.auth.Authorized(r) {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "service authentication is required")
		return
	}
	role := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("role")))
	phone := strings.TrimSpace(r.URL.Query().Get("phoneE164"))
	if !isManagedRole(role) {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "role must be partner, captain, or field")
		return
	}
	if phone == "" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "phoneE164 and role are required")
		return
	}
	view, err := s.service.StatusByPhone(r.Context(), phone, role)
	if err != nil {
		writeIdentityError(w, err)
		return
	}
	writeRoleStatus(w, view)
}

func (s *ManagedAccessServer) disableByPhone(w http.ResponseWriter, r *http.Request) {
	s.setEnabledByPhone(w, r, false)
}
func (s *ManagedAccessServer) enableByPhone(w http.ResponseWriter, r *http.Request) {
	s.setEnabledByPhone(w, r, true)
}

func (s *ManagedAccessServer) setEnabledByPhone(w http.ResponseWriter, r *http.Request, enabled bool) {
	if !s.auth.Authorized(r) {
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
	if !isManagedRole(role) || phone == "" || len(reason) < 5 || len(reason) > 500 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "phoneE164, managed role, and a reason of 5 to 500 characters are required")
		return
	}
	operator, expected, ok := requiredVersionedMutationHeaders(w, r)
	if !ok {
		return
	}
	if err := s.service.SetEnabledByPhone(r.Context(), phone, role, enabled, r.Header.Get("X-Correlation-ID"), reason, operator, expected); err != nil {
		writeIdentityError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *ManagedAccessServer) Ready(ctx context.Context) error { return s.service.Ready(ctx) }

func (s *ManagedAccessServer) provision(w http.ResponseWriter, r *http.Request) {
	if !s.auth.Authorized(r) {
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
	phone := strings.TrimSpace(input.PhoneE164)
	if !isManagedRole(role) || phone == "" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "phoneE164 and role are required")
		return
	}
	operator := strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID"))
	if operator == "" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "X-Acting-Actor-ID is required for managed role provisioning")
		return
	}
	view, err := s.service.Provision(r.Context(), phone, role, strings.TrimSpace(r.Header.Get("X-Correlation-ID")), operator)
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

func (s *ManagedAccessServer) reenrollByPhone(w http.ResponseWriter, r *http.Request) {
	if !s.auth.Authorized(r) {
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
	phone := strings.TrimSpace(input.PhoneE164)
	if !isManagedRole(role) || phone == "" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "phoneE164 and role are required")
		return
	}
	operator := strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID"))
	if operator == "" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "X-Acting-Actor-ID is required for managed role reenrollment")
		return
	}
	if err := s.service.Reenroll(r.Context(), phone, role, strings.TrimSpace(r.Header.Get("X-Correlation-ID")), operator); err != nil {
		writeIdentityError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *ManagedAccessServer) authorized(r *http.Request) bool { return s.auth.Authorized(r) }

func requiredVersionedMutationHeaders(w http.ResponseWriter, r *http.Request) (string, int, bool) {
	operator := strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID"))
	rawVersion := strings.TrimSpace(r.Header.Get("X-Expected-Version"))
	if operator == "" || rawVersion == "" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "X-Acting-Actor-ID and X-Expected-Version are required for managed role state mutations")
		return "", 0, false
	}
	version, err := strconv.Atoi(rawVersion)
	if err != nil || version < 1 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "X-Expected-Version must be a positive integer >= 1")
		return "", 0, false
	}
	return operator, version, true
}

func isManagedRole(role string) bool {
	return role == "partner" || role == "captain" || role == "field"
}
