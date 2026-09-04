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

	"github.com/bthwani2-boop/samrim/services/identity/backend/internal/activation"
	"github.com/bthwani2-boop/samrim/services/identity/backend/internal/actor"
	"github.com/bthwani2-boop/samrim/services/identity/backend/internal/domain"
	identitysecurity "github.com/bthwani2-boop/samrim/services/identity/backend/internal/security"
	"github.com/bthwani2-boop/samrim/services/identity/backend/internal/session"
)

type Config struct {
	ConsumerOperatorContextID string
	InternalServiceTokens     map[string]string
	AllowedOrigins            map[string]bool
	Readiness                 func() error
}

type Server struct {
	actors      *actor.Service
	activations *activation.Service
	sessions    *session.Service
	config      Config
}

func New(actors *actor.Service, activations *activation.Service, sessions *session.Service, config Config) http.Handler {
	s := &Server{actors:actors,activations:activations,sessions:sessions,config:config}
	mux := http.NewServeMux()

	mux.HandleFunc("GET /identity/health", s.health)
	mux.HandleFunc("GET /identity/readiness", s.readiness)

	mux.HandleFunc("POST /auth/otp/request", s.requestOtp)
	mux.HandleFunc("POST /auth/activate", s.activate)
	mux.HandleFunc("POST /auth/login", s.login)
	mux.HandleFunc("POST /auth/refresh", s.refresh)
	mux.HandleFunc("POST /auth/logout", s.logout)
	mux.HandleFunc("GET /auth/session", s.currentSession)

	mux.HandleFunc("POST /internal/actors/provision", s.internal(s.provisionActor))
	mux.HandleFunc("GET /internal/actors/search", s.internal(s.searchActors))
	mux.HandleFunc("GET /internal/actors/{actorId}", s.internal(s.getActor))
	mux.HandleFunc("POST /internal/actors/{actorId}/activations", s.internal(s.issueActivation))
	mux.HandleFunc("POST /internal/actors/{actorId}/suspend", s.internal(s.suspendActor))
	mux.HandleFunc("POST /internal/actors/{actorId}/reactivate", s.internal(s.reactivateActor))
	mux.HandleFunc("POST /internal/actors/{actorId}/deactivate", s.internal(s.deactivateActor))
	mux.HandleFunc("GET /internal/actors/{actorId}/sessions", s.internal(s.listSessions))
	mux.HandleFunc("DELETE /internal/actors/{actorId}/sessions/{sessionId}", s.internal(s.revokeSession))
	mux.HandleFunc("DELETE /internal/actors/{actorId}/sessions", s.internal(s.revokeAllSessions))

	return s.cors(mux)
}

func (s *Server) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"service":"identity","status":"ok"})
}

func (s *Server) readiness(w http.ResponseWriter, _ *http.Request) {
	if s.config.Readiness == nil || s.config.Readiness() != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"service":"identity","status":"not_ready"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"service":"identity","status":"ok"})
}

func (s *Server) requestOtp(w http.ResponseWriter, r *http.Request) {
	var input domain.OtpRequest
	if !decodeJSON(w, r, &input) { return }
	result, err := s.activations.RequestPublicClient(r.Context(), s.config.ConsumerOperatorContextID, input)
	if err != nil { writeDomainError(w, err); return }
	writeJSON(w, http.StatusCreated, result)
}

func (s *Server) activate(w http.ResponseWriter, r *http.Request) {
	var input domain.ActivationRequest
	if !decodeJSON(w, r, &input) { return }
	result, err := s.activations.Consume(r.Context(), input)
	if err != nil { writeDomainError(w, err); return }
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	var input domain.LoginRequest
	if !decodeJSON(w, r, &input) { return }
	ip := remoteIP(r)
	result, err := s.sessions.Login(r.Context(), input, identitysecurity.SHA256Hex(ip))
	if err != nil { writeDomainError(w, err); return }
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) refresh(w http.ResponseWriter, r *http.Request) {
	var input domain.RefreshRequest
	if !decodeJSON(w, r, &input) { return }
	result, err := s.sessions.Refresh(r.Context(), input)
	if err != nil { writeDomainError(w, err); return }
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) logout(w http.ResponseWriter, r *http.Request) {
	token, ok := bearerToken(r)
	if !ok { writeDomainError(w, domain.ErrUnauthenticated); return }
	if err := s.sessions.Logout(r.Context(), token); err != nil { writeDomainError(w, err); return }
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) currentSession(w http.ResponseWriter, r *http.Request) {
	token, ok := bearerToken(r)
	if !ok { writeDomainError(w, domain.ErrUnauthenticated); return }
	identity, err := s.sessions.ResolveAccessToken(r.Context(), token)
	if err != nil { writeDomainError(w, err); return }
	writeJSON(w, http.StatusOK, identity)
}

type internalHandler func(http.ResponseWriter, *http.Request, string, string)

func (s *Server) internal(next internalHandler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		caller := strings.ToLower(strings.TrimSpace(r.Header.Get("X-Service-Caller")))
		expected := strings.TrimSpace(s.config.InternalServiceTokens[caller])
		if expected == "" {
			writeJSON(w, http.StatusForbidden, errorBody("FORBIDDEN","service caller is not allowed"))
			return
		}
		token, ok := bearerToken(r)
		if !ok || subtle.ConstantTimeCompare([]byte(token), []byte(expected)) != 1 {
			writeJSON(w, http.StatusUnauthorized, errorBody("UNAUTHENTICATED","service authentication is required"))
			return
		}
		operatorContextID := strings.TrimSpace(r.Header.Get("X-Operator-Context-ID"))
		if operatorContextID == "" || len(operatorContextID) > 128 {
			writeJSON(w, http.StatusBadRequest, errorBody("OPERATOR_CONTEXT_REQUIRED","trusted operator context is required"))
			return
		}
		next(w, r, caller, operatorContextID)
	}
}

func (s *Server) provisionActor(w http.ResponseWriter, r *http.Request, caller, operatorContextID string) {
	var input domain.ProvisionActorInput
	if !decodeJSON(w, r, &input) { return }
	view, err := s.actors.ProvisionTrusted(r.Context(), caller, operatorContextID, input)
	if err != nil { writeDomainError(w, err); return }
	status := http.StatusOK
	if view.Created { status = http.StatusCreated }
	writeJSON(w, status, view)
}

func (s *Server) searchActors(w http.ResponseWriter, r *http.Request, caller string, operatorContextID string) {
	limit := 25
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil { writeDomainError(w, domain.ErrInvalidInput); return }
		limit = value
	}
	role := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("role")))
	if role == "" || !domain.RoleAllowedForCaller(caller, role) {
		writeDomainError(w, domain.ErrForbidden)
		return
	}
	page, err := s.actors.Search(r.Context(), operatorContextID, domain.ActorSearchInput{
		Role:role,
		Query:strings.TrimSpace(r.URL.Query().Get("q")),
		Status:domain.ActorStatus(strings.TrimSpace(r.URL.Query().Get("status"))),
		Limit:limit,
		Cursor:strings.TrimSpace(r.URL.Query().Get("cursor")),
	})
	if err != nil { writeDomainError(w, err); return }
	writeJSON(w, http.StatusOK, page)
}

func (s *Server) getActor(w http.ResponseWriter, r *http.Request, caller string, operatorContextID string) {
	view, err := s.authorizedActor(r, caller, operatorContextID)
	if err != nil { writeDomainError(w, err); return }
	writeJSON(w, http.StatusOK, view)
}

func (s *Server) issueActivation(w http.ResponseWriter, r *http.Request, caller, operatorContextID string) {
	var input domain.IssueActivationInput
	if !decodeJSON(w, r, &input) { return }
	result, err := s.activations.IssueForActor(
		r.Context(), caller, operatorContextID, r.PathValue("actorId"), input,
		strings.TrimSpace(r.Header.Get("Idempotency-Key")),
		strings.TrimSpace(r.Header.Get("X-Correlation-ID")),
	)
	if err != nil { writeDomainError(w, err); return }
	writeJSON(w, http.StatusCreated, result)
}

func (s *Server) suspendActor(w http.ResponseWriter, r *http.Request, caller, operatorContextID string) {
	s.setActorStatus(w,r,caller,operatorContextID,domain.ActorStatusSuspended)
}

func (s *Server) reactivateActor(w http.ResponseWriter, r *http.Request, caller, operatorContextID string) {
	s.setActorStatus(w,r,caller,operatorContextID,domain.ActorStatusActive)
}

func (s *Server) deactivateActor(w http.ResponseWriter, r *http.Request, caller, operatorContextID string) {
	s.setActorStatus(w,r,caller,operatorContextID,domain.ActorStatusDeactivated)
}

func (s *Server) setActorStatus(w http.ResponseWriter, r *http.Request, caller, operatorContextID string, status domain.ActorStatus) {
	if _, err := s.authorizedActor(r, caller, operatorContextID); err != nil {
		writeDomainError(w, err)
		return
	}
	principal := strings.TrimSpace(r.Header.Get("X-Principal-Actor-ID"))
	if principal == "" { principal = caller }
	if err := s.actors.SetStatus(r.Context(), operatorContextID, r.PathValue("actorId"), status, principal, strings.TrimSpace(r.Header.Get("X-Correlation-ID"))); err != nil {
		writeDomainError(w, err); return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) listSessions(w http.ResponseWriter, r *http.Request, caller string, operatorContextID string) {
	actorID := r.PathValue("actorId")
	if _, err := s.authorizedActor(r, caller, operatorContextID); err != nil { writeDomainError(w, err); return }
	items, err := s.sessions.List(r.Context(), actorID)
	if err != nil { writeDomainError(w, err); return }
	writeJSON(w, http.StatusOK, items)
}

func (s *Server) revokeSession(w http.ResponseWriter, r *http.Request, caller, operatorContextID string) {
	actorID := r.PathValue("actorId")
	if _, err := s.authorizedActor(r, caller, operatorContextID); err != nil { writeDomainError(w, err); return }
	principal := strings.TrimSpace(r.Header.Get("X-Principal-Actor-ID"))
	if principal == "" { principal = caller }
	if err := s.sessions.Revoke(r.Context(), actorID, r.PathValue("sessionId"), principal, strings.TrimSpace(r.Header.Get("X-Correlation-ID"))); err != nil {
		writeDomainError(w, err); return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) revokeAllSessions(w http.ResponseWriter, r *http.Request, caller, operatorContextID string) {
	actorID := r.PathValue("actorId")
	if _, err := s.authorizedActor(r, caller, operatorContextID); err != nil { writeDomainError(w, err); return }
	principal := strings.TrimSpace(r.Header.Get("X-Principal-Actor-ID"))
	if principal == "" { principal = caller }
	if err := s.sessions.RevokeAll(r.Context(), actorID, principal, strings.TrimSpace(r.Header.Get("X-Correlation-ID"))); err != nil {
		writeDomainError(w, err); return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) authorizedActor(r *http.Request, caller, operatorContextID string) (domain.ActorView, error) {
	view, err := s.actors.Get(r.Context(), operatorContextID, r.PathValue("actorId"))
	if err != nil {
		return domain.ActorView{}, err
	}
	for _, role := range view.Roles {
		if domain.RoleAllowedForCaller(caller, role) {
			return view, nil
		}
	}
	return domain.ActorView{}, domain.ErrForbidden
}

func decodeJSON(w http.ResponseWriter, r *http.Request, target any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 32*1024)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		writeJSON(w, http.StatusBadRequest, errorBody("INVALID_REQUEST","request body is invalid"))
		return false
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		writeJSON(w, http.StatusBadRequest, errorBody("INVALID_REQUEST","request body must contain exactly one JSON value"))
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
	if err == nil && host != "" { return host }
	return strings.TrimSpace(r.RemoteAddr)
}

func (s *Server) cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := strings.TrimSpace(r.Header.Get("Origin"))
		if origin != "" {
			if !s.config.AllowedOrigins[origin] {
				writeJSON(w, http.StatusForbidden, errorBody("ORIGIN_FORBIDDEN","origin is not allowed"))
				return
			}
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type, Idempotency-Key, X-Correlation-ID")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w,r)
	})
}

func writeDomainError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err,domain.ErrInvalidInput):
		writeJSON(w,http.StatusBadRequest,errorBody("INVALID_INPUT","request is invalid"))
	case errors.Is(err,domain.ErrUnauthenticated),errors.Is(err,domain.ErrInvalidActivation),errors.Is(err,domain.ErrInvalidRefresh):
		writeJSON(w,http.StatusUnauthorized,errorBody("UNAUTHENTICATED","authentication failed"))
	case errors.Is(err,domain.ErrForbidden),errors.Is(err,domain.ErrActorBlocked):
		writeJSON(w,http.StatusForbidden,errorBody("FORBIDDEN","operation is forbidden"))
	case errors.Is(err,domain.ErrNotFound):
		writeJSON(w,http.StatusNotFound,errorBody("NOT_FOUND","resource was not found"))
	case errors.Is(err,domain.ErrConflict):
		writeJSON(w,http.StatusConflict,errorBody("CONFLICT","canonical identity state conflicts with request"))
	case errors.Is(err,domain.ErrRateLimited):
		w.Header().Set("Retry-After","60")
		writeJSON(w,http.StatusTooManyRequests,errorBody("RATE_LIMITED","too many attempts"))
	case errors.Is(err,domain.ErrUnavailable):
		writeJSON(w,http.StatusServiceUnavailable,errorBody("IDENTITY_UNAVAILABLE","identity dependency is unavailable"))
	default:
		writeJSON(w,http.StatusInternalServerError,errorBody("IDENTITY_INTERNAL_ERROR","identity request failed"))
	}
}

func errorBody(code,message string) map[string]any {
	return map[string]any{"error":map[string]string{"code":code,"message":message}}
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type","application/json; charset=utf-8")
	w.Header().Set("Cache-Control","no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

