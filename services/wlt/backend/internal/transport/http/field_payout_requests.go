package http

import (
	"encoding/base64"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/bthwani2-boop/samrim/services/wlt/backend/internal/storage/postgres"
)

type fieldPayoutRequestJSON struct {
	Status      string `json:"status"`
	AmountMinor int64  `json:"amountMinor"`
	Currency    string `json:"currency"`
	CreatedAt   string `json:"createdAt"`
}

type fieldPayoutRequestPageJSON struct {
	Requests   []fieldPayoutRequestJSON `json:"requests"`
	NextCursor string                   `json:"nextCursor,omitempty"`
	Limit      int                      `json:"limit"`
}

func (s *Server) listFieldPayoutRequests(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	fieldActorID := strings.TrimSpace(r.PathValue("fieldActorId"))
	if fieldActorID == "" || len(fieldActorID) > 128 {
		writePayoutError(w, postgres.ErrPayoutInvalidInput)
		return
	}
	limit := 50
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 || parsed > 100 {
			writePayoutError(w, postgres.ErrPayoutInvalidInput)
			return
		}
		limit = parsed
	}
	var cursorAt *time.Time
	cursorID := ""
	if raw := strings.TrimSpace(r.URL.Query().Get("cursor")); raw != "" {
		if len(raw) > 512 {
			writePayoutError(w, postgres.ErrPayoutInvalidInput)
			return
		}
		decoded, err := base64.RawURLEncoding.DecodeString(raw)
		parts := strings.SplitN(string(decoded), "|", 2)
		if err != nil || len(parts) != 2 || strings.TrimSpace(parts[1]) == "" || len(parts[1]) > 128 {
			writePayoutError(w, postgres.ErrPayoutInvalidInput)
			return
		}
		parsed, err := time.Parse(time.RFC3339Nano, parts[0])
		if err != nil {
			writePayoutError(w, postgres.ErrPayoutInvalidInput)
			return
		}
		cursorAt, cursorID = &parsed, parts[1]
	}
	page, err := postgres.ListFieldPayoutRequestHistory(r.Context(), s.db, fieldActorID, cursorAt, cursorID, limit)
	if err != nil {
		writePayoutError(w, err)
		return
	}
	requests := make([]fieldPayoutRequestJSON, 0, len(page.Requests))
	for _, item := range page.Requests {
		requests = append(requests, fieldPayoutRequestJSON{Status: item.Status, AmountMinor: item.AmountMinor, Currency: item.Currency, CreatedAt: item.CreatedAt.UTC().Format(time.RFC3339Nano)})
	}
	response := fieldPayoutRequestPageJSON{Requests: requests, Limit: limit}
	if page.NextCursor != "" {
		response.NextCursor = base64.RawURLEncoding.EncodeToString([]byte(page.NextCursor))
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, response)
}
