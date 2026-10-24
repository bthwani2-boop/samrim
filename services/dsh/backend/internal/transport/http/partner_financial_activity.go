package transporthttp

import (
	"encoding/base64"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/wlt"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

type partnerActivityView struct {
	wlt.PartnerActivity
	StoreName string `json:"storeName"`
}

func (s *PartnerFinanceServer) readOwnActivity(w http.ResponseWriter, r *http.Request) {
	token := bearerToken(r)
	if token == "" {
		writeError(w, 401, "UNAUTHENTICATED", "partner session is required")
		return
	}
	identity, err := s.identity.ReadSession(r.Context(), token)
	if err != nil {
		writeIdentityError(w, err)
		return
	}
	if identity.Role != "partner" || identity.Surface != "app-partner" || strings.TrimSpace(identity.Subject) == "" {
		writeError(w, 403, "FORBIDDEN", "app-partner session required")
		return
	}
	stores, err := postgres.ListPartnerFinanceStores(r.Context(), s.db, identity.Subject, "finance_read")
	if err != nil {
		writeError(w, 500, "STORAGE_UNAVAILABLE", "finance scope unavailable")
		return
	}
	s.listScopedActivity(w, r, stores)
}
func (s *PartnerFinanceServer) readOperatorActivity(w http.ResponseWriter, r *http.Request) {
	if !s.authorizeOperator(w, r) {
		writeError(w, 401, "UNAUTHENTICATED", "service authentication required")
		return
	}
	acting := strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID"))
	if !s.requireOperator(w, r.Context(), acting) || !s.requirePermission(w, r.Context(), acting, "finance") {
		return
	}
	subject := strings.TrimSpace(r.PathValue("partnerActorId"))
	if subject == "" || len(subject) > 128 {
		writeError(w, 400, "INVALID_INPUT", "partner required")
		return
	}
	stores, err := postgres.ListPartnerFinanceStores(r.Context(), s.db, subject, "finance_read")
	if err != nil {
		writeError(w, 500, "STORAGE_UNAVAILABLE", "finance scope unavailable")
		return
	}
	s.listScopedActivity(w, r, stores)
}
func (s *PartnerFinanceServer) listScopedActivity(w http.ResponseWriter, r *http.Request, available []postgres.PartnerFinanceStore) {
	values := r.URL.Query()
	selected, err := selectPartnerFinanceScope(available, values["storeId"])
	if err != nil {
		writeError(w, 403, "FORBIDDEN", "finance_read required for each Store")
		return
	}
	limit := 30
	if raw := values.Get("limit"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 1 || n > 100 {
			writeError(w, 400, "INVALID_INPUT", "invalid limit")
			return
		}
		limit = n
	}
	q := wlt.PartnerActivityFilters{
		Kind: values.Get("kind"), Status: values.Get("status"), PaymentMethod: values.Get("paymentMethod"),
		Search: strings.TrimSpace(values.Get("search")), From: values.Get("from"), To: values.Get("to"),
		Cursor: values.Get("cursor"), Limit: limit,
	}
	if len(q.Search) > 128 || len(q.Cursor) > 512 ||
		(q.Kind != "" && q.Kind != "ORDER" && q.Kind != "PAYOUT" && q.Kind != "CASH_COMMISSION") ||
		(q.Status != "" && q.Status != "POSTED" && q.Status != "COMPLETED" && q.Status != "PENDING" && q.Status != "CANCELLED" && q.Status != "EXCEPTION") ||
		(q.PaymentMethod != "" && q.PaymentMethod != "CASH_ON_DELIVERY" && q.PaymentMethod != "CASH_AT_STORE" && q.PaymentMethod != "WALLET" && q.PaymentMethod != "MIXED") {
		writeError(w, 400, "INVALID_INPUT", "invalid financial filters")
		return
	}
	if q.From != "" {
		if _, err := time.Parse("2006-01-02", q.From); err != nil {
			writeError(w, 400, "INVALID_INPUT", "invalid date")
			return
		}
	}
	if q.To != "" {
		if _, err := time.Parse("2006-01-02", q.To); err != nil {
			writeError(w, 400, "INVALID_INPUT", "invalid date")
			return
		}
	}
	if q.Cursor != "" {
		raw, err := base64.RawURLEncoding.DecodeString(q.Cursor)
		if err != nil || len(strings.SplitN(string(raw), "|", 3)) != 3 {
			writeError(w, 400, "INVALID_INPUT", "invalid cursor")
			return
		}
	}
	owners := map[string][]string{}
	names := map[string]string{}
	for _, store := range selected {
		owners[store.PartnerActorID] = append(owners[store.PartnerActorID], store.ID)
		names[store.ID] = store.Name
	}
	entries := make([]partnerActivityView, 0, limit+1)
	hasFurther := false
	// Query only owner/store pairs granted to this session; never widen WLT scope.
	for owner, ids := range owners {
		scoped := q
		scoped.StoreIDs = ids
		page, err := s.payment.ListPartnerActivity(r.Context(), owner, scoped)
		if err != nil {
			writeWLTFinanceError(w, err)
			return
		}
		if page.NextCursor != "" {
			hasFurther = true
		}
		for _, item := range page.Items {
			if item.StoreID == "" || names[item.StoreID] == "" {
				writeError(w, 502, "INVALID_FINANCE_READBACK", "unattributed Store activity")
				return
			}
			entries = append(entries, partnerActivityView{PartnerActivity: item, StoreName: names[item.StoreID]})
		}
	}
	sort.Slice(entries, func(i, j int) bool {
		a, b := entries[i], entries[j]
		if a.CreatedAt != b.CreatedAt {
			at, ae := time.Parse(time.RFC3339Nano, a.CreatedAt)
			bt, be := time.Parse(time.RFC3339Nano, b.CreatedAt)
			if ae == nil && be == nil {
				return at.After(bt)
			}
			return a.CreatedAt > b.CreatedAt
		}
		if a.Kind != b.Kind {
			return a.Kind > b.Kind
		}
		return a.ID > b.ID
	})
	if len(entries) > limit {
		entries = entries[:limit]
		hasFurther = true
	}
	storeOptions := make([]map[string]string, 0, len(selected))
	for _, store := range selected {
		storeOptions = append(storeOptions, map[string]string{"storeId": store.ID, "storeName": store.Name})
	}
	response := map[string]any{"items": entries, "stores": storeOptions}
	if hasFurther && len(entries) > 0 {
		last := entries[len(entries)-1]
		response["nextCursor"] = base64.RawURLEncoding.EncodeToString([]byte(last.CreatedAt + "|" + last.Kind + "|" + last.ID))
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, 200, response)
}
