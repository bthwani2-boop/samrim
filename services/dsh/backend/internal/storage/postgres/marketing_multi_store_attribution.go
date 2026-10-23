package postgres

import (
	"context"
	"database/sql"
	"errors"
	"strings"
)

// ResolveMultiStoreDiscoveryAttributionStore selects the single child merchant
// whose catalog is the clicked destination. General/ambiguous campaigns are
// not arbitrarily attributed to the first successful child order.
func ResolveMultiStoreDiscoveryAttributionStore(ctx context.Context, db *sql.DB, clickID, actorID string, children []MultiStoreCheckoutChildInput) (string, error) {
	clickID = strings.TrimSpace(clickID)
	actorID = strings.TrimSpace(actorID)
	if clickID == "" || actorID == "" || len(clickID) > 128 || len(actorID) > 128 || len(children) < 2 || db == nil {
		return "", nil
	}
	var targetType, targetID, promotionStoreID string
	err := db.QueryRowContext(ctx, `SELECT content.target_type,COALESCE(content.target_id,''),COALESCE(promotion.store_id,'')
		FROM dsh.discovery_content_events click
		JOIN dsh.discovery_content content ON content.id=click.content_id
		LEFT JOIN dsh.commerce_promotions promotion ON content.target_type='PROMOTION' AND promotion.id=content.target_id
		WHERE click.client_event_id=$1 AND click.event_type='CLICK'
          AND (click.client_actor_id IS NULL OR click.client_actor_id=$2)`, clickID, actorID).Scan(&targetType, &targetID, &promotionStoreID)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	var matchedStore string
	for _, child := range children {
		store := strings.TrimSpace(child.StoreID)
		if store == "" {
			continue
		}
		matched := false
		switch targetType {
		case "STORE":
			matched = targetID == store
		case "PROMOTION":
			// Platform-wide promotions have no uniquely attributable store.
			matched = promotionStoreID != "" && promotionStoreID == store
		case "PRODUCT", "CATEGORY":
			// A product/category can appear at multiple merchants. Attribute
			// only if exactly one of the selected child stores offers it.
			err = db.QueryRowContext(ctx, `SELECT EXISTS (
				SELECT 1 FROM dsh.catalog_store_offers offer
				JOIN dsh.catalog_product_variants variant ON variant.id=offer.variant_id
				JOIN dsh.catalog_products product ON product.id=variant.product_id
				WHERE offer.store_id=$1
				  AND EXISTS (SELECT 1 FROM dsh.catalog_customer_visible_offers visible WHERE visible.offer_id=offer.id)
				  AND (($2='PRODUCT' AND product.id=$3) OR
				    ($2='CATEGORY' AND EXISTS (
						SELECT 1 FROM dsh.catalog_product_categories category
						WHERE category.product_id=product.id AND category.category_id=$3
				    )))
			)`, store, targetType, targetID).Scan(&matched)
			if err != nil {
				return "", err
			}
		default:
			continue
		}
		if matched {
			if matchedStore != "" {
				return "", nil
			}
			matchedStore = store
		}
	}
	return matchedStore, nil
}
