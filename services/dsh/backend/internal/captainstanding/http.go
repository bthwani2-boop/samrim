package captainstanding

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"strings"
	"time"
)

const (
	CaptainStandingPath    = "/v1/captains/me/standing"
	CaptainEligibilityPath = "/v1/actors/me/captain-eligibility"
	CaptainApplicationPath = "/v1/actors/me/captain-application"
	OperatorCaptainsPath   = "/v1/operators/captains"
	operatorCaptainPrefix  = "/v1/operators/captains/"
)

type HTTPHandler struct{ service *Service }

func NewHTTPHandler(s *Service) http.Handler { return &HTTPHandler{service: s} }

func reply(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func errorReply(w http.ResponseWriter, err error) {
	code, status := "OWNER_UNAVAILABLE", http.StatusServiceUnavailable
	switch {
	case errors.Is(err, ErrUnauthorized):
		code, status = "UNAUTHORIZED", http.StatusUnauthorized
		w.Header().Set("WWW-Authenticate", `Bearer realm="dsh"`)
	case errors.Is(err, ErrForbidden):
		code, status = "FORBIDDEN", http.StatusForbidden
	case errors.Is(err, ErrNotEligible):
		code, status = "CAPTAIN_NOT_ELIGIBLE", http.StatusForbidden
	case errors.Is(err, ErrNotFound):
		code, status = "NOT_FOUND", http.StatusNotFound
	case errors.Is(err, ErrInvalidChange):
		code, status = "INVALID_REQUEST", http.StatusBadRequest
	case errors.Is(err, ErrUnknownResult):
		code, status = "OPERATION_RESULT_UNKNOWN", http.StatusServiceUnavailable
	case errors.Is(err, ErrVersionConflict):
		code, status = "CAPTAIN_STANDING_VERSION_CONFLICT", http.StatusConflict
	}
	reply(w, status, map[string]string{"error": code})
}

// Duplicate critical JSON fields are ambiguous; encoding/json v1 silently
// accepts them, so reject duplicate top-level members before decoding.
func uniqueObjectMembers(raw []byte) bool {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	start, err := decoder.Token()
	if err != nil || start != json.Delim('{') {
		return false
	}
	seen := map[string]bool{}
	for decoder.More() {
		token, err := decoder.Token()
		key, ok := token.(string)
		if err != nil || !ok || seen[key] ||
			(key != "status" && key != "expectedVersion" &&
				key != "operationId" && key != "reason") {
			return false
		}
		seen[key] = true
		var value json.RawMessage
		if err := decoder.Decode(&value); err != nil {
			return false
		}
	}
	end, err := decoder.Token()
	if err != nil || end != json.Delim('}') {
		return false
	}
	_, err = decoder.Token()
	return err == io.EOF
}

// standingRoute is the authoritative admission decision for both the HTTP
// handler and its browser preflight. It never resolves Identity or accesses SQL.
type standingRoute struct {
	method, role, operatorID string
	operatorList             bool
}

func resolveStandingRoute(path, method string) (standingRoute, bool) {
	switch path {
	case CaptainStandingPath:
		return standingRoute{method: http.MethodGet, role: "captain"}, true
	case CaptainEligibilityPath:
		return standingRoute{method: http.MethodGet, role: "customer"}, true
	case CaptainApplicationPath:
		expected := http.MethodPost
		if method == http.MethodGet {
			expected = http.MethodGet
		}
		return standingRoute{method: expected, role: "customer"}, true
	case OperatorCaptainsPath:
		return standingRoute{method: http.MethodGet, operatorList: true}, true
	default:
		if !strings.HasPrefix(path, operatorCaptainPrefix) || !strings.HasSuffix(path, "/standing") {
			return standingRoute{}, false
		}
		id := strings.TrimSuffix(strings.TrimPrefix(path, operatorCaptainPrefix), "/standing")
		if !validActorID(id) || strings.Contains(id, "/") {
			return standingRoute{}, false
		}
		expected := http.MethodPatch
		if method == http.MethodGet {
			if !reviewActorID(id) {
				return standingRoute{}, false
			}
			expected = http.MethodGet
		}
		return standingRoute{method: expected, operatorID: id}, true
	}
}

// AllowsMethod implements the side-effect-free owner route admission contract.
func (h *HTTPHandler) AllowsMethod(r *http.Request, method string) bool {
	route, ok := resolveStandingRoute(r.URL.Path, method)
	return h != nil && h.service != nil && ok && route.method == method
}

func (h *HTTPHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Referrer-Policy", "no-referrer")
	if h == nil || h.service == nil {
		errorReply(w, ErrOwnerUnavailable)
		return
	}
	route, ok := resolveStandingRoute(r.URL.Path, r.Method)
	if !ok {
		reply(w, http.StatusNotFound, map[string]string{"error": "NOT_FOUND"})
		return
	}
	expectedMethod, role, operatorID, operatorList := route.method, route.role, route.operatorID, route.operatorList
	w.Header().Set("Allow", expectedMethod)
	if r.URL.Path == CaptainApplicationPath {
		w.Header().Set("Allow", "GET, POST")
	}
	if operatorID != "" {
		w.Header().Set("Allow", "GET, PATCH")
	}
	if r.Method != expectedMethod {
		reply(w, http.StatusMethodNotAllowed, map[string]string{"error": "METHOD_NOT_ALLOWED"})
		return
	}
	if (!operatorList && r.URL.RawQuery != "") || (r.Method != http.MethodPatch && (r.ContentLength != 0 || len(r.TransferEncoding) > 0)) {
		errorReply(w, ErrInvalidChange)
		return
	}
	headers := r.Header.Values("Authorization")
	if len(headers) != 1 || !strings.HasPrefix(headers[0], "Bearer ") {
		errorReply(w, ErrUnauthorized)
		return
	}
	bearer := strings.TrimPrefix(headers[0], "Bearer ")
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()
	if operatorList {
		status, limit, cursor, err := parseReviewQuery(r.URL.RawQuery)
		if err != nil {
			errorReply(w, err)
			return
		}
		page, err := h.service.ListForOperator(ctx, bearer, status, limit, cursor)
		if err != nil {
			errorReply(w, err)
			return
		}
		reply(w, http.StatusOK, page)
		return
	}
	var standing Standing
	var err error
	switch expectedMethod {
	case http.MethodGet:
		if r.URL.Path == CaptainApplicationPath {
			standing, err = h.service.ReadSelfApplication(ctx, bearer)
		} else if operatorID != "" {
			standing, err = h.service.ReadForOperator(ctx, bearer, operatorID)
		} else {
			standing, err = h.service.ReadSelf(ctx, bearer, role)
		}
	case http.MethodPost:
		standing, err = h.service.Apply(ctx, bearer)
	case http.MethodPatch:
		mediaType, _, mediaErr := mime.ParseMediaType(r.Header.Get("Content-Type"))
		if mediaErr != nil || mediaType != "application/json" {
			errorReply(w, ErrInvalidChange)
			return
		}
		var input struct {
			Status          Status `json:"status"`
			ExpectedVersion int64  `json:"expectedVersion"`
			OperationID     string `json:"operationId"`
			Reason          string `json:"reason"`
		}
		raw, readErr := io.ReadAll(http.MaxBytesReader(w, r.Body, 2048))
		if readErr != nil || !uniqueObjectMembers(raw) {
			errorReply(w, ErrInvalidChange)
			return
		}
		decoder := json.NewDecoder(bytes.NewReader(raw))
		decoder.DisallowUnknownFields()
		if decoder.Decode(&input) != nil {
			errorReply(w, ErrInvalidChange)
			return
		}
		standing, err = h.service.Change(ctx, bearer, Change{
			ActorID: operatorID, Status: input.Status, ExpectedVersion: input.ExpectedVersion,
			OperationID: input.OperationID, Reason: input.Reason,
		})
	}
	if err != nil {
		errorReply(w, err)
		return
	}
	reply(w, http.StatusOK, standing)
}
