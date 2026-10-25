package http

import (
	"encoding/base64"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/bthwani2-boop/samrim/services/wlt/backend/internal/storage/postgres"
)

func (s *Server) readPartnerActivity(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	owner := strings.TrimSpace(r.PathValue("partnerActorId"))
	values := r.URL.Query()
	rawCursor := strings.TrimSpace(values.Get("cursor"))
	query := postgres.PartnerActivityQuery{
		StoreIDs: values["storeId"], Kind: values.Get("kind"), Status: values.Get("status"),
		PaymentMethod: values.Get("paymentMethod"), Search: values.Get("search"), Limit: 30,
	}
	if raw := values.Get("limit"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil {
			writeError(w, 400, "INVALID_INPUT", "limit is invalid")
			return
		}
		query.Limit = n
	}
	if raw := values.Get("from"); raw != "" {
		parsed, err := time.Parse("2006-01-02", raw)
		if err != nil {
			writeError(w, 400, "INVALID_INPUT", "from must be a date")
			return
		}
		query.From = parsed.Add(-3 * time.Hour) // Yemen-local calendar day
	}
	if raw := values.Get("to"); raw != "" {
		parsed, err := time.Parse("2006-01-02", raw)
		if err != nil {
			writeError(w, 400, "INVALID_INPUT", "to must be a date")
			return
		}
		query.To = parsed.AddDate(0, 0, 1).Add(-3 * time.Hour) // exclusive Yemen-local day
	}
	if rawCursor != "" {
		decoded, err := base64.RawURLEncoding.DecodeString(rawCursor)
		parts := strings.SplitN(string(decoded), "|", 3)
		if err != nil || len(parts) != 3 {
			writeError(w, 400, "INVALID_INPUT", "cursor is invalid")
			return
		}
		parsed, err := time.Parse(time.RFC3339Nano, parts[0])
		if err != nil {
			writeError(w, 400, "INVALID_INPUT", "cursor date is invalid")
			return
		}
		query.CursorAt = &parsed
		query.CursorKind = parts[1]
		query.CursorID = parts[2]
	}
	page, err := postgres.ListPartnerActivity(r.Context(), s.db, owner, query)
	if err != nil {
		if err == postgres.ErrPartnerActivityInput {
			writeError(w, 400, "INVALID_INPUT", "activity query is invalid")
			return
		}
		writeError(w, 500, "FINANCE_UNAVAILABLE", "partner activity unavailable")
		return
	}
	response := map[string]any{"items": page.Items}
	if page.NextCursor != "" {
		response["nextCursor"] = base64.RawURLEncoding.EncodeToString([]byte(page.NextCursor))
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, 200, response)
}
