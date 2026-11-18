package session

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"strings"
	"time"
)

const operatorPermissionManagementPrefix = "/v1/operators/"

// OperatorPermissionManager is implemented only by the canonical Identity
// owner. A transport cannot mint a principal or select the bootstrap actor.
type OperatorPermissionManager interface {
	ManageOperatorPermission(context.Context, string, OperatorPermissionCommand) (OperatorPermissionResult, error)
}

type OperatorPermissionManagementHandler struct {
	owner OperatorPermissionManager
}

func NewOperatorPermissionManagementHandler(owner OperatorPermissionManager) http.Handler {
	return &OperatorPermissionManagementHandler{owner: owner}
}

// Reject ambiguous JSON keys and unknown fields in privileged mutations.
// encoding/json's ordinary struct decoder silently accepts duplicate keys.
func decodeOperatorPermissionPayload(body io.Reader, target, permission string) (OperatorPermissionCommand, error) {
	command := OperatorPermissionCommand{TargetActorID: target, Permission: permission}
	decoder := json.NewDecoder(body)
	start, err := decoder.Token()
	if err != nil || start != json.Delim('{') {
		return OperatorPermissionCommand{}, ErrOperatorAdminInvalid
	}
	seen := make(map[string]bool, 4)
	for decoder.More() {
		keyToken, err := decoder.Token()
		if err != nil {
			return OperatorPermissionCommand{}, ErrOperatorAdminInvalid
		}
		key, ok := keyToken.(string)
		if !ok || seen[key] {
			return OperatorPermissionCommand{}, ErrOperatorAdminInvalid
		}
		seen[key] = true
		switch key {
		case "state":
			err = decoder.Decode(&command.State)
		case "operationId":
			err = decoder.Decode(&command.OperationID)
		case "reason":
			err = decoder.Decode(&command.Reason)
		case "expectedVersion":
			var raw json.RawMessage
			if err = decoder.Decode(&raw); err == nil {
				if string(raw) == "null" {
					return OperatorPermissionCommand{}, ErrOperatorAdminInvalid
				}
				err = json.Unmarshal(raw, &command.ExpectedVersion)
			}
		default:
			return OperatorPermissionCommand{}, ErrOperatorAdminInvalid
		}
		if err != nil {
			return OperatorPermissionCommand{}, ErrOperatorAdminInvalid
		}
	}
	closeToken, err := decoder.Token()
	if err != nil || closeToken != json.Delim('}') {
		return OperatorPermissionCommand{}, ErrOperatorAdminInvalid
	}
	var extra any
	if err = decoder.Decode(&extra); err != io.EOF {
		return OperatorPermissionCommand{}, ErrOperatorAdminInvalid
	}
	for _, required := range []string{"state", "expectedVersion", "operationId", "reason"} {
		if !seen[required] {
			return OperatorPermissionCommand{}, ErrOperatorAdminInvalid
		}
	}
	if err = validateOperatorPermissionCommand(command); err != nil {
		return OperatorPermissionCommand{}, err
	}
	return command, nil
}

func (h *OperatorPermissionManagementHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	noStore(w)
	const maxBody = 2048
	if r.Method != http.MethodPatch {
		w.Header().Set("Allow", "PATCH")
		respond(w, http.StatusMethodNotAllowed, map[string]string{"error": "METHOD_NOT_ALLOWED"})
		return
	}
	if r.URL.RawQuery != "" || r.URL.Fragment != "" {
		respond(w, http.StatusBadRequest, map[string]string{"error": "INVALID_REQUEST"})
		return
	}
	remainder, valid := strings.CutPrefix(r.URL.Path, operatorPermissionManagementPrefix)
	parts := strings.Split(remainder, "/")
	if !valid || len(parts) != 3 || parts[1] != "permissions" ||
		!operatorAdminID.MatchString(parts[0]) || !isOperatorPermission(parts[2]) {
		respond(w, http.StatusNotFound, map[string]string{"error": "NOT_FOUND"})
		return
	}
	if r.ContentLength > maxBody {
		respond(w, http.StatusBadRequest, map[string]string{"error": "INVALID_REQUEST"})
		return
	}
	mediaType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || mediaType != "application/json" {
		respond(w, http.StatusBadRequest, map[string]string{"error": "INVALID_REQUEST"})
		return
	}
	authorizations := r.Header.Values("Authorization")
	if len(authorizations) != 1 {
		w.Header().Set("WWW-Authenticate", `Bearer realm="identity"`)
		respond(w, http.StatusUnauthorized, map[string]string{"error": "UNAUTHORIZED"})
		return
	}
	// Even if a future caller injects a permissive manager implementation,
	// malformed credentials never pass through the mutation transport.
	if _, err = bearerDigest(authorizations[0]); err != nil {
		w.Header().Set("WWW-Authenticate", `Bearer realm="identity"`)
		respond(w, http.StatusUnauthorized, map[string]string{"error": "UNAUTHORIZED"})
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxBody)
	cmd, err := decodeOperatorPermissionPayload(r.Body, parts[0], parts[2])
	if err != nil {
		respond(w, http.StatusBadRequest, map[string]string{"error": "INVALID_REQUEST"})
		return
	}
	if h == nil || h.owner == nil {
		respond(w, http.StatusServiceUnavailable, map[string]string{"error": "OWNER_UNAVAILABLE"})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()
	result, err := h.owner.ManageOperatorPermission(ctx, authorizations[0], cmd)
	switch {
	case errors.Is(err, ErrUnauthorized):
		w.Header().Set("WWW-Authenticate", `Bearer realm="identity"`)
		respond(w, http.StatusUnauthorized, map[string]string{"error": "UNAUTHORIZED"})
	case errors.Is(err, ErrOperatorAdminForbidden), errors.Is(err, ErrForbidden):
		respond(w, http.StatusForbidden, map[string]string{"error": "FORBIDDEN"})
	case errors.Is(err, ErrOperatorAdminTargetNotFound):
		respond(w, http.StatusNotFound, map[string]string{"error": "NOT_FOUND"})
	case errors.Is(err, ErrOperatorAdminConflict):
		respond(w, http.StatusConflict, map[string]string{"error": "CONFLICT"})
	case errors.Is(err, ErrOperatorAdminInvalid):
		respond(w, http.StatusBadRequest, map[string]string{"error": "INVALID_REQUEST"})
	case err != nil:
		respond(w, http.StatusServiceUnavailable, map[string]string{"error": "OWNER_UNAVAILABLE"})
	default:
		respond(w, http.StatusOK, result)
	}
}
