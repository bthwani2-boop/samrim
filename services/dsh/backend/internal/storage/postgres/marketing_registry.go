package postgres

import (
	"context"
	"database/sql"
	"errors"
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
	keyset := "($3::timestamptz IS NULL OR starts_at < $3 OR (starts_at = $3 AND id < $4))"
	if query.Sort == "starts_asc" {
		orderBy = "starts_at ASC, id ASC"
		keyset = "($3::timestamptz IS NULL OR starts_at > $3 OR (starts_at = $3 AND id > $4))"
	}
	var afterStartsAt any
	if query.AfterStartsAt != nil {
		afterStartsAt = *query.AfterStartsAt
	}
	rows, err := db.QueryContext(ctx, `
		SELECT `+promotionSelect+`
		FROM dsh.commerce_promotions
		WHERE ($1='' OR state=$1)
		  AND ($2='' OR code ILIKE '%' || $2 || '%' OR name_ar ILIKE '%' || $2 || '%')
		  AND `+keyset+`
		ORDER BY `+orderBy+`
		LIMIT $5
	`, query.State, query.Search, afterStartsAt, query.AfterID, query.Limit+1)
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
	keyset := "($4::integer IS NULL OR ordinal > $4 OR (ordinal = $4 AND (starts_at < $5 OR (starts_at = $5 AND id < $7))))"
	if query.Sort == "created_desc" {
		orderBy = "created_at DESC, id DESC"
		keyset = "($6::timestamptz IS NULL OR created_at < $6 OR (created_at = $6 AND id < $7))"
	}
	var afterOrdinal any
	var afterStartsAt any
	var afterCreatedAt any
	if query.AfterOrdinal != nil {
		afterOrdinal = *query.AfterOrdinal
	}
	if query.AfterStartsAt != nil {
		afterStartsAt = *query.AfterStartsAt
	}
	if query.AfterCreatedAt != nil {
		afterCreatedAt = *query.AfterCreatedAt
	}
	rows, err := db.QueryContext(ctx, `
		SELECT `+discoveryContentSelect+`
		FROM dsh.discovery_content
		WHERE ($1='' OR state=$1)
		  AND ($2='' OR kind=$2)
		  AND ($3='' OR title_ar ILIKE '%' || $3 || '%' OR body_ar ILIKE '%' || $3 || '%')
		  AND `+keyset+`
		ORDER BY `+orderBy+`
		LIMIT $8
	`, query.State, query.Kind, query.Search, afterOrdinal, afterStartsAt, afterCreatedAt, query.AfterID, query.Limit+1)
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

var _ = errors.Is
