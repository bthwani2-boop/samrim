package transporthttp

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/contract"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

const operatorMarketingRegistryDefaultLimit = 50

type operatorPromotionRegistryCursor struct {
	Search   string `json:"search"`
	State    string `json:"state"`
	Sort     string `json:"sort"`
	StartsAt string `json:"startsAt"`
	ID       string `json:"id"`
}

type operatorDiscoveryContentRegistryCursor struct {
	Search    string `json:"search"`
	State     string `json:"state"`
	Kind      string `json:"kind"`
	Sort      string `json:"sort"`
	Ordinal   *int   `json:"ordinal,omitempty"`
	StartsAt  string `json:"startsAt,omitempty"`
	CreatedAt string `json:"createdAt,omitempty"`
	ID        string `json:"id"`
}

type operatorMarketingStoreTargetCursor struct {
	ServiceCityID string `json:"serviceCityId"`
	Search        string `json:"search"`
	Name          string `json:"name"`
	ID            string `json:"id"`
}

func (s *MarketingServer) listOperatorMarketingStoreTargets(w http.ResponseWriter, r *http.Request) {
	if !s.operatorAuthorized(w, r) {
		return
	}
	params := r.URL.Query()
	serviceCityID := strings.TrimSpace(params.Get("serviceCityId"))
	search := strings.TrimSpace(params.Get("search"))
	if serviceCityID == "" || len(serviceCityID) > 128 || utf8.RuneCountInString(search) < 2 || utf8.RuneCountInString(search) > 128 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "serviceCityId and a search of 2 to 128 characters are required")
		return
	}
	limit, err := parseOperatorMarketingRegistryLimit(params.Get("limit"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "limit is invalid")
		return
	}
	query := postgres.MarketingStoreTargetQuery{ServiceCityID: serviceCityID, Search: search, Limit: limit}
	rawCursor := strings.TrimSpace(params.Get("cursor"))
	if rawCursor != "" {
		if len(rawCursor) > 2048 {
			writeError(w, http.StatusBadRequest, "INVALID_INPUT", "cursor is too long")
			return
		}
		decoded, decodeErr := base64.RawURLEncoding.DecodeString(rawCursor)
		var cursor operatorMarketingStoreTargetCursor
		if decodeErr != nil || len(decoded) > 1536 || json.Unmarshal(decoded, &cursor) != nil || cursor.ServiceCityID != serviceCityID || cursor.Search != search || cursor.Name == "" || cursor.ID == "" {
			writeError(w, http.StatusBadRequest, "INVALID_INPUT", "cursor is invalid for this search")
			return
		}
		query.AfterName = cursor.Name
		query.AfterID = cursor.ID
	}
	page, err := postgres.ListMarketingStoreTargets(r.Context(), s.db, query)
	if err != nil {
		writeMarketingError(w, err)
		return
	}
	stores := make([]contract.MarketingStoreTarget, 0, len(page.Stores))
	for _, item := range page.Stores {
		stores = append(stores, contract.MarketingStoreTarget{ID: item.ID, Name: item.Name, ServiceCityID: item.ServiceCityID})
	}
	response := contract.MarketingStoreTargetRegistryResponse{Stores: stores, Limit: limit}
	if page.HasMore && len(page.Stores) > 0 {
		last := page.Stores[len(page.Stores)-1]
		encoded, encodeErr := json.Marshal(operatorMarketingStoreTargetCursor{ServiceCityID: serviceCityID, Search: search, Name: last.Name, ID: last.ID})
		if encodeErr != nil {
			writeMarketingError(w, encodeErr)
			return
		}
		response.NextCursor = base64.RawURLEncoding.EncodeToString(encoded)
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, response)
}

func parseOperatorPromotionRegistryQuery(r *http.Request) (postgres.OperatorPromotionRegistryQuery, error) {
	params := r.URL.Query()
	search := strings.TrimSpace(params.Get("search"))
	state := strings.ToUpper(strings.TrimSpace(params.Get("state")))
	sort := strings.ToLower(strings.TrimSpace(params.Get("sort")))
	if sort == "" {
		sort = "starts_desc"
	}
	limit, err := parseOperatorMarketingRegistryLimit(params.Get("limit"))
	if err != nil || utf8.RuneCountInString(search) > 128 || (state != "" && state != "DRAFT" && state != "PUBLISHED" && state != "PAUSED") || (sort != "starts_desc" && sort != "starts_asc") {
		return postgres.OperatorPromotionRegistryQuery{}, postgres.ErrPromotionInvalid
	}
	query := postgres.OperatorPromotionRegistryQuery{Search: search, State: state, Sort: sort, Limit: limit}
	rawCursor := strings.TrimSpace(params.Get("cursor"))
	if rawCursor == "" {
		return query, nil
	}
	if len(rawCursor) > 2048 {
		return postgres.OperatorPromotionRegistryQuery{}, postgres.ErrPromotionInvalid
	}
	decoded, err := base64.RawURLEncoding.DecodeString(rawCursor)
	var cursor operatorPromotionRegistryCursor
	if err != nil || len(decoded) > 1536 || json.Unmarshal(decoded, &cursor) != nil || cursor.Search != search || cursor.State != state || cursor.Sort != sort || cursor.ID == "" || len(cursor.ID) > 128 {
		return postgres.OperatorPromotionRegistryQuery{}, postgres.ErrPromotionInvalid
	}
	startsAt, err := time.Parse(time.RFC3339Nano, cursor.StartsAt)
	if err != nil {
		return postgres.OperatorPromotionRegistryQuery{}, postgres.ErrPromotionInvalid
	}
	query.AfterStartsAt = &startsAt
	query.AfterID = cursor.ID
	return query, nil
}

func encodeOperatorPromotionRegistryCursor(item postgres.PromotionRecord, query postgres.OperatorPromotionRegistryQuery) (string, error) {
	encoded, err := json.Marshal(operatorPromotionRegistryCursor{Search: query.Search, State: query.State, Sort: query.Sort, StartsAt: item.StartsAt.UTC().Format(time.RFC3339Nano), ID: item.ID})
	if err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(encoded), nil
}

func parseOperatorDiscoveryContentRegistryQuery(r *http.Request) (postgres.OperatorDiscoveryContentRegistryQuery, error) {
	params := r.URL.Query()
	search := strings.TrimSpace(params.Get("search"))
	state := strings.ToUpper(strings.TrimSpace(params.Get("state")))
	kind := strings.ToUpper(strings.TrimSpace(params.Get("kind")))
	sort := strings.ToLower(strings.TrimSpace(params.Get("sort")))
	if sort == "" {
		sort = "priority"
	}
	limit, err := parseOperatorMarketingRegistryLimit(params.Get("limit"))
	if err != nil || utf8.RuneCountInString(search) > 128 || (state != "" && state != "DRAFT" && state != "PUBLISHED" && state != "PAUSED") || (kind != "" && kind != "BANNER" && kind != "CAROUSEL" && kind != "SHORT_FORM") || (sort != "priority" && sort != "created_desc") {
		return postgres.OperatorDiscoveryContentRegistryQuery{}, postgres.ErrDiscoveryContentInvalid
	}
	query := postgres.OperatorDiscoveryContentRegistryQuery{Search: search, State: state, Kind: kind, Sort: sort, Limit: limit}
	rawCursor := strings.TrimSpace(params.Get("cursor"))
	if rawCursor == "" {
		return query, nil
	}
	if len(rawCursor) > 2048 {
		return postgres.OperatorDiscoveryContentRegistryQuery{}, postgres.ErrDiscoveryContentInvalid
	}
	decoded, err := base64.RawURLEncoding.DecodeString(rawCursor)
	var cursor operatorDiscoveryContentRegistryCursor
	if err != nil || len(decoded) > 1536 || json.Unmarshal(decoded, &cursor) != nil || cursor.Search != search || cursor.State != state || cursor.Kind != kind || cursor.Sort != sort || cursor.ID == "" || len(cursor.ID) > 128 {
		return postgres.OperatorDiscoveryContentRegistryQuery{}, postgres.ErrDiscoveryContentInvalid
	}
	if sort == "priority" {
		if cursor.Ordinal == nil || cursor.StartsAt == "" || cursor.CreatedAt != "" {
			return postgres.OperatorDiscoveryContentRegistryQuery{}, postgres.ErrDiscoveryContentInvalid
		}
		startsAt, parseErr := time.Parse(time.RFC3339Nano, cursor.StartsAt)
		if parseErr != nil {
			return postgres.OperatorDiscoveryContentRegistryQuery{}, postgres.ErrDiscoveryContentInvalid
		}
		query.AfterOrdinal = cursor.Ordinal
		query.AfterStartsAt = &startsAt
	} else {
		if cursor.Ordinal != nil || cursor.StartsAt != "" || cursor.CreatedAt == "" {
			return postgres.OperatorDiscoveryContentRegistryQuery{}, postgres.ErrDiscoveryContentInvalid
		}
		createdAt, parseErr := time.Parse(time.RFC3339Nano, cursor.CreatedAt)
		if parseErr != nil {
			return postgres.OperatorDiscoveryContentRegistryQuery{}, postgres.ErrDiscoveryContentInvalid
		}
		query.AfterCreatedAt = &createdAt
	}
	query.AfterID = cursor.ID
	return query, nil
}

func encodeOperatorDiscoveryContentRegistryCursor(item postgres.DiscoveryContentRecord, query postgres.OperatorDiscoveryContentRegistryQuery) (string, error) {
	cursor := operatorDiscoveryContentRegistryCursor{Search: query.Search, State: query.State, Kind: query.Kind, Sort: query.Sort, ID: item.ID}
	if query.Sort == "priority" {
		cursor.Ordinal = &item.Ordinal
		cursor.StartsAt = item.StartsAt.UTC().Format(time.RFC3339Nano)
	} else {
		cursor.CreatedAt = item.CreatedAt.UTC().Format(time.RFC3339Nano)
	}
	encoded, err := json.Marshal(cursor)
	if err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(encoded), nil
}

func parseOperatorMarketingRegistryLimit(raw string) (int, error) {
	if strings.TrimSpace(raw) == "" {
		return operatorMarketingRegistryDefaultLimit, nil
	}
	limit, err := strconv.Atoi(strings.TrimSpace(raw))
	if err != nil || limit < 1 || limit > 100 {
		return 0, postgres.ErrPromotionInvalid
	}
	return limit, nil
}
