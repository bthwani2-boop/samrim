package identityhttp

import (
	"crypto/subtle"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"strconv"
	"strings"

	"github.com/bthwani2-boop/samrim/services/identity/backend/internal/actor"
	"github.com/bthwani2-boop/samrim/services/identity/backend/internal/challenge"
	"github.com/bthwani2-boop/samrim/services/identity/backend/internal/domain"
	identitysecurity "github.com/bthwani2-boop/samrim/services/identity/backend/internal/security"
	"github.com/bthwani2-boop/samrim/services/identity/backend/internal/session"
)

type Config struct {
	InternalServiceTokens map[string]string
	AllowedOrigins        map[string]bool
	Readiness             func() error
}

type Server struct {
	actors     *actor.Service
	challenges *challenge.Service
	sessions   *session.Service
	config     Config
}

func New(actors *actor.Service, challenges *challenge.Service, sessions *session.Service, config Config) http.Handler {
	s := &Server{actors: actors, challenges: challenges, sessions: sessions, config: config}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /identity/health", s.health)
	mux.HandleFunc("GET /identity/readiness", s.readiness)
	mux.HandleFunc("POST /auth/client/registration/request", s.requestClientRegistration)
	mux.HandleFunc("POST /auth/client/register", s.registerClient)
	mux.HandleFunc("POST /auth/client/login", s.loginClient)
	mux.HandleFunc("POST /auth/client/recovery/request", s.requestClientRecovery)
	mux.HandleFunc("POST /auth/client/recover", s.recoverClient)
	mux.HandleFunc("POST /auth/managed/activation/request", s.requestManagedActivation)
	mux.HandleFunc("POST /auth/managed/activate", s.activateManaged)
	mux.HandleFunc("POST /auth/managed/login", s.loginManaged)
	mux.HandleFunc("POST /internal/managed-activation-codes", s.internal(s.issueManagedActivationCode))
	mux.HandleFunc("POST /auth/operator/login/start", s.startOperatorLogin)
	mux.HandleFunc("POST /auth/operator/login/complete", s.completeOperatorLogin)
	mux.HandleFunc("POST /auth/refresh", s.refresh)
	mux.HandleFunc("POST /auth/logout", s.logout)
	mux.HandleFunc("GET /auth/session", s.currentSession)
	mux.HandleFunc("POST /internal/actor-roles/provision", s.internal(s.provisionRole))
	mux.HandleFunc("GET /internal/actor-roles/search", s.internal(s.searchRoles))
	mux.HandleFunc("GET /internal/actors/{actorId}/roles/{role}", s.internal(s.getRole))
	mux.HandleFunc("POST /internal/actors/{actorId}/roles/{role}/disable", s.internal(s.disableRole))
	mux.HandleFunc("POST /internal/actors/{actorId}/roles/{role}/enable", s.internal(s.enableRole))
	mux.HandleFunc("POST /internal/actors/{actorId}/roles/{role}/reenrollment", s.internal(s.authorizeReenrollment))
	mux.HandleFunc("POST /internal/actors/{actorId}/security/disable", s.internal(s.disableActorSecurity))
	mux.HandleFunc("POST /internal/actors/{actorId}/security/enable", s.internal(s.enableActorSecurity))
	mux.HandleFunc("POST /internal/actors/{actorId}/operator-password/reset", s.internal(s.resetOperatorPassword))
	mux.HandleFunc("GET /internal/actors/{actorId}/roles/{role}/sessions", s.internal(s.listRoleSessions))
	mux.HandleFunc("DELETE /internal/actors/{actorId}/roles/{role}/sessions/{sessionId}", s.internal(s.revokeRoleSession))
	mux.HandleFunc("DELETE /internal/actors/{actorId}/roles/{role}/sessions", s.internal(s.revokeRoleSessions))
	return s.cors(mux)
}

func (s *Server) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"service": "identity", "status": "ok"})
}
func (s *Server) readiness(w http.ResponseWriter, _ *http.Request) {
	if s.config.Readiness == nil || s.config.Readiness() != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"service": "identity", "status": "not_ready"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"service": "identity", "status": "ok"})
}

func (s *Server) requestClientRegistration(w http.ResponseWriter, r *http.Request) {
	var input domain.PhoneRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	result, err := s.challenges.RequestClientRegistration(r.Context(), input, identitysecurity.SHA256Hex(remoteIP(r)))
	if err != nil {
		writeDomainError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, result)
}
func (s *Server) registerClient(w http.ResponseWriter, r *http.Request) {
	var input domain.ClientCredentialProofRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	result, err := s.challenges.RegisterClient(r.Context(), input)
	if err != nil {
		writeDomainError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, result)
}
func (s *Server) loginClient(w http.ResponseWriter, r *http.Request) {
	var input domain.PasswordLoginRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	result, err := s.challenges.LoginClient(r.Context(), input, identitysecurity.SHA256Hex(remoteIP(r)))
	if err != nil {
		writeDomainError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}
func (s *Server) requestClientRecovery(w http.ResponseWriter, r *http.Request) {
	var input domain.PhoneRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	result, err := s.challenges.RequestClientRecovery(r.Context(), input, identitysecurity.SHA256Hex(remoteIP(r)))
	if err != nil {
		writeDomainError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, result)
}
func (s *Server) recoverClient(w http.ResponseWriter, r *http.Request) {
	var input domain.ClientCredentialProofRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	result, err := s.challenges.RecoverClient(r.Context(), input)
	if err != nil {
		writeDomainError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}
func (s *Server) requestManagedActivation(w http.ResponseWriter, r *http.Request) {
	var input domain.ManagedChallengeRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	result, err := s.challenges.RequestManagedActivation(r.Context(), input, identitysecurity.SHA256Hex(remoteIP(r)))
	if err != nil {
		writeDomainError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, result)
}
func (s *Server) activateManaged(w http.ResponseWriter, r *http.Request) {
	var input domain.ManagedActivationRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	result, err := s.challenges.ActivateManaged(r.Context(), input)
	if err != nil {
		writeDomainError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}
func (s *Server) loginManaged(w http.ResponseWriter, r *http.Request) {
	var input domain.ManagedPasswordLoginRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	result, err := s.challenges.LoginManaged(r.Context(), input, identitysecurity.SHA256Hex(remoteIP(r)))
	if err != nil {
		writeDomainError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}
func (s *Server) issueManagedActivationCode(w http.ResponseWriter, r *http.Request, caller string) {
	var input domain.ManagedActivationCodeIssueRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	result, err := s.challenges.IssueManagedActivationCode(r.Context(), input, caller)
	if err != nil {
		writeDomainError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, result)
}
func (s *Server) startOperatorLogin(w http.ResponseWriter, r *http.Request) {
	var input domain.OperatorLoginStartRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	result, err := s.challenges.StartOperatorLogin(r.Context(), input, identitysecurity.SHA256Hex(remoteIP(r)))
	if err != nil {
		writeDomainError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, result)
}
func (s *Server) completeOperatorLogin(w http.ResponseWriter, r *http.Request) {
	var input domain.OperatorLoginCompleteRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	result, err := s.challenges.CompleteOperatorLogin(r.Context(), input)
	if err != nil {
		writeDomainError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) refresh(w http.ResponseWriter, r *http.Request) {
	var input domain.RefreshRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	result, err := s.sessions.Refresh(r.Context(), input)
	if err != nil {
		writeDomainError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}
func (s *Server) logout(w http.ResponseWriter, r *http.Request) {
	token, ok := bearerToken(r)
	if !ok {
		writeDomainError(w, domain.ErrUnauthenticated)
		return
	}
	if err := s.sessions.Logout(r.Context(), token); err != nil {
		writeDomainError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
func (s *Server) currentSession(w http.ResponseWriter, r *http.Request) {
	token, ok := bearerToken(r)
	if !ok {
		writeDomainError(w, domain.ErrUnauthenticated)
		return
	}
	identity, err := s.sessions.ResolveAccessToken(r.Context(), token)
	if err != nil {
		writeDomainError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, identity)
}

type internalHandler func(http.ResponseWriter, *http.Request, string)

func (s *Server) internal(next internalHandler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token, ok := bearerToken(r)
		if !ok {
			writeJSON(w, http.StatusUnauthorized, errorBody("UNAUTHENTICATED", "service authentication is required"))
			return
		}
		caller := ""
		for candidate, expected := range s.config.InternalServiceTokens {
			if subtle.ConstantTimeCompare([]byte(token), []byte(expected)) == 1 {
				caller = candidate
			}
		}
		if caller == "" {
			writeJSON(w, http.StatusUnauthorized, errorBody("UNAUTHENTICATED", "service authentication is required"))
			return
		}
		next(w, r, caller)
	}
}

func (s *Server) provisionRole(w http.ResponseWriter, r *http.Request, caller string) {
	var input domain.ProvisionActorRoleInput
	if !decodeJSON(w, r, &input) {
		return
	}
	view, err := s.actors.ProvisionTrusted(r.Context(), caller, input)
	if err != nil {
		writeDomainError(w, err)
		return
	}
	status := http.StatusOK
	if view.ActorCreated || view.RoleCreated {
		status = http.StatusCreated
	}
	writeJSON(w, status, view)
}
func (s *Server) searchRoles(w http.ResponseWriter, r *http.Request, caller string) {
	limit := 25
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil {
			writeDomainError(w, domain.ErrInvalidInput)
			return
		}
		limit = value
	}
	var enabled *bool
	if raw := strings.TrimSpace(r.URL.Query().Get("enabled")); raw != "" {
		value, err := strconv.ParseBool(raw)
		if err != nil {
			writeDomainError(w, domain.ErrInvalidInput)
			return
		}
		enabled = &value
	}
	page, err := s.actors.Search(r.Context(), caller, domain.ActorSearchInput{Role: strings.TrimSpace(r.URL.Query().Get("role")), Query: strings.TrimSpace(r.URL.Query().Get("q")), Enabled: enabled, Limit: limit, Cursor: strings.TrimSpace(r.URL.Query().Get("cursor"))})
	if err != nil {
		writeDomainError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, page)
}
func (s *Server) getRole(w http.ResponseWriter, r *http.Request, caller string) {
	view, err := s.actors.GetRole(r.Context(), caller, r.PathValue("actorId"), r.PathValue("role"))
	if err != nil {
		writeDomainError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, view)
}
func (s *Server) disableRole(w http.ResponseWriter, r *http.Request, caller string) {
	s.setRoleEnabled(w, r, caller, false)
}
func (s *Server) enableRole(w http.ResponseWriter, r *http.Request, caller string) {
	s.setRoleEnabled(w, r, caller, true)
}
func (s *Server) setRoleEnabled(w http.ResponseWriter, r *http.Request, caller string, enabled bool) {
	if err := s.actors.SetRoleEnabled(r.Context(), caller, r.PathValue("actorId"), r.PathValue("role"), enabled, strings.TrimSpace(r.Header.Get("X-Correlation-ID"))); err != nil {
		writeDomainError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
func (s *Server) authorizeReenrollment(w http.ResponseWriter, r *http.Request, caller string) {
	if err := s.actors.AuthorizeReenrollment(r.Context(), caller, r.PathValue("actorId"), r.PathValue("role"), strings.TrimSpace(r.Header.Get("X-Correlation-ID"))); err != nil {
		writeDomainError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
func (s *Server) disableActorSecurity(w http.ResponseWriter, r *http.Request, caller string) {
	s.setActorSecurityEnabled(w, r, caller, false)
}
func (s *Server) enableActorSecurity(w http.ResponseWriter, r *http.Request, caller string) {
	s.setActorSecurityEnabled(w, r, caller, true)
}
func (s *Server) setActorSecurityEnabled(w http.ResponseWriter, r *http.Request, caller string, enabled bool) {
	if err := s.actors.SetSecurityEnabled(r.Context(), caller, r.PathValue("actorId"), enabled, strings.TrimSpace(r.Header.Get("X-Correlation-ID"))); err != nil {
		writeDomainError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
func (s *Server) resetOperatorPassword(w http.ResponseWriter, r *http.Request, caller string) {
	var input domain.PasswordResetRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	if err := s.actors.ResetOperatorPassword(r.Context(), caller, r.PathValue("actorId"), input.Password, strings.TrimSpace(r.Header.Get("X-Correlation-ID"))); err != nil {
		writeDomainError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
func (s *Server) listRoleSessions(w http.ResponseWriter, r *http.Request, caller string) {
	actorID, role := r.PathValue("actorId"), strings.ToLower(strings.TrimSpace(r.PathValue("role")))
	if _, err := s.actors.GetRole(r.Context(), caller, actorID, role); err != nil {
		writeDomainError(w, err)
		return
	}
	items, err := s.sessions.ListRole(r.Context(), actorID, role)
	if err != nil {
		writeDomainError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, items)
}
func (s *Server) revokeRoleSession(w http.ResponseWriter, r *http.Request, caller string) {
	actorID, role := r.PathValue("actorId"), strings.ToLower(strings.TrimSpace(r.PathValue("role")))
	if _, err := s.actors.GetRole(r.Context(), caller, actorID, role); err != nil {
		writeDomainError(w, err)
		return
	}
	if err := s.sessions.RevokeRoleSession(r.Context(), actorID, role, r.PathValue("sessionId"), caller, strings.TrimSpace(r.Header.Get("X-Correlation-ID"))); err != nil {
		writeDomainError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
func (s *Server) revokeRoleSessions(w http.ResponseWriter, r *http.Request, caller string) {
	actorID, role := r.PathValue("actorId"), strings.ToLower(strings.TrimSpace(r.PathValue("role")))
	if _, err := s.actors.GetRole(r.Context(), caller, actorID, role); err != nil {
		writeDomainError(w, err)
		return
	}
	if err := s.sessions.RevokeRoleAll(r.Context(), actorID, role, caller, strings.TrimSpace(r.Header.Get("X-Correlation-ID"))); err != nil {
		writeDomainError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func decodeJSON(w http.ResponseWriter, r *http.Request, target any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 32*1024)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		writeJSON(w, http.StatusBadRequest, errorBody("INVALID_REQUEST", "request body is invalid"))
		return false
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		writeJSON(w, http.StatusBadRequest, errorBody("INVALID_REQUEST", "request body must contain exactly one JSON value"))
		return false
	}
	return true
}
func bearerToken(r *http.Request) (string, bool) {
	value := strings.TrimSpace(r.Header.Get("Authorization"))
	if len(value) < 8 || !strings.EqualFold(value[:7], "Bearer ") {
		return "", false
	}
	token := strings.TrimSpace(value[7:])
	return token, token != ""
}
func remoteIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(strings.TrimSpace(r.RemoteAddr))
	if err == nil && host != "" {
		return host
	}
	return strings.TrimSpace(r.RemoteAddr)
}
func (s *Server) cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := strings.TrimSpace(r.Header.Get("Origin"))
		if origin != "" {
			if !s.config.AllowedOrigins[origin] {
				writeJSON(w, http.StatusForbidden, errorBody("ORIGIN_FORBIDDEN", "origin is not allowed"))
				return
			}
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}
func writeDomainError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, domain.ErrInvalidInput):
		writeJSON(w, http.StatusBadRequest, errorBody("INVALID_INPUT", "request is invalid"))
	case errors.Is(err, domain.ErrUnauthenticated), errors.Is(err, domain.ErrInvalidChallenge), errors.Is(err, domain.ErrInvalidActivation), errors.Is(err, domain.ErrInvalidRefresh):
		writeJSON(w, http.StatusUnauthorized, errorBody("UNAUTHENTICATED", "authentication failed"))
	case errors.Is(err, domain.ErrForbidden), errors.Is(err, domain.ErrActorBlocked):
		writeJSON(w, http.StatusForbidden, errorBody("FORBIDDEN", "operation is forbidden"))
	case errors.Is(err, domain.ErrNotFound):
		writeJSON(w, http.StatusNotFound, errorBody("NOT_FOUND", "resource was not found"))
	case errors.Is(err, domain.ErrConflict):
		writeJSON(w, http.StatusConflict, errorBody("CONFLICT", "canonical identity state conflicts with request"))
	case errors.Is(err, domain.ErrRateLimited):
		w.Header().Set("Retry-After", "60")
		writeJSON(w, http.StatusTooManyRequests, errorBody("RATE_LIMITED", "too many attempts"))
	case errors.Is(err, domain.ErrUnavailable):
		writeJSON(w, http.StatusServiceUnavailable, errorBody("IDENTITY_UNAVAILABLE", "identity dependency is unavailable"))
	default:
		writeJSON(w, http.StatusInternalServerError, errorBody("IDENTITY_INTERNAL_ERROR", "identity request failed"))
	}
}
func errorBody(code, message string) map[string]any {
	return map[string]any{"error": map[string]string{"code": code, "message": message}}
}
func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
