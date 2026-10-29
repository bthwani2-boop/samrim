package postgres

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"
)

var ErrOperatorPolicyHistoryInput = errors.New("operator policy history input invalid")

type OperatorPolicyChange struct {
	ID        string    `json:"id"`
	ScopeID   string    `json:"scopeId"`
	Version   int       `json:"version"`
	ActorID   string    `json:"actorId"`
	CreatedAt time.Time `json:"createdAt"`
	Reason    string    `json:"reason"`
	Field     string    `json:"field"`
	Before    string    `json:"before"`
	After     string    `json:"after"`
}

func ReadWLTPolicyHistory(ctx context.Context, db *sql.DB, key, scopeID string) ([]OperatorPolicyChange, error) {
	if db == nil || len(scopeID) > 128 {
		return nil, ErrOperatorPolicyHistoryInput
	}
	key = strings.TrimSpace(key)
	scopeID = strings.TrimSpace(scopeID)
	var query string
	var field string
	switch key {
	case "delivery-fees":
		field = "شرائح المسافة"
		query = `SELECT e.id::text,e.service_city_id,p.version,e.acting_actor_id,e.created_at,e.change_reason,
    COALESCE(old.distance_bands::text,''),COALESCE(p.distance_bands::text,'')
    FROM wlt.delivery_fee_policy_events e JOIN wlt.delivery_fee_policies p ON p.id=e.policy_id
    LEFT JOIN wlt.delivery_fee_policies old ON old.service_city_id=p.service_city_id AND old.version=p.version-1
    WHERE ($1='' OR e.service_city_id=$1) ORDER BY e.created_at DESC,e.id DESC LIMIT 50`
	case "partner-financial-terms":
		field = "فترة التسوية"
		query = `SELECT e.id::text,''::text,p.version,e.acting_actor_id,e.created_at,e.change_reason,
   COALESCE(old.settlement_period,''),p.settlement_period
   FROM wlt.partner_financial_terms_policy_events e JOIN wlt.partner_financial_terms_policies p ON p.id=e.policy_id
   LEFT JOIN wlt.partner_financial_terms_policies old ON old.version=p.version-1
   WHERE ($1='' OR $1='global') ORDER BY e.created_at DESC,e.id DESC LIMIT 50`
	case "captain-minimum-balance":
		field = "الحد الأدنى للرصيد المتاح"
		query = `SELECT p.id,''::text,p.version,p.created_by,p.created_at,p.change_reason,
   COALESCE(old.minimum_available_minor::text,''),p.minimum_available_minor::text
   FROM wlt.captain_minimum_balance_policies p
   LEFT JOIN wlt.captain_minimum_balance_policies old ON old.version=p.version-1
   WHERE ($1='' OR $1='global') ORDER BY p.created_at DESC,p.id DESC LIMIT 50`
	default:
		return nil, ErrOperatorPolicyHistoryInput
	}
	rows, err := db.QueryContext(ctx, query, scopeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make([]OperatorPolicyChange, 0)
	for rows.Next() {
		var p OperatorPolicyChange
		if err = rows.Scan(&p.ID, &p.ScopeID, &p.Version, &p.ActorID, &p.CreatedAt, &p.Reason, &p.Before, &p.After); err != nil {
			return nil, err
		}
		p.Field = field
		result = append(result, p)
	}
	return result, rows.Err()
}
