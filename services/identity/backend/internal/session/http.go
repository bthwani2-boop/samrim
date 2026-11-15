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
	isMerchantAdmission := r.URL.Path == "/v1/actors/me/merchant-role"
	permission := ""
	if strings.HasPrefix(r.URL.Path, permissionPath) {
		permission = strings.TrimPrefix(r.URL.Path, permissionPath)
	}
	if !isSession && !isMerchantAdmission && !isOperatorPermission(permission) {
		respond(w, http.StatusNotFound, map[string]string{"error": "NOT_FOUND"})
		return
	}
	logout := isSession && r.Method == http.MethodDelete
	switch {
	case isSession:
		w.Header().Set("Allow", "GET, DELETE")
	case isMerchantAdmission:
		w.Header().Set("Allow", "POST")
	default:
		w.Header().Set("Allow", "GET")
	}
	if (isMerchantAdmission && r.Method != http.MethodPost) ||
		(!isMerchantAdmission && r.Method != http.MethodGet && !logout) {
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
	var admission MerchantAdmission
	var err error
	if isMerchantAdmission {
		admission, err = h.verifier.AdmitMerchant(ctx, authorizations[0])
	} else if logout {
		err = h.verifier.Revoke(ctx, authorizations[0])
	} else if isSession {
		principal, err = h.verifier.Verify(ctx, authorizations[0])
	} else {
		principal, err = h.verifier.VerifyPermission(ctx, authorizations[0], permission)
	}
	if errors.Is(err, ErrUnauthorized) {
		w.Header().Set("WWW-Authenticate", `Bearer realm="identity"`)
		respond(w, http.StatusUnauthorized, map[string]string{"error": "UNAUTHORIZED"})
		return
	}
	if errors.Is(err, ErrMerchantAlreadyProvisioned) {
		respond(w, http.StatusConflict, map[string]string{"error": "ALREADY_PROVISIONED"})
		return
	}
	if errors.Is(err, ErrVerificationRequired) {
		respond(w, http.StatusForbidden, map[string]string{"error": "VERIFICATION_REQUIRED"})
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
	if isMerchantAdmission {
		respond(w, http.StatusCreated, admission)
	} else if logout {
		w.WriteHeader(http.StatusNoContent)
	} else if isSession {
		respond(w, http.StatusOK, principal)
	} else {
		respond(w, http.StatusOK, struct {
			ActorID    string `json:"actorId"`
			Permission string `json:"permission"`
		}{principal.ActorID, permission})
	}
}
