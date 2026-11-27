package captainstanding

import (
	"context"
	"encoding/json"
	"encoding/json/jsontext"
	jsonv2 "encoding/json/v2"
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

// Decode the complete bounded command representation before any owner effect.
// Native JSON v2 rejects duplicate names, malformed Unicode and case-mismatched
// members. Presence and null are checked separately from Go zero values.
func decodeCaptainCommand(w http.ResponseWriter, r *http.Request, limit int64, dst any, required ...string) error {
	media := r.Header.Values("Content-Type")
	if len(media) != 1 || len(r.Header.Values("Content-Encoding")) != 0 ||
		r.URL.RawQuery != "" || r.URL.ForceQuery || r.Body == nil || r.ContentLength > limit {
		return ErrInvalidChange
	}
	kind, params, err := mime.ParseMediaType(media[0])
	if err != nil || kind != "application/json" {
		return ErrInvalidChange
	}
	for key, value := range params {
		if key != "charset" || !strings.EqualFold(value, "utf-8") {
			return ErrInvalidChange
		}
	}
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, limit))
	if err != nil {
		return ErrInvalidChange
	}
	var members map[string]jsontext.Value
	if jsonv2.Unmarshal(body, &members) != nil || members == nil {
		return ErrInvalidChange
	}
	for _, value := range members {
		if strings.TrimSpace(string(value)) == "null" {
			return ErrInvalidChange
		}
	}
	for _, name := range required {
		if _, ok := members[name]; !ok {
			return ErrInvalidChange
		}
	}
	if jsonv2.Unmarshal(body, dst, jsonv2.RejectUnknownMembers(true)) != nil {
		return ErrInvalidChange
	}
	return nil
}

func captainBearer(r *http.Request) (string, error) {
	values := r.Header.Values("Authorization")
	if len(values) != 1 || !strings.HasPrefix(values[0], "Bearer ") {
		return "", ErrUnauthorized
	}
	bearer := strings.TrimPrefix(values[0], "Bearer ")
	if bearer == "" || strings.ContainsAny(bearer, " \r\n\t") {
		return "", ErrUnauthorized
	}
	return bearer, nil
}

func captainBodyless(r *http.Request) bool {
	return r.ContentLength == 0 && len(r.TransferEncoding) == 0 &&
		len(r.Header.Values("Content-Encoding")) == 0
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
	if (!operatorList && (r.URL.RawQuery != "" || r.URL.ForceQuery)) || (r.Method != http.MethodPatch && !captainBodyless(r)) {
		errorReply(w, ErrInvalidChange)
		return
	}
	bearer, err := captainBearer(r)
	if err != nil {
		errorReply(w, err)
		return
	}
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
		var input struct {
			Status          Status `json:"status"`
			ExpectedVersion int64  `json:"expectedVersion"`
			OperationID     string `json:"operationId"`
			Reason          string `json:"reason"`
		}
		if err := decodeCaptainCommand(w, r, 2048, &input, "status", "expectedVersion", "operationId", "reason"); err != nil {
			errorReply(w, err)
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
