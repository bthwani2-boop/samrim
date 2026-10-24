package postgres

import (
	"context"
	"database/sql"
	"strings"
)

// OperatorPartnerDecision is an operator-only Store-scoped participation row.
// No customer identifiers or Partner financial account data are exposed.
type OperatorPartnerDecision struct {
	StoreID        string `json:"storeId"`
	StoreName      string `json:"storeName"`
	StorePublished bool   `json:"storePublished"`
	Decision       string `json:"decision"`
	Version        int    `json:"version"`
}

type OperatorPartnerDecisionPage struct {
	Items      []OperatorPartnerDecision `json:"items"`
	NextCursor string                    `json:"nextCursor,omitempty"`
}

// Read all Store decisions with keyset pagination, never the first N promotions.
// Decisions remain audit-readable for ended campaigns; active invitation counts
// are served separately from ReadOperatorMarketingSummary.
func ListOperatorPartnerDecisions(ctx context.Context, db *sql.DB, promotionID, cursor, decision string, limit int) (OperatorPartnerDecisionPage, error) {
	promotionID, cursor, decision = strings.TrimSpace(promotionID), strings.TrimSpace(cursor), strings.ToUpper(strings.TrimSpace(decision))
	if db == nil || promotionID == "" || len(promotionID) > 128 || len(cursor) > 128 || limit < 1 || limit > 100 ||
		(decision != "" && decision != "PENDING" && decision != "OPTED_IN" && decision != "DECLINED") {
		return OperatorPartnerDecisionPage{}, ErrPromotionInvalid
	}
	var eligible bool
	if err := db.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM dsh.commerce_promotions
     WHERE id=$1 AND store_id IS NULL AND requires_partner_opt_in)`, promotionID).Scan(&eligible); err != nil {
		return OperatorPartnerDecisionPage{}, err
	}
	if !eligible {
		return OperatorPartnerDecisionPage{}, ErrPromotionNotFound
	}
	rows, err := db.QueryContext(ctx, `SELECT s.id,s.name,(s.publication_state='published'),COALESCE(o.state,''),COALESCE(o.version,0)
 FROM dsh.stores s
 JOIN dsh.commerce_promotions p ON p.id=$1 AND p.store_id IS NULL
 LEFT JOIN dsh.commerce_promotion_store_opt_ins o ON o.promotion_id=p.id AND o.store_id=s.id
 WHERE ((s.publication_state='published' AND (p.service_city_id IS NULL OR p.service_city_id=s.service_city_id))
        OR o.state IS NOT NULL)
   AND s.id>$2
   AND ($3='' OR ($3='PENDING' AND o.state IS NULL) OR o.state=$3)
 ORDER BY s.id ASC LIMIT $4`, promotionID, cursor, decision, limit+1)
	if err != nil {
		return OperatorPartnerDecisionPage{}, err
	}
	defer rows.Close()
	page := OperatorPartnerDecisionPage{Items: make([]OperatorPartnerDecision, 0, limit)}
	for rows.Next() {
		var record OperatorPartnerDecision
		if err := rows.Scan(&record.StoreID, &record.StoreName, &record.StorePublished, &record.Decision, &record.Version); err != nil {
			return OperatorPartnerDecisionPage{}, err
		}
		page.Items = append(page.Items, record)
	}
	if err := rows.Err(); err != nil {
		return OperatorPartnerDecisionPage{}, err
	}
	if len(page.Items) > limit {
		page.Items = page.Items[:limit]
		page.NextCursor = page.Items[len(page.Items)-1].StoreID
	}
	return page, nil
}
