package captainstanding

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"mime"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
)

type interestWindow struct {
	start time.Time
	count int
}
type interestLimiter struct {
	sync.Mutex
	windows map[string]interestWindow
}

func (l *interestLimiter) allow(remote string) bool {
	address, _, err := net.SplitHostPort(remote)
	if err != nil {
		address = remote
	}
	now := time.Now()
	l.Lock()
	defer l.Unlock()
	if l.windows == nil {
		l.windows = make(map[string]interestWindow)
	}
	slot, exists := l.windows[address]
	if !exists || now.Sub(slot.start) >= 10*time.Minute {
		if len(l.windows) >= 4096 {
			for key, value := range l.windows {
				if now.Sub(value.start) >= 10*time.Minute {
					delete(l.windows, key)
				}
			}
			if len(l.windows) >= 4096 {
				return false
			}
		}
		slot = interestWindow{start: now}
	}
	if slot.count >= 120 {
		return false
	}
	slot.count++
	l.windows[address] = slot
	return true
}

type interestHTTPHandler struct {
	service *InterestService
	limiter interestLimiter
}

func NewInterestHTTPHandler(service *InterestService) http.Handler {
	return &interestHTTPHandler{service: service}
}
func interestUniqueMembers(raw []byte, allowed []string, required []string) bool {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	first, err := decoder.Token()
	if err != nil || first != json.Delim('{') {
		return false
	}
	seen := map[string]bool{}
	for decoder.More() {
		token, err := decoder.Token()
		name, ok := token.(string)
		if err != nil || !ok || seen[name] {
			return false
		}
		found := false
		for _, expected := range allowed {
			if name == expected {
				found = true
				break
			}
		}
		if !found {
			return false
		}
		seen[name] = true
		var value json.RawMessage
		if err := decoder.Decode(&value); err != nil {
			return false
		}
	}
	last, err := decoder.Token()
	if err != nil || last != json.Delim('}') {
		return false
	}
	if _, err = decoder.Token(); err != io.EOF {
		return false
	}
	for _, name := range required {
		if !seen[name] {
			return false
		}
	}
	return true
}
func interestBearer(request *http.Request) (string, error) {
	values := request.Header.Values("Authorization")
	if len(values) != 1 || !strings.HasPrefix(values[0], "Bearer ") {
		return "", ErrUnauthorized
	}
	bearer := strings.TrimPrefix(values[0], "Bearer ")
	if bearer == "" || strings.ContainsAny(bearer, " \r\n\t") {
		return "", ErrUnauthorized
	}
	return bearer, nil
}
func interestFilter(raw string) (InterestFilter, error) {
	result := InterestFilter{Limit: 20}
	if len(raw) > 512 {
		return InterestFilter{}, ErrInvalidChange
	}
	values, err := url.ParseQuery(raw)
	if err != nil {
		return InterestFilter{}, ErrInvalidChange
	}
	for key, list := range values {
		if len(list) != 1 || (key != "limit" && key != "before" && key != "city" &&
			key != "vehicle" && key != "contacted") {
			return InterestFilter{}, ErrInvalidChange
		}
		switch key {
		case "limit":
			result.Limit, err = strconv.Atoi(list[0])
			if err != nil || strconv.Itoa(result.Limit) != list[0] || result.Limit < 1 || result.Limit > 50 {
				return InterestFilter{}, ErrInvalidChange
			}
		case "before":
			result.BeforeID, err = strconv.ParseInt(list[0], 10, 64)
			if err != nil || result.BeforeID < 1 || strconv.FormatInt(result.BeforeID, 10) != list[0] {
				return InterestFilter{}, ErrInvalidChange
			}
		case "city":
			result.City = list[0]
		case "vehicle":
			result.VehicleType = list[0]
		case "contacted":
			if list[0] != "true" && list[0] != "false" {
				return InterestFilter{}, ErrInvalidChange
			}
			boolValue := list[0] == "true"
			result.Contacted = &boolValue
		}
	}
	return result, nil
}

type interestRoute struct {
	method       string
	submit, list bool
	contactID    int64
}

// Resolve exact owner paths without performing any lookup or mutation.
func resolveInterestRoute(path string) (interestRoute, bool) {
	switch path {
	case CaptainInterestPath:
		return interestRoute{method: http.MethodPost, submit: true}, true
	case OperatorCaptainInterestPath:
		return interestRoute{method: http.MethodGet, list: true}, true
	default:
		if !strings.HasPrefix(path, OperatorCaptainInterestPath+"/") || !strings.HasSuffix(path, "/contact") {
			return interestRoute{}, false
		}
		value := strings.TrimSuffix(strings.TrimPrefix(path, OperatorCaptainInterestPath+"/"), "/contact")
		id, err := strconv.ParseInt(value, 10, 64)
		if err != nil || id < 1 || strconv.FormatInt(id, 10) != value {
			id = 0
		}
		return interestRoute{method: http.MethodPatch, contactID: id}, true
	}
}

func (h *interestHTTPHandler) AllowsMethod(r *http.Request, method string) bool {
	route, ok := resolveInterestRoute(r.URL.Path)
	return h != nil && h.service != nil && ok && route.method == method &&
		(route.submit || route.list || route.contactID > 0)
}

func (h *interestHTTPHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Referrer-Policy", "no-referrer")
	if h == nil || h.service == nil {
		errorReply(w, ErrOwnerUnavailable)
		return
	}
	route, ok := resolveInterestRoute(r.URL.Path)
	if !ok {
		reply(w, http.StatusNotFound, map[string]string{"error": "NOT_FOUND"})
		return
	}
	isSubmit, isList, expected := route.submit, route.list, route.method
	w.Header().Set("Allow", expected)
	if r.Method != expected {
		reply(w, http.StatusMethodNotAllowed, map[string]string{"error": "METHOD_NOT_ALLOWED"})
		return
	}
	if !isList && r.URL.RawQuery != "" || isList && (r.ContentLength != 0 || len(r.TransferEncoding) > 0) {
		errorReply(w, ErrInvalidChange)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	if isSubmit {
		if !h.limiter.allow(r.RemoteAddr) {
			reply(w, http.StatusTooManyRequests, map[string]string{"error": "RATE_LIMITED"})
			return
		}
		typ, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
		if err != nil || typ != "application/json" {
			errorReply(w, ErrInvalidChange)
			return
		}
		raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 2048))
		allowed := []string{"name", "phone", "city", "district", "vehicleType", "plateRegistered", "phoneType", "experienced", "experienceDetails"}
		required := []string{"name", "phone", "city", "district", "vehicleType", "phoneType", "experienced"}
		if err != nil || !interestUniqueMembers(raw, allowed, required) {
			errorReply(w, ErrInvalidChange)
			return
		}
		var in InterestSubmission
		decoder := json.NewDecoder(bytes.NewReader(raw))
		decoder.DisallowUnknownFields()
		if decoder.Decode(&in) != nil {
			errorReply(w, ErrInvalidChange)
			return
		}
		if err = h.service.Submit(ctx, in); err != nil {
			errorReply(w, err)
			return
		}
		// Identical acknowledgment for new and duplicate phone numbers. No
		// status, applicant ID, approval or account is returned.
		reply(w, http.StatusAccepted, map[string]bool{"received": true})
		return
	}
	bearer, err := interestBearer(r)
	if err != nil {
		errorReply(w, err)
		return
	}
	if isList {
		filter, err := interestFilter(r.URL.RawQuery)
		if err != nil {
			errorReply(w, err)
			return
		}
		page, err := h.service.List(ctx, bearer, filter)
		if err != nil {
			errorReply(w, err)
			return
		}
		reply(w, http.StatusOK, page)
		return
	}
	id := route.contactID
	if id == 0 {
		errorReply(w, ErrInvalidChange)
		return
	}
	typ, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || typ != "application/json" {
		errorReply(w, ErrInvalidChange)
		return
	}
	raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 64))
	if err != nil || !interestUniqueMembers(raw, []string{"contacted"}, []string{"contacted"}) {
		errorReply(w, ErrInvalidChange)
		return
	}
	var change struct {
		Contacted bool `json:"contacted"`
	}
	if json.Unmarshal(raw, &change) != nil || !change.Contacted {
		errorReply(w, ErrInvalidChange)
		return
	}
	item, err := h.service.MarkContacted(ctx, bearer, id)
	if err != nil {
		errorReply(w, err)
		return
	}
	reply(w, http.StatusOK, item)
}
