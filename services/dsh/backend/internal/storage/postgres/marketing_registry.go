package postgres

import (
	"context"
	"database/sql"
	"strconv"
	"strings"
	"time"
)

type OperatorPromotionRegistryQuery struct {
	Search        string
	State         string
	Sort          string
	AfterStartsAt *time.Time
	AfterID       string
	Limit         int
}

type OperatorDiscoveryContentRegistryQuery struct {
	Search         string
	State          string
	Kind           string
	Sort           string
	AfterOrdinal   *int
	AfterStartsAt  *time.Time
	AfterCreatedAt *time.Time
	AfterID        string
	Limit          int
}

type OperatorPromotionRegistryPage struct {
	Promotions []PromotionRecord
	HasMore    bool
}

type OperatorDiscoveryContentRegistryPage struct {
	Items   []DiscoveryContentRecord
	HasMore bool
}

func ListOperatorPromotionRegistry(ctx context.Context, db *sql.DB, query OperatorPromotionRegistryQuery) (OperatorPromotionRegistryPage, error) {
	query.Search = strings.TrimSpace(query.Search)
	query.State = strings.ToUpper(strings.TrimSpace(query.State))
	query.Sort = strings.ToLower(strings.TrimSpace(query.Sort))
	query.AfterID = strings.TrimSpace(query.AfterID)
	validState := query.State == "" || query.State == "DRAFT" || query.State == "PUBLISHED" || query.State == "PAUSED"
	validSort := query.Sort == "starts_desc" || query.Sort == "starts_asc"
	if db == nil || len(query.Search) > 512 || !validState || !validSort || query.Limit < 1 || query.Limit > 100 || (query.AfterStartsAt == nil) != (query.AfterID == "") || len(query.AfterID) > 128 {
		return OperatorPromotionRegistryPage{}, ErrPromotionInvalid
	}

	orderBy := "starts_at DESC, id DESC"
	operator := "<"
	if query.Sort == "starts_asc" {
		orderBy = "starts_at ASC, id ASC"
		operator = ">"
	}
	args := make([]any, 0, 5)
	filters := make([]string, 0, 3)
	if query.State != "" {
		args = append(args, query.State)
		filters = append(filters, "state=$"+strconv.Itoa(len(args)))
	}
	if query.Search != "" {
		args = append(args, strings.ToLower(escapeRegistryPrefix(query.Search))+"%")
		placeholder := "$" + strconv.Itoa(len(args))
		filters = append(filters, "(lower(id) LIKE "+placeholder+" ESCAPE E'\\' OR lower(code) LIKE "+placeholder+" ESCAPE E'\\' OR lower(name_ar) LIKE "+placeholder+" ESCAPE E'\\')")
	}
	if query.AfterStartsAt != nil {
		args = append(args, *query.AfterStartsAt, query.AfterID)
		timeParameter := "$" + strconv.Itoa(len(args)-1)
		idParameter := "$" + strconv.Itoa(len(args))
		filters = append(filters, "(starts_at "+operator+" "+timeParameter+" OR (starts_at="+timeParameter+" AND id "+operator+" "+idParameter+"))")
	}
	if len(filters) == 0 {
		filters = append(filters, "TRUE")
	}
	args = append(args, query.Limit+1)
	rows, err := db.QueryContext(ctx, `
		SELECT `+promotionSelect+`
		FROM dsh.commerce_promotions
		WHERE `+strings.Join(filters, " AND ")+`
		ORDER BY `+orderBy+`
		LIMIT $`+strconv.Itoa(len(args))+`
	`, args...)
	if err != nil {
		return OperatorPromotionRegistryPage{}, err
	}
	defer rows.Close()

	items := make([]PromotionRecord, 0, query.Limit+1)
	for rows.Next() {
		item, scanErr := scanPromotion(rows)
		if scanErr != nil {
			return OperatorPromotionRegistryPage{}, scanErr
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return OperatorPromotionRegistryPage{}, err
	}
	hasMore := len(items) > query.Limit
	if hasMore {
		items = items[:query.Limit]
	}
	return OperatorPromotionRegistryPage{Promotions: items, HasMore: hasMore}, nil
}

func ListOperatorDiscoveryContentRegistry(ctx context.Context, db *sql.DB, query OperatorDiscoveryContentRegistryQuery) (OperatorDiscoveryContentRegistryPage, error) {
	query.Search = strings.TrimSpace(query.Search)
	query.State = strings.ToUpper(strings.TrimSpace(query.State))
	query.Kind = strings.ToUpper(strings.TrimSpace(query.Kind))
	query.Sort = strings.ToLower(strings.TrimSpace(query.Sort))
	query.AfterID = strings.TrimSpace(query.AfterID)
	validState := query.State == "" || query.State == "DRAFT" || query.State == "PUBLISHED" || query.State == "PAUSED"
	validKind := query.Kind == "" || query.Kind == "BANNER" || query.Kind == "CAROUSEL" || query.Kind == "SHORT_FORM"
	validSort := query.Sort == "priority" || query.Sort == "created_desc"
	priorityCursorValid := (query.AfterOrdinal != nil && query.AfterStartsAt != nil && query.AfterCreatedAt == nil && query.AfterID != "") || (query.AfterOrdinal == nil && query.AfterStartsAt == nil && query.AfterCreatedAt == nil && query.AfterID == "")
	createdCursorValid := (query.AfterOrdinal == nil && query.AfterStartsAt == nil && query.AfterCreatedAt != nil && query.AfterID != "") || (query.AfterOrdinal == nil && query.AfterStartsAt == nil && query.AfterCreatedAt == nil && query.AfterID == "")
	cursorValid := (query.Sort == "priority" && priorityCursorValid) || (query.Sort == "created_desc" && createdCursorValid)
	if db == nil || len(query.Search) > 512 || !validState || !validKind || !validSort || !cursorValid || query.Limit < 1 || query.Limit > 100 || len(query.AfterID) > 128 {
		return OperatorDiscoveryContentRegistryPage{}, ErrDiscoveryContentInvalid
	}

	orderBy := "ordinal ASC, starts_at DESC, id DESC"
	if query.Sort == "created_desc" {
		orderBy = "created_at DESC, id DESC"
	}
	args := make([]any, 0, 8)
	filters := make([]string, 0, 5)
	if query.State != "" {
		args = append(args, query.State)
		filters = append(filters, "state=$"+strconv.Itoa(len(args)))
	}
	if query.Kind != "" {
		args = append(args, query.Kind)
		filters = append(filters, "kind=$"+strconv.Itoa(len(args)))
	}
	if query.Search != "" {
		args = append(args, strings.ToLower(escapeRegistryPrefix(query.Search))+"%")
		placeholder := "$" + strconv.Itoa(len(args))
		filters = append(filters, "(lower(id) LIKE "+placeholder+" ESCAPE E'\\' OR lower(title_ar) LIKE "+placeholder+" ESCAPE E'\\')")
	}
	if query.Sort == "priority" && query.AfterOrdinal != nil {
		args = append(args, *query.AfterOrdinal, *query.AfterStartsAt, query.AfterID)
		ordinalParameter := "$" + strconv.Itoa(len(args)-2)
		startsParameter := "$" + strconv.Itoa(len(args)-1)
		idParameter := "$" + strconv.Itoa(len(args))
		filters = append(filters, "(ordinal > "+ordinalParameter+" OR (ordinal="+ordinalParameter+" AND (starts_at < "+startsParameter+" OR (starts_at="+startsParameter+" AND id < "+idParameter+"))))")
	} else if query.Sort == "created_desc" && query.AfterCreatedAt != nil {
		args = append(args, *query.AfterCreatedAt, query.AfterID)
		createdParameter := "$" + strconv.Itoa(len(args)-1)
		idParameter := "$" + strconv.Itoa(len(args))
		filters = append(filters, "(created_at < "+createdParameter+" OR (created_at="+createdParameter+" AND id < "+idParameter+"))")
	}
	if len(filters) == 0 {
		filters = append(filters, "TRUE")
	}
	args = append(args, query.Limit+1)
	rows, err := db.QueryContext(ctx, `
		SELECT `+discoveryContentSelect+`
		FROM dsh.discovery_content
		WHERE `+strings.Join(filters, " AND ")+`
		ORDER BY `+orderBy+`
		LIMIT $`+strconv.Itoa(len(args))+`
	`, args...)
	if err != nil {
		return OperatorDiscoveryContentRegistryPage{}, err
	}
	defer rows.Close()

	items := make([]DiscoveryContentRecord, 0, query.Limit+1)
	for rows.Next() {
		item, scanErr := scanDiscoveryContent(rows)
		if scanErr != nil {
			return OperatorDiscoveryContentRegistryPage{}, scanErr
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return OperatorDiscoveryContentRegistryPage{}, err
	}
	hasMore := len(items) > query.Limit
	if hasMore {
		items = items[:query.Limit]
	}
	return OperatorDiscoveryContentRegistryPage{Items: items, HasMore: hasMore}, nil
}

func escapeRegistryPrefix(value string) string {
	return strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(value)
}
