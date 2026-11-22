package session

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"
)

const (
	OperatorPasskeyRecoveryOptionsPath = "/v1/operators/passkey/recovery/options"
	OperatorPasskeyRecoveryFinishPath  = "/v1/operators/passkey/recovery"
)

type operatorPasskeyRecoveryHandler struct{ owner *OperatorPasskeyAuth }

func NewOperatorPasskeyRecoveryHandler(owner *OperatorPasskeyAuth) http.Handler {
	return &operatorPasskeyRecoveryHandler{owner: owner}
}

// Recovery never selects an actor from client fields and never returns a
// bearer. A separate, owner-authorized offline issuance must precede this
// proof-bound ceremony.
func (h *operatorPasskeyRecoveryHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	noStore(w)
	start := r.URL.Path == OperatorPasskeyRecoveryOptionsPath
	finish := r.URL.Path == OperatorPasskeyRecoveryFinishPath
	if !start && !finish {
		respond(w, http.StatusNotFound, map[string]string{"error": "NOT_FOUND"})
		return
	}
	w.Header().Set("Allow", "POST")
	if r.Method != http.MethodPost {
		respond(w, http.StatusMethodNotAllowed, map[string]string{"error": "METHOD_NOT_ALLOWED"})
		return
	}
	if r.URL.RawQuery != "" || r.URL.Fragment != "" ||
		len(r.Header.Values("Authorization")) != 0 ||
		len(r.Header.Values("X-Actor-ID")) != 0 ||
		len(r.Header.Values("X-Role")) != 0 ||
		strings.ToLower(strings.TrimSpace(r.Header.Get("Content-Type"))) != "application/json" ||
		r.ContentLength == 0 || r.ContentLength > 65536 {
		respond(w, http.StatusBadRequest, map[string]string{"error": "INVALID_REQUEST"})
		return
	}
	if h == nil || h.owner == nil || !h.owner.recoveryAvailable() {
		respond(w, http.StatusServiceUnavailable, map[string]string{"error": "OWNER_UNAVAILABLE"})
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 65536)
	proof, ceremonyID, credential, err := parseInitialRegistrationBody(r.Body, finish)
	if err != nil {
		respond(w, http.StatusBadRequest, map[string]string{"error": "INVALID_REQUEST"})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	if start {
		options, e := h.owner.BeginRecovery(ctx, proof)
		switch {
		case errors.Is(e, ErrUnauthorized):
			respond(w, http.StatusUnauthorized, map[string]string{"error": "UNAUTHORIZED"})
		case e != nil:
			respond(w, http.StatusServiceUnavailable, map[string]string{"error": "OWNER_UNAVAILABLE"})
		default:
			respond(w, http.StatusOK, options)
		}
		return
	}
	err = h.owner.FinishRecovery(ctx, proof, ceremonyID, credential)
	switch {
	case errors.Is(err, ErrUnauthorized):
		respond(w, http.StatusUnauthorized, map[string]string{"error": "UNAUTHORIZED"})
	case err != nil:
		respond(w, http.StatusServiceUnavailable, map[string]string{"error": "OWNER_UNAVAILABLE"})
	default:
		respond(w, http.StatusOK, map[string]bool{"recovered": true})
	}
}
