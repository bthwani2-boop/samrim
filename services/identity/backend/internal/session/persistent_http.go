package session

import (
	"context"
	"errors"
	"net/http"
	"time"
)

// Dedicated session lifecycle endpoints. Tokens are accepted only in one
// Authorization header, never URL parameters, JSON or browser-visible logs.
type persistentHTTP struct{ owner PersistentOwner }

func NewPersistentSessionHandler(owner PersistentOwner) http.Handler {
	return &persistentHTTP{owner: owner}
}

const PersistentStartPath = "/v1/sessions/persistent"
const PersistentRefreshPath = "/v1/sessions/refresh"

func (h *persistentHTTP) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	noStore(w)
	w.Header().Set("Pragma", "no-cache")
	w.Header().Set("X-Frame-Options", "DENY")
	if r.URL.Path != PersistentStartPath && r.URL.Path != PersistentRefreshPath {
		respond(w, http.StatusNotFound, map[string]string{"error": "NOT_FOUND"})
		return
	}
	start := r.URL.Path == PersistentStartPath
	if start {
		w.Header().Set("Allow", "POST")
	} else {
		w.Header().Set("Allow", "POST, DELETE")
	}
	if (start && r.Method != http.MethodPost) || (!start && r.Method != http.MethodPost && r.Method != http.MethodDelete) {
		respond(w, http.StatusMethodNotAllowed, map[string]string{"error": "METHOD_NOT_ALLOWED"})
		return
	}
	if r.URL.RawQuery != "" || r.ContentLength != 0 || len(r.TransferEncoding) > 0 ||
		r.Header.Get("Content-Type") != "" {
		respond(w, http.StatusBadRequest, map[string]string{"error": "INVALID_REQUEST"})
		return
	}
	headers := r.Header.Values("Authorization")
	if len(headers) != 1 {
		w.Header().Set("WWW-Authenticate", `Bearer realm="identity"`)
		respond(w, http.StatusUnauthorized, map[string]string{"error": "UNAUTHORIZED"})
		return
	}
	digest, err := bearerDigest(headers[0])
	if err != nil {
		w.Header().Set("WWW-Authenticate", `Bearer realm="identity"`)
		respond(w, http.StatusUnauthorized, map[string]string{"error": "UNAUTHORIZED"})
		return
	}
	if h == nil || h.owner == nil {
		respond(w, http.StatusServiceUnavailable, map[string]string{"error": "OWNER_UNAVAILABLE"})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()
	var result any
	status := http.StatusOK
	switch {
	case start:
		result, err = h.owner.StartPersistent(ctx, digest)
		status = http.StatusCreated
	case r.Method == http.MethodPost:
		result, err = h.owner.RotatePersistent(ctx, digest)
	default:
		err = h.owner.EndPersistent(ctx, digest)
		status = http.StatusNoContent
	}
	if errors.Is(err, ErrUnauthorized) {
		w.Header().Set("WWW-Authenticate", `Bearer realm="identity"`)
		respond(w, http.StatusUnauthorized, map[string]string{"error": "UNAUTHORIZED"})
		return
	}
	if errors.Is(err, ErrPersistenceExists) || errors.Is(err, ErrRecentRefreshConflict) {
		respond(w, http.StatusConflict, map[string]string{"error": "CONFLICT"})
		return
	}
	if err != nil {
		respond(w, http.StatusServiceUnavailable, map[string]string{"error": "OWNER_UNAVAILABLE"})
		return
	}
	if status == http.StatusNoContent {
		w.WriteHeader(status)
		return
	}
	respond(w, status, result)
}
