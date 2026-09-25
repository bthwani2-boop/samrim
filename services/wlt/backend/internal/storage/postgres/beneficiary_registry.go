package postgres

import (
	"context"
	"database/sql"
	"strings"
)

type BeneficiaryPayoutRegistryRecord struct {
	State     PayoutStateRecord
	SortValue int64
}

func ValidBeneficiaryRegistrySort(value string) bool {
	switch value {
	case "actor_asc", "actor_desc", "available_asc", "available_desc", "held_asc", "held_desc", "payout_amount_asc", "payout_amount_desc":
		return true
	default:
		return false
	}
}

func ValidPayoutRegistryActor(actorType string) bool {
	switch actorType {
	case "partner", "captain", "field":
		return true
	default:
		return false
	}
}

func ListBeneficiaryPayoutStates(ctx context.Context, db *sql.DB, actorType, search, status, sortKey string, afterSortValue int64, afterType, afterID string, limit int) ([]BeneficiaryPayoutRegistryRecord, bool, error) {
	actorType = strings.ToLower(strings.TrimSpace(actorType))
	search, status, sortKey, afterType, afterID = strings.TrimSpace(search), strings.ToUpper(strings.TrimSpace(status)), strings.ToLower(strings.TrimSpace(sortKey)), strings.ToLower(strings.TrimSpace(afterType)), strings.TrimSpace(afterID)
	if db == nil || (actorType != "" && !ValidPayoutRegistryActor(actorType)) || (status != "" && status != "NO_REQUEST" && !validPayoutStatus(status)) || len(search) > 128 || !ValidBeneficiaryRegistrySort(sortKey) || len(afterID) > 128 || (afterType != "" && !ValidPayoutRegistryActor(afterType)) || (afterType == "") != (afterID == "") || limit < 1 || limit > 100 {
		return nil, false, ErrPayoutInvalidInput
	}
	orderBy := "actor_type ASC, actor_id ASC"
	keyset := `(actor_type, actor_id) > ($6, $7)`
	switch sortKey {
	case "actor_desc":
		orderBy = "actor_type DESC, actor_id DESC"
		keyset = `(actor_type, actor_id) < ($6, $7)`
	case "available_asc":
		orderBy = "available_minor ASC, actor_type ASC, actor_id ASC"
		keyset = `(available_minor, actor_type, actor_id) > ($5, $6, $7)`
	case "available_desc":
		orderBy = "available_minor DESC, actor_type ASC, actor_id ASC"
		keyset = `(available_minor < $5 OR (available_minor = $5 AND (actor_type, actor_id) > ($6, $7)))`
	case "held_asc":
		orderBy = "held_minor ASC, actor_type ASC, actor_id ASC"
		keyset = `(held_minor, actor_type, actor_id) > ($5, $6, $7)`
	case "held_desc":
		orderBy = "held_minor DESC, actor_type ASC, actor_id ASC"
		keyset = `(held_minor < $5 OR (held_minor = $5 AND (actor_type, actor_id) > ($6, $7)))`
	case "payout_amount_asc":
		orderBy = "payout_amount_minor ASC, actor_type ASC, actor_id ASC"
		keyset = `(payout_amount_minor, actor_type, actor_id) > ($5, $6, $7)`
	case "payout_amount_desc":
		orderBy = "payout_amount_minor DESC, actor_type ASC, actor_id ASC"
		keyset = `(payout_amount_minor < $5 OR (payout_amount_minor = $5 AND (actor_type, actor_id) > ($6, $7)))`
	}
	query := `WITH beneficiaries AS (SELECT actor_type,actor_id FROM (
		SELECT actor_type,actor_id FROM wlt.ledger_entries WHERE account_code IN ('PARTNER_WALLET','CAPTAIN_WALLET','FIELD_WALLET') AND actor_type IN ('partner','captain','field') AND actor_id IS NOT NULL
		UNION SELECT actor_type,actor_id FROM wlt.payout_requests
		UNION SELECT actor_type,actor_id FROM wlt.official_wallet_destinations
	) WHERE actor_type IN ('partner','captain','field') AND actor_id IS NOT NULL), latest_destination AS (
		SELECT DISTINCT ON (actor_type,actor_id) actor_type,actor_id,beneficiary_name,wallet_identifier_masked FROM wlt.official_wallet_destinations WHERE actor_type IN ('partner','captain','field') ORDER BY actor_type,actor_id,version DESC
	), latest AS (SELECT DISTINCT ON (actor_type,actor_id) actor_type,actor_id,status,resolved_amount_minor FROM wlt.payout_requests WHERE actor_type IN ('partner','captain','field') ORDER BY actor_type,actor_id,created_at DESC,id DESC), balances AS (
		SELECT actor_type,actor_id,SUM(CASE direction WHEN 'CREDIT' THEN amount_minor ELSE -amount_minor END) balance_minor FROM wlt.ledger_entries
		WHERE account_code IN ('PARTNER_WALLET','CAPTAIN_WALLET','FIELD_WALLET') AND actor_type IN ('partner','captain','field') AND actor_id IS NOT NULL GROUP BY actor_type,actor_id
	), hold_components AS (
		SELECT actor_type,actor_id,amount_minor FROM wlt.payout_holds WHERE status='ACTIVE'
		UNION ALL
		SELECT 'captain',captain_actor_id,SUM(amount_minor) FROM wlt.captain_cod_reservations WHERE state IN ('ACTIVE','FINALIZED') GROUP BY captain_actor_id
	), holds AS (
		SELECT actor_type,actor_id,SUM(amount_minor) held_minor FROM hold_components GROUP BY actor_type,actor_id
	), enriched AS (
		SELECT b.actor_type,b.actor_id,d.beneficiary_name,d.wallet_identifier_masked,COALESCE(l.status,'') payout_status,COALESCE(l.resolved_amount_minor,0)::bigint payout_amount_minor,
		COALESCE(h.held_minor,0)::bigint held_minor,COALESCE(a.balance_minor,0)::bigint-COALESCE(h.held_minor,0)::bigint available_minor
		FROM beneficiaries b LEFT JOIN latest l ON l.actor_type=b.actor_type AND l.actor_id=b.actor_id
		LEFT JOIN balances a ON a.actor_type=b.actor_type AND a.actor_id=b.actor_id
		LEFT JOIN holds h ON h.actor_type=b.actor_type AND h.actor_id=b.actor_id
		LEFT JOIN latest_destination d ON d.actor_type=b.actor_type AND d.actor_id=b.actor_id
	)
	SELECT actor_type,actor_id,CASE $8::text WHEN 'available_asc' THEN available_minor WHEN 'available_desc' THEN available_minor WHEN 'held_asc' THEN held_minor WHEN 'held_desc' THEN held_minor WHEN 'payout_amount_asc' THEN payout_amount_minor WHEN 'payout_amount_desc' THEN payout_amount_minor ELSE 0 END::bigint sort_value
	FROM enriched WHERE ($1='' OR actor_type=$1) AND ($2='' OR actor_id ILIKE '%' || $2 || '%' OR beneficiary_name ILIKE '%' || $2 || '%' OR wallet_identifier_masked ILIKE '%' || $2 || '%')
	AND ($3='' OR ($3='NO_REQUEST' AND payout_status='') OR payout_status=$3)
	AND (NOT $4::boolean OR ` + keyset + `)
	ORDER BY ` + orderBy + ` LIMIT $9`
	rows, err := db.QueryContext(ctx, query, actorType, search, status, afterType != "", afterSortValue, afterType, afterID, sortKey, limit+1)
	if err != nil {
		return nil, false, err
	}
	defer rows.Close()
	type actor struct {
		kind, id  string
		sortValue int64
	}
	actors := make([]actor, 0, limit+1)
	for rows.Next() {
		var item actor
		if err := rows.Scan(&item.kind, &item.id, &item.sortValue); err != nil {
			return nil, false, err
		}
		actors = append(actors, item)
	}
	if err := rows.Err(); err != nil {
		return nil, false, err
	}
	hasMore := len(actors) > limit
	if hasMore {
		actors = actors[:limit]
	}
	result := make([]BeneficiaryPayoutRegistryRecord, 0, len(actors))
	for _, item := range actors {
		state, err := ReadPayoutState(ctx, db, item.kind, item.id)
		if err != nil {
			return nil, false, err
		}
		result = append(result, BeneficiaryPayoutRegistryRecord{State: state, SortValue: item.sortValue})
	}
	return result, hasMore, nil
}
