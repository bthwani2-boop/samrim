package http

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/bthwani2-boop/samrim/services/wlt/backend/internal/storage/postgres"
)

type cashLiabilityRegistryCursor struct {
	Search          string `json:"search"`
	Sort            string `json:"sort"`
	CollectedAt     string `json:"collectedAt"`
	PaymentIntentID string `json:"paymentIntentId"`
}

func (s *Server) operatorCashLiability(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	search := strings.TrimSpace(r.URL.Query().Get("search"))
	sort := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("sort")))
	if sort == "" {
		sort = "collected_asc"
	}
	if utf8.RuneCountInString(search) > 128 || (sort != "collected_asc" && sort != "collected_desc") {
		writePaymentError(w, postgres.ErrRemittanceInvalidInput)
		return
	}
	limit := 50
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 || parsed > 100 {
			writePaymentError(w, postgres.ErrRemittanceInvalidInput)
			return
		}
		limit = parsed
	}
	var afterCollectedAt *time.Time
	afterPaymentIntentID := ""
	if raw := strings.TrimSpace(r.URL.Query().Get("cursor")); raw != "" {
		if len(raw) > 1024 {
			writePaymentError(w, postgres.ErrRemittanceInvalidInput)
			return
		}
		decoded, err := base64.RawURLEncoding.DecodeString(raw)
		var cursor cashLiabilityRegistryCursor
		if err != nil || len(decoded) > 768 || json.Unmarshal(decoded, &cursor) != nil || cursor.Search != search || cursor.Sort != sort || cursor.PaymentIntentID == "" || len(cursor.PaymentIntentID) > 128 {
			writePaymentError(w, postgres.ErrRemittanceInvalidInput)
			return
		}
		parsed, err := time.Parse(time.RFC3339Nano, cursor.CollectedAt)
		if err != nil {
			writePaymentError(w, postgres.ErrRemittanceInvalidInput)
			return
		}
		afterCollectedAt = &parsed
		afterPaymentIntentID = cursor.PaymentIntentID
	}
	result, err := postgres.ListCashLiabilityRegistry(r.Context(), s.db, search, sort, afterCollectedAt, afterPaymentIntentID, limit)
	if err != nil {
		writePaymentError(w, err)
		return
	}
	items := make([]cashLiabilityItemJSON, 0, len(result.Items))
	for _, item := range result.Items {
		items = append(items, cashLiabilityItemJSON{PaymentIntentID: item.PaymentIntentID, ExternalReference: item.ExternalReference, CaptainActorID: item.CaptainActorID, AmountMinor: item.AmountMinor, Currency: item.Currency, PaymentVersion: item.PaymentVersion, CollectedAt: item.CollectedAt.UTC().Format(time.RFC3339Nano)})
	}
	response := cashLiabilityRegistryResponse{Items: items, TotalAmountMinor: result.TotalAmountMinor, TotalItems: result.TotalItems, Limit: limit}
	if result.HasMore && len(result.Items) > 0 {
		last := result.Items[len(result.Items)-1]
		cursor, err := json.Marshal(cashLiabilityRegistryCursor{Search: search, Sort: sort, CollectedAt: last.CollectedAt.UTC().Format(time.RFC3339Nano), PaymentIntentID: last.PaymentIntentID})
		if err != nil {
			writePaymentError(w, err)
			return
		}
		response.NextCursor = base64.RawURLEncoding.EncodeToString(cursor)
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, response)
}
