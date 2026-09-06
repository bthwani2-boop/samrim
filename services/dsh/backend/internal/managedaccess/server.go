package managedaccess

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	identityboundary "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/identityboundary"
	identityclient "github.com/bthwani2-boop/samrim/services/identity/clients/go"
)

type provisionRequest struct {
	PhoneE164 string `json:"phoneE164"`
	Role      string `json:"role"`
}

type reenrollmentRequest struct {
	ActorID string `json:"actorId"`
	Role    string `json:"role"`
}

type phoneReenrollmentRequest struct {
	PhoneE164 string `json:"phoneE164"`
	Role      string `json:"role"`
}

type roleStateRequest struct {
	PhoneE164 string `json:"phoneE164"`
	Role      string `json:"role"`
	Reason    string `json:"reason"`
}

type roleStatusResponse struct {
	ActorID         string `json:"actorId,omitempty"`
	Exists          bool   `json:"exists"`
	Enabled         bool   `json:"enabled"`
	Activated       bool   `json:"activated"`
	SecurityEnabled bool   `json:"securityEnabled"`
	Recoverable     bool   `json:"recoverable"`
	Role            string `json:"role"`
}

type Server struct {
	identity    *identityboundary.Client
	accessToken []byte
}

func New(identity *identityboundary.Client, accessToken string) (*Server, error) {
	accessToken = strings.TrimSpace(accessToken)
	if identity == nil || len(accessToken) < 24 {
		return nil, errors.New("dsh managed access configuration is invalid")
	}
	return &Server{identity: identity, accessToken: []byte(accessToken)}, nil
}

func (s *Server) Register(mux *http.ServeMux) {
	mux.HandleFunc("POST /dsh/managed-roles/provision", s.provision)
	mux.HandleFunc("GET /dsh/managed-roles/status", s.statusByPhone)
	mux.HandleFunc("POST /dsh/managed-roles/disable", s.disableByPhone)
	mux.HandleFunc("POST /dsh/managed-roles/enable", s.enableByPhone)
	mux.HandleFunc("POST /dsh/managed-roles/reenrollment", s.reenrollByPhone)
	mux.HandleFunc("POST /dsh/managed-roles/{actorId}/reenrollment", s.reenroll)
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
			writeRoleStatus(w, roleStatusResponse{Role: role, Recoverable: true})
			return
		}
		writeIdentityError(w, err)
		return
	}
	writeRoleStatus(w, roleStatusResponse{ActorID: view.ActorID, Exists: true, Enabled: view.Enabled, Activated: view.ActivatedAt != nil, SecurityEnabled: view.SecurityEnabled, Recoverable: view.Enabled && view.ActivatedAt != nil, Role: role})
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
	var input roleStateRequest
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "phoneE164, role, and reason are required")
		return
	}
	role := strings.ToLower(strings.TrimSpace(input.Role))
	phone := strings.TrimSpace(input.PhoneE164)
	reason := strings.TrimSpace(input.Reason)
	if (role != "partner" && role != "captain" && role != "field") || phone == "" || len(reason) < 5 || len(reason) > 500 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "phoneE164, managed role, and a reason of 5 to 500 characters are required")
		return
	}
	if err := s.identity.SetRoleEnabledByPhone(r.Context(), phone, role, enabled, strings.TrimSpace(r.Header.Get("X-Correlation-ID")), reason); err != nil {
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
	var input provisionRequest
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "phoneE164 and role are required")
		return
	}
	role := strings.ToLower(strings.TrimSpace(input.Role))
	if role != "partner" && role != "captain" && role != "field" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "role must be partner, captain, or field")
		return
	}
	phone := strings.TrimSpace(input.PhoneE164)
	if phone == "" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "phoneE164 and role are required")
		return
	}

	var (
		view identityclient.ActorRoleView
		err  error
	)
	switch role {
	case "partner":
		view, err = s.identity.ProvisionPartner(r.Context(), identityboundary.ActorInput{PhoneE164: phone})
	case "captain":
		view, err = s.identity.ProvisionCaptain(r.Context(), identityboundary.ActorInput{PhoneE164: phone})
	case "field":
		view, err = s.identity.ProvisionField(r.Context(), identityboundary.ActorInput{PhoneE164: phone})
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
	_ = json.NewEncoder(w).Encode(view)
}

func (s *Server) reenroll(w http.ResponseWriter, r *http.Request) {
	if !s.authorized(r) {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "service authentication is required")
		return
	}
	var input reenrollmentRequest
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "role is required")
		return
	}
	role := strings.ToLower(strings.TrimSpace(input.Role))
	if role != "partner" && role != "captain" && role != "field" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "role must be partner, captain, or field")
		return
	}
	actorID := strings.TrimSpace(r.PathValue("actorId"))
	if actorID == "" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "actorId is required")
		return
	}
	if err := s.identity.AuthorizeReenrollment(r.Context(), actorID, role, strings.TrimSpace(r.Header.Get("X-Correlation-ID"))); err != nil {
		writeIdentityError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) reenrollByPhone(w http.ResponseWriter, r *http.Request) {
	if !s.authorized(r) {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "service authentication is required")
		return
	}
	var input phoneReenrollmentRequest
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "phoneE164 and role are required")
		return
	}
	role := strings.ToLower(strings.TrimSpace(input.Role))
	if role != "partner" && role != "captain" && role != "field" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "role must be partner, captain, or field")
		return
	}
	phone := strings.TrimSpace(input.PhoneE164)
	if phone == "" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "phoneE164 and role are required")
		return
	}
	if err := s.identity.AuthorizeReenrollmentByPhone(r.Context(), phone, role, strings.TrimSpace(r.Header.Get("X-Correlation-ID"))); err != nil {
		writeIdentityError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) authorized(r *http.Request) bool {
	value := strings.TrimSpace(r.Header.Get("Authorization"))
	const prefix = "Bearer "
	if !strings.HasPrefix(value, prefix) {
		return false
	}
	provided := strings.TrimSpace(strings.TrimPrefix(value, prefix))
	return len(provided) == len(s.accessToken) && subtle.ConstantTimeCompare([]byte(provided), s.accessToken) == 1
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

func writeRoleStatus(w http.ResponseWriter, status roleStatusResponse) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	_ = json.NewEncoder(w).Encode(status)
}
