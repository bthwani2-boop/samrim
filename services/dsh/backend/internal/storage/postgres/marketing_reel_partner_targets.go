package postgres

import (
	"context"
	"database/sql"
	"strings"
)

type PartnerReelTarget struct {
	TargetType string `json:"targetType"`
	TargetID   string `json:"targetId"`
	Label      string `json:"label"`
}

// PartnerReelTargetBelongsToStore binds every submitted Product/Promotion
// to a store which was authorized from the actual user session.
func PartnerReelTargetBelongsToStore(ctx context.Context, src discoveryContentTargetQuerier, storeID, targetType, targetID string) (bool, error) {
	storeID = strings.TrimSpace(storeID)
	targetID = strings.TrimSpace(targetID)
	if storeID == "" || targetID == "" {
		return false, nil
	}
	var sqlText string
	switch targetType {
	case "STORE":
		return storeID == targetID, nil
	case "PRODUCT":
		sqlText = `SELECT EXISTS(
    SELECT 1 FROM dsh.catalog_store_offers offer
    JOIN dsh.catalog_product_variants variant ON variant.id=offer.variant_id
    WHERE offer.store_id=$1 AND variant.product_id=$2
  )`
	case "PROMOTION":
		sqlText = `SELECT EXISTS(
    SELECT 1 FROM dsh.commerce_promotions promotion
    WHERE promotion.id=$2 AND promotion.store_id=$1
  )`
	default:
		return false, nil
	}
	var owned bool
	if err := src.QueryRowContext(ctx, sqlText, storeID, targetID).Scan(&owned); err != nil {
		return false, err
	}
	return owned, nil
}

// ListPartnerReelTargets returns only linked products and Promotions of this
// Store, never global catalog or platform-wide promotions.
func ListPartnerReelTargets(ctx context.Context, db *sql.DB, storeID string) ([]PartnerReelTarget, error) {
	storeID = strings.TrimSpace(storeID)
	if storeID == "" {
		return nil, ErrDiscoveryContentInvalid
	}
	rows, err := db.QueryContext(ctx, `
   SELECT target_type,target_id,label FROM (
     SELECT 'PRODUCT'::text AS target_type,product.id AS target_id,product.canonical_name AS label,0 AS priority
     FROM dsh.catalog_store_offers offer
     JOIN dsh.catalog_product_variants variant ON variant.id=offer.variant_id
     JOIN dsh.catalog_products product ON product.id=variant.product_id
     WHERE offer.store_id=$1
     UNION ALL
     SELECT 'PROMOTION',promotion.id,promotion.name_ar,1
     FROM dsh.commerce_promotions promotion
     WHERE promotion.store_id=$1 AND promotion.state<>'ENDED'
   ) options
   GROUP BY target_type,target_id,label,priority
   ORDER BY priority,label,target_id LIMIT 80
 `, storeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]PartnerReelTarget, 0)
	for rows.Next() {
		var item PartnerReelTarget
		if err := rows.Scan(&item.TargetType, &item.TargetID, &item.Label); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}
