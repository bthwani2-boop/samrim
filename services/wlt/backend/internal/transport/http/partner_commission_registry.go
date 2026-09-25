package http

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/bthwani2-boop/samrim/services/wlt/backend/internal/storage/postgres"
)

type partnerCommissionRegistryCursor struct {
	Search       string `json:"search"`
	Sort         string `json:"sort"`
	AfterActorID string `json:"afterActorId"`
}

func (s *Server) listPartnerCommissionReceivables(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) || !s.requireActingOperator(w, r) {
		return
	}
	search := strings.TrimSpace(r.URL.Query().Get("search"))
	sortKey := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("sort")))
	if sortKey == "" {
		sortKey = "actor_asc"
	}
	if utf8.RuneCountInString(search) > 128 || !postgres.ValidPartnerCommissionRegistrySort(sortKey) {
		writeSettlementError(w, postgres.ErrPartnerCommissionRegistryInput)
		return
	}
	limit := 50
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 || parsed > 100 {
			writeSettlementError(w, postgres.ErrPartnerCommissionRegistryInput)
			return
		}
		limit = parsed
	}
	afterActorID := ""
	if raw := strings.TrimSpace(r.URL.Query().Get("cursor")); raw != "" {
		decoded, err := base64.RawURLEncoding.DecodeString(raw)
		var cursor partnerCommissionRegistryCursor
		if err != nil || len(decoded) > 768 || json.Unmarshal(decoded, &cursor) != nil || cursor.Search != search || cursor.Sort != sortKey || cursor.AfterActorID == "" || len(cursor.AfterActorID) > 128 {
			writeSettlementError(w, postgres.ErrPartnerCommissionRegistryInput)
			return
		}
		afterActorID = cursor.AfterActorID
	}
	items, hasMore, err := postgres.ListPartnerCommissionReceivables(r.Context(), s.db, search, sortKey, afterActorID, limit)
	if err != nil {
		writeSettlementError(w, err)
		return
	}
	responseItems := make([]map[string]any, 0, len(items))
	for _, item := range items {
		responseItems = append(responseItems, map[string]any{
			"partnerActorId":                       item.PartnerActorID,
			"currency":                             item.Currency,
			"outstandingCommissionReceivableMinor": item.OutstandingCommissionReceivableMinor,
			"profileState":                         item.ProfileState,
		})
	}
	response := map[string]any{"items": responseItems, "limit": limit}
	if hasMore && len(items) > 0 {
		cursorBytes, err := json.Marshal(partnerCommissionRegistryCursor{Search: search, Sort: sortKey, AfterActorID: items[len(items)-1].PartnerActorID})
		if err != nil {
			writeSettlementError(w, err)
			return
		}
		response["nextCursor"] = base64.RawURLEncoding.EncodeToString(cursorBytes)
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, response)
}
