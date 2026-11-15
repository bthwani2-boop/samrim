package session

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"
)

type Handler struct{ verifier *Verifier }

func NewHandler(v *Verifier) http.Handler { return &Handler{verifier: v} }

func respond(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Referrer-Policy", "no-referrer")
	const permissionPath = "/v1/operators/me/permissions/"
	isSession := r.URL.Path == "/v1/sessions/current"
	permission := ""
	if strings.HasPrefix(r.URL.Path, permissionPath) {
		permission = strings.TrimPrefix(r.URL.Path, permissionPath)
	}
	if !isSession && !isOperatorPermission(permission) {
		respond(w, http.StatusNotFound, map[string]string{"error": "NOT_FOUND"})
		return
	}
	w.Header().Set("Allow", "GET")
	if r.Method != http.MethodGet {
		respond(w, http.StatusMethodNotAllowed, map[string]string{"error": "METHOD_NOT_ALLOWED"})
		return
	}
	if r.ContentLength != 0 || len(r.TransferEncoding) != 0 || r.URL.RawQuery != "" {
		respond(w, http.StatusBadRequest, map[string]string{"error": "INVALID_REQUEST"})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()
	if h == nil || h.verifier == nil {
		respond(w, http.StatusServiceUnavailable, map[string]string{"error": "OWNER_UNAVAILABLE"})
		return
	}
	// Header.Get silently selects one value when multiple Authorization headers
	// arrive. Refuse ambiguous credentials before making any owner read.
	authorizations := r.Header.Values("Authorization")
	if len(authorizations) != 1 {
		w.Header().Set("WWW-Authenticate", `Bearer realm="identity"`)
		respond(w, http.StatusUnauthorized, map[string]string{"error": "UNAUTHORIZED"})
		return
	}
	var principal Principal
	var err error
	if isSession {
		principal, err = h.verifier.Verify(ctx, authorizations[0])
	} else {
		principal, err = h.verifier.VerifyPermission(ctx, authorizations[0], permission)
	}
	if errors.Is(err, ErrUnauthorized) {
		w.Header().Set("WWW-Authenticate", `Bearer realm="identity"`)
		respond(w, http.StatusUnauthorized, map[string]string{"error": "UNAUTHORIZED"})
		return
	}
	if errors.Is(err, ErrForbidden) {
		respond(w, http.StatusForbidden, map[string]string{"error": "FORBIDDEN"})
		return
	}
	if err != nil {
		respond(w, http.StatusServiceUnavailable, map[string]string{"error": "OWNER_UNAVAILABLE"})
		return
	}
	if isSession {
		respond(w, http.StatusOK, principal)
	} else {
		respond(w, http.StatusOK, struct {
			ActorID    string `json:"actorId"`
			Permission string `json:"permission"`
		}{principal.ActorID, permission})
	}
}
