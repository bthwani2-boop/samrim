package session

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"
)

const (
	OperatorPasskeyOptionsPath = "/v1/operators/passkey/authentication/options"
	OperatorPasskeyFinishPath  = "/v1/operators/passkey/authentication"
)

type operatorPasskeyHandler struct{ owner *OperatorPasskeyAuth }

func NewOperatorPasskeyHandler(owner *OperatorPasskeyAuth) http.Handler {
	return &operatorPasskeyHandler{owner: owner}
}

func (h *operatorPasskeyHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	noStore(w)
	start := r.URL.Path == OperatorPasskeyOptionsPath
	finish := r.URL.Path == OperatorPasskeyFinishPath
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
		len(r.Header.Values("Authorization")) > 0 ||
		len(r.Header.Values("X-Actor-ID")) > 0 {
		respond(w, http.StatusBadRequest, map[string]string{"error": "INVALID_REQUEST"})
		return
	}
	if h == nil || h.owner == nil {
		respond(w, http.StatusServiceUnavailable, map[string]string{"error": "OWNER_UNAVAILABLE"})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	if start {
		if r.ContentLength != 0 || len(r.TransferEncoding) != 0 {
			respond(w, http.StatusBadRequest, map[string]string{"error": "INVALID_REQUEST"})
			return
		}
		options, err := h.owner.Begin(ctx)
		if err != nil {
			respond(w, http.StatusServiceUnavailable, map[string]string{"error": "OWNER_UNAVAILABLE"})
			return
		}
		respond(w, http.StatusOK, options)
		return
	}
	if r.ContentLength > 65536 || r.ContentLength == 0 {
		respond(w, http.StatusBadRequest, map[string]string{"error": "INVALID_REQUEST"})
		return
	}
	if strings.ToLower(strings.TrimSpace(r.Header.Get("Content-Type"))) != "application/json" {
		respond(w, http.StatusBadRequest, map[string]string{"error": "INVALID_REQUEST"})
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 65536)
	// Reject duplicate / unknown top-level request keys, never allow a
	// client-asserted actor or role. The WebAuthn library validates the
	// contained authenticator assertion (COSE signature + ceremony binding).
	dec := json.NewDecoder(r.Body)
	first, err := dec.Token()
	if err != nil || first != json.Delim('{') {
		respond(w, http.StatusBadRequest, map[string]string{"error": "INVALID_REQUEST"})
		return
	}
	var ceremonyID string
	var assertion json.RawMessage
	seen := map[string]bool{}
	for dec.More() {
		name, err := dec.Token()
		if err != nil {
			break
		}
		key, ok := name.(string)
		if !ok || seen[key] {
			err = ErrUnauthorized
			break
		}
		seen[key] = true
		switch key {
		case "ceremonyId":
			err = dec.Decode(&ceremonyID)
		case "credential":
			err = dec.Decode(&assertion)
		default:
			err = ErrUnauthorized
		}
		if err != nil {
			break
		}
	}
	if err != nil {
		respond(w, http.StatusBadRequest, map[string]string{"error": "INVALID_REQUEST"})
		return
	}
	closing, err := dec.Token()
	if err != nil || closing != json.Delim('}') || !seen["ceremonyId"] ||
		!seen["credential"] || len(assertion) == 0 {
		respond(w, http.StatusBadRequest, map[string]string{"error": "INVALID_REQUEST"})
		return
	}
	if err = dec.Decode(new(any)); err != io.EOF {
		respond(w, http.StatusBadRequest, map[string]string{"error": "INVALID_REQUEST"})
		return
	}
	issued, err := h.owner.Finish(ctx, ceremonyID, assertion)
	switch {
	case errors.Is(err, ErrUnauthorized):
		respond(w, http.StatusUnauthorized, map[string]string{"error": "UNAUTHORIZED"})
	case err != nil:
		respond(w, http.StatusServiceUnavailable, map[string]string{"error": "OWNER_UNAVAILABLE"})
	default:
		respond(w, http.StatusOK, issued)
	}
}
