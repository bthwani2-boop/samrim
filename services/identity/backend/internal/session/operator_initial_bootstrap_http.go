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
	OperatorInitialRegistrationOptionsPath = "/v1/operators/passkey/bootstrap/options"
	OperatorInitialRegistrationFinishPath  = "/v1/operators/passkey/bootstrap"
)

type operatorInitialRegistrationHandler struct{ owner *OperatorPasskeyAuth }

func NewOperatorInitialRegistrationHandler(owner *OperatorPasskeyAuth) http.Handler {
	return &operatorInitialRegistrationHandler{owner: owner}
}

func parseInitialRegistrationBody(r io.Reader, finish bool) (string, string, json.RawMessage, error) {
	decoder := json.NewDecoder(r)
	start, err := decoder.Token()
	if err != nil || start != json.Delim('{') {
		return "", "", nil, ErrUnauthorized
	}
	var proof, ceremonyID string
	var credential json.RawMessage
	seen := map[string]bool{}
	for decoder.More() {
		field, e := decoder.Token()
		name, valid := field.(string)
		if e != nil || !valid || seen[name] {
			return "", "", nil, ErrUnauthorized
		}
		seen[name] = true
		switch name {
		case "proof":
			err = decoder.Decode(&proof)
		case "ceremonyId":
			if !finish {
				return "", "", nil, ErrUnauthorized
			}
			err = decoder.Decode(&ceremonyID)
		case "credential":
			if !finish {
				return "", "", nil, ErrUnauthorized
			}
			err = decoder.Decode(&credential)
		default:
			return "", "", nil, ErrUnauthorized
		}
		if err != nil {
			return "", "", nil, ErrUnauthorized
		}
	}
	end, err := decoder.Token()
	if err != nil || end != json.Delim('}') || !seen["proof"] {
		return "", "", nil, ErrUnauthorized
	}
	var extra any
	if err = decoder.Decode(&extra); err != io.EOF {
		return "", "", nil, ErrUnauthorized
	}
	if _, ok := decodeInitialProof(proof); !ok {
		return "", "", nil, ErrUnauthorized
	}
	if finish {
		if !seen["ceremonyId"] || !seen["credential"] || len(credential) == 0 ||
			string(credential) == "null" {
			return "", "", nil, ErrUnauthorized
		}
		if _, ok := decodeInitialProof(ceremonyID); !ok {
			return "", "", nil, ErrUnauthorized
		}
	} else if len(seen) != 1 {
		return "", "", nil, ErrUnauthorized
	}
	return proof, ceremonyID, credential, nil
}

func (h *operatorInitialRegistrationHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	noStore(w)
	start := r.URL.Path == OperatorInitialRegistrationOptionsPath
	finish := r.URL.Path == OperatorInitialRegistrationFinishPath
	if !start && !finish {
		respond(w, http.StatusNotFound, map[string]string{"error": "NOT_FOUND"})
		return
	}
	w.Header().Set("Allow", "POST")
	if r.Method != http.MethodPost {
		respond(w, http.StatusMethodNotAllowed, map[string]string{"error": "METHOD_NOT_ALLOWED"})
		return
	}
	// The token cannot travel in a URL, cookie, header impersonation field, or
	// cross-origin browser request. BFF checks same-origin before proxying.
	if r.URL.RawQuery != "" || r.URL.Fragment != "" ||
		len(r.Header.Values("Authorization")) > 0 ||
		len(r.Header.Values("X-Actor-ID")) > 0 ||
		len(r.Header.Values("X-Role")) > 0 ||
		strings.ToLower(strings.TrimSpace(r.Header.Get("Content-Type"))) != "application/json" ||
		r.ContentLength > 65536 || r.ContentLength == 0 {
		respond(w, http.StatusBadRequest, map[string]string{"error": "INVALID_REQUEST"})
		return
	}
	if h == nil || h.owner == nil || !h.owner.initialOwnerAvailable() {
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
		options, e := h.owner.BeginInitialOperatorRegistration(ctx, proof)
		switch {
		case errors.Is(e, ErrUnauthorized), errors.Is(e, ErrInitialOperatorBootstrapUnavailable):
			respond(w, http.StatusUnauthorized, map[string]string{"error": "UNAUTHORIZED"})
		case e != nil:
			respond(w, http.StatusServiceUnavailable, map[string]string{"error": "OWNER_UNAVAILABLE"})
		default:
			respond(w, http.StatusOK, options)
		}
		return
	}
	e := h.owner.FinishInitialOperatorRegistration(ctx, proof, ceremonyID, credential)
	switch {
	case errors.Is(e, ErrUnauthorized), errors.Is(e, ErrInitialOperatorBootstrapUnavailable):
		respond(w, http.StatusUnauthorized, map[string]string{"error": "UNAUTHORIZED"})
	case e != nil:
		respond(w, http.StatusServiceUnavailable, map[string]string{"error": "OWNER_UNAVAILABLE"})
	default:
		respond(w, http.StatusCreated, map[string]bool{"registered": true})
	}
}
