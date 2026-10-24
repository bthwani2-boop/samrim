package transporthttp

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	share "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/notification"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

func (s *NotificationServer) registerClientShares(mux *http.ServeMux) {
	mux.HandleFunc("POST /dsh/client-shares", s.createClientShare)
	mux.HandleFunc("GET /dsh/client-shares", s.listClientShares)
	mux.HandleFunc("POST /dsh/client-shares/{shareId}/read", s.readClientShare)
	mux.HandleFunc("POST /dsh/client-shares/senders/{senderId}/block", s.blockClientShareSender)
	mux.HandleFunc("DELETE /dsh/client-shares/senders/{senderId}/block", s.unblockClientShareSender)
}

func clientShareBearer(w http.ResponseWriter, r *http.Request) string {
	token := bearerToken(r)
	if token == "" {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "client session required")
	}
	return token
}

func (s *NotificationServer) createClientShare(w http.ResponseWriter, r *http.Request) {
	token := clientShareBearer(w, r)
	if token == "" {
		return
	}
	idem := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	var input share.ClientShareRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	if err := s.service.SendClientShare(r.Context(), token, input, idem); err != nil {
		writeClientShareError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusAccepted, map[string]bool{"accepted": true})
}
func (s *NotificationServer) listClientShares(w http.ResponseWriter, r *http.Request) {
	token := clientShareBearer(w, r)
	if token == "" {
		return
	}
	before := int64(0)
	if raw := strings.TrimSpace(r.URL.Query().Get("before")); raw != "" {
		var err error
		before, err = strconv.ParseInt(raw, 10, 64)
		if err != nil || before < 1 {
			writeError(w, 400, "INVALID_INPUT", "before is invalid")
			return
		}
	}
	page, err := s.service.ListClientShares(r.Context(), token, before, 50)
	if err != nil {
		writeClientShareError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, 200, page)
}
func (s *NotificationServer) readClientShare(w http.ResponseWriter, r *http.Request) {
	token := clientShareBearer(w, r)
	if token == "" {
		return
	}
	id, err := strconv.ParseInt(r.PathValue("shareId"), 10, 64)
	if err != nil || id < 1 {
		writeError(w, 400, "INVALID_INPUT", "share ID invalid")
		return
	}
	if err = s.service.MarkClientShareRead(r.Context(), token, id); err != nil {
		writeClientShareError(w, err)
		return
	}
	writeJSON(w, 200, map[string]bool{"read": true})
}
func (s *NotificationServer) blockClientShareSender(w http.ResponseWriter, r *http.Request) {
	s.setClientShareSenderBlocked(w, r, true)
}
func (s *NotificationServer) unblockClientShareSender(w http.ResponseWriter, r *http.Request) {
	s.setClientShareSenderBlocked(w, r, false)
}
func (s *NotificationServer) setClientShareSenderBlocked(w http.ResponseWriter, r *http.Request, blocked bool) {
	token := clientShareBearer(w, r)
	if token == "" {
		return
	}
	if err := s.service.SetClientShareSenderBlocked(r.Context(), token, strings.TrimSpace(r.PathValue("senderId")), blocked); err != nil {
		writeClientShareError(w, err)
		return
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
}
func writeClientShareError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, share.ErrSessionForbidden):
		writeError(w, 403, "FORBIDDEN", "client session required")
	case errors.Is(err, postgres.ErrClientShareInvalid):
		writeError(w, 400, "INVALID_INPUT", "share input invalid or content unavailable")
	case errors.Is(err, postgres.ErrClientShareConflict):
		writeError(w, 409, "IDEMPOTENCY_CONFLICT", "request identity already used with different content")
	case errors.Is(err, postgres.ErrClientShareRateLimited):
		writeError(w, 429, "RATE_LIMITED", "sharing limit reached")
	case errors.Is(err, postgres.ErrClientShareNotFound):
		writeError(w, 404, "NOT_FOUND", "share not found")
	default:
		writeNotificationError(w, err)
	}
}
