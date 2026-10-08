package http

import (
	"encoding/base64"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/bthwani2-boop/samrim/services/wlt/backend/internal/storage/postgres"
)

type fieldWalletHistoryEntryJSON struct {
	Type             string `json:"type"`
	Direction        string `json:"direction"`
	AmountMinor      int64  `json:"amountMinor"`
	Currency         string `json:"currency"`
	CreatedAt        string `json:"createdAt"`
	BalanceAfterMinor int64 `json:"balanceAfterMinor"`
}

type fieldWalletHistoryResponse struct {
	Currency    string                        `json:"currency"`
	Entries     []fieldWalletHistoryEntryJSON `json:"entries"`
	NextCursor  string                        `json:"nextCursor,omitempty"`
	Limit       int                           `json:"limit"`
}

func (s *Server) readFieldWalletHistory(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	fieldActorID := strings.TrimSpace(r.PathValue("fieldActorId"))
	if fieldActorID == "" || len(fieldActorID) > 128 {
		writeSettlementError(w, postgres.ErrFinancialStatementInput)
		return
	}

	limit := 50
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 || parsed > 100 {
			writeSettlementError(w, postgres.ErrFinancialStatementInput)
			return
		}
		limit = parsed
	}
	var cursorAt *time.Time
	cursorID := ""
	if raw := strings.TrimSpace(r.URL.Query().Get("cursor")); raw != "" {
		if len(raw) > 512 {
			writeSettlementError(w, postgres.ErrFinancialStatementInput)
			return
		}
		decoded, err := base64.RawURLEncoding.DecodeString(raw)
		parts := strings.SplitN(string(decoded), "|", 2)
		if err != nil || len(parts) != 2 || strings.TrimSpace(parts[1]) == "" || len(parts[1]) > 128 {
			writeSettlementError(w, postgres.ErrFinancialStatementInput)
			return
		}
		parsed, err := time.Parse(time.RFC3339Nano, parts[0])
		if err != nil {
			writeSettlementError(w, postgres.ErrFinancialStatementInput)
			return
		}
		cursorAt, cursorID = &parsed, parts[1]
	}

	// Use the ledger's complete supported timestamp range; DSH binds this call
	// to the authenticated actor and the existing WLT query enforces that scope.
	start := time.Time{}
	endExclusive := time.Date(9999, time.December, 31, 23, 59, 59, 999999999, time.UTC)
	statement, err := postgres.ReadFinancialStatement(r.Context(), s.db, "field", fieldActorID, start, endExclusive, cursorAt, cursorID, limit)
	if err != nil {
		writeSettlementError(w, err)
		return
	}
	entries := make([]fieldWalletHistoryEntryJSON, 0, len(statement.Entries))
	for _, entry := range statement.Entries {
		entries = append(entries, fieldWalletHistoryEntryJSON{
			Type: entry.TransactionType, Direction: entry.Direction,
			AmountMinor: entry.AmountMinor, Currency: entry.Currency,
			CreatedAt: entry.CreatedAt.UTC().Format(time.RFC3339Nano),
			BalanceAfterMinor: entry.BalanceAfter,
		})
	}
	response := fieldWalletHistoryResponse{Currency: statement.Currency, Entries: entries, Limit: statement.Limit}
	if statement.NextCursor != "" {
		response.NextCursor = base64.RawURLEncoding.EncodeToString([]byte(statement.NextCursor))
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, response)
}
