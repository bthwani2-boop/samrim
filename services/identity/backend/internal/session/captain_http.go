package session

import (
	"context"
	"errors"
	"net/http"
	"time"
)

const (
	CaptainAdmitPath   = "/v1/actors/me/captain-role"
	CaptainReentryPath = "/v1/actors/me/captain-session"
)

type captainHandler struct{ admission *CaptainAdmission }

func NewCaptainHandler(admission *CaptainAdmission) http.Handler {
	return &captainHandler{admission: admission}
}

func (h *captainHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	noStore(w)
	admit := r.URL.Path == CaptainAdmitPath
	resume := r.URL.Path == CaptainReentryPath
	if !admit && !resume {
		respond(w, http.StatusNotFound, map[string]string{"error": "NOT_FOUND"})
		return
	}
	w.Header().Set("Allow", "POST")
	if r.Method != http.MethodPost {
		respond(w, http.StatusMethodNotAllowed, map[string]string{"error": "METHOD_NOT_ALLOWED"})
		return
	}
	if r.ContentLength != 0 || len(r.TransferEncoding) != 0 || r.URL.RawQuery != "" {
		respond(w, http.StatusBadRequest, map[string]string{"error": "INVALID_REQUEST"})
		return
	}
	auth := r.Header.Values("Authorization")
	if len(auth) != 1 {
		w.Header().Set("WWW-Authenticate", `Bearer realm="identity"`)
		respond(w, http.StatusUnauthorized, map[string]string{"error": "UNAUTHORIZED"})
		return
	}
	if _, err := bearerDigest(auth[0]); err != nil {
		w.Header().Set("WWW-Authenticate", `Bearer realm="identity"`)
		respond(w, http.StatusUnauthorized, map[string]string{"error": "UNAUTHORIZED"})
		return
	}
	if h == nil || h.admission == nil {
		respond(w, http.StatusServiceUnavailable, map[string]string{"error": "OWNER_UNAVAILABLE"})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()
	var issued MerchantAdmission
	var err error
	if admit {
		issued, err = h.admission.Admit(ctx, auth[0])
	} else {
		issued, err = h.admission.Resume(ctx, auth[0])
	}
	if err != nil {
		code, status := "OWNER_UNAVAILABLE", http.StatusServiceUnavailable
		switch {
		case errors.Is(err, ErrUnauthorized):
			code, status = "UNAUTHORIZED", http.StatusUnauthorized
			w.Header().Set("WWW-Authenticate", `Bearer realm="identity"`)
		case errors.Is(err, ErrVerificationRequired):
			code, status = "VERIFICATION_REQUIRED", http.StatusForbidden
		case errors.Is(err, ErrCaptainStandingNotApproved):
			code, status = "CAPTAIN_NOT_APPROVED", http.StatusForbidden
		case errors.Is(err, ErrCaptainRoleAlreadyProvisioned):
			code, status = "ALREADY_PROVISIONED", http.StatusConflict
		case errors.Is(err, ErrCaptainRoleNotActive):
			code, status = "CAPTAIN_NOT_ACTIVE", http.StatusForbidden
		}
		respond(w, status, map[string]string{"error": code})
		return
	}
	if admit {
		respond(w, http.StatusCreated, issued)
	} else {
		respond(w, http.StatusOK, issued)
	}
}
