package postgres

import (
	"context"
	"database/sql"
	"errors"
	"strings"
)

var ErrPartnerCommissionRegistryInput = errors.New("partner commission receivable registry input is invalid")

type PartnerCommissionReceivableRegistryItem struct {
	PartnerActorID                       string
	Currency                             string
	OutstandingCommissionReceivableMinor int64
	ProfileState                         string
}

func ValidPartnerCommissionRegistrySort(value string) bool {
	return value == "actor_asc" || value == "actor_desc"
}

func ListPartnerCommissionReceivables(ctx context.Context, db *sql.DB, search, sortKey, afterActorID string, limit int) ([]PartnerCommissionReceivableRegistryItem, bool, error) {
	search = strings.TrimSpace(search)
	sortKey = strings.ToLower(strings.TrimSpace(sortKey))
	afterActorID = strings.TrimSpace(afterActorID)
	if db == nil || len(search) > 512 || !ValidPartnerCommissionRegistrySort(sortKey) || len(afterActorID) > 128 || limit < 1 || limit > 100 {
		return nil, false, ErrPartnerCommissionRegistryInput
	}

	orderBy := "r.actor_id ASC"
	keyset := "($2='' OR r.actor_id > $2)"
	if sortKey == "actor_desc" {
		orderBy = "r.actor_id DESC"
		keyset = "($2='' OR r.actor_id < $2)"
	}
	rows, err := db.QueryContext(ctx, `
		WITH receivables AS (
			SELECT actor_id, SUM(CASE direction WHEN 'DEBIT' THEN amount_minor ELSE -amount_minor END)::bigint AS outstanding_minor
			FROM wlt.ledger_entries
			WHERE account_code='PARTNER_COMMISSION_RECEIVABLE' AND actor_type='partner' AND actor_id IS NOT NULL
			GROUP BY actor_id
			HAVING SUM(CASE direction WHEN 'DEBIT' THEN amount_minor ELSE -amount_minor END) > 0
		)
		SELECT r.actor_id, r.outstanding_minor, COALESCE(p.state, '')
		FROM receivables r
		LEFT JOIN wlt.partner_financial_profiles p ON p.partner_actor_id=r.actor_id
		WHERE ($1='' OR r.actor_id ILIKE '%' || $1 || '%') AND `+keyset+`
		ORDER BY `+orderBy+`
		LIMIT $3
	`, search, afterActorID, limit+1)
	if err != nil {
		return nil, false, err
	}
	defer rows.Close()

	items := make([]PartnerCommissionReceivableRegistryItem, 0, limit+1)
	for rows.Next() {
		var item PartnerCommissionReceivableRegistryItem
		if err := rows.Scan(&item.PartnerActorID, &item.OutstandingCommissionReceivableMinor, &item.ProfileState); err != nil {
			return nil, false, err
		}
		item.Currency = "YER"
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, false, err
	}
	hasMore := len(items) > limit
	if hasMore {
		items = items[:limit]
	}
	return items, hasMore, nil
}
