package postgres

import (
	"context"
	"database/sql"
	"errors"
	"strings"
)

type PublicShoppingShortcutRecord struct {
	ID         string `json:"id"`
	VerticalID string `json:"verticalId"`
	TitleAr    string `json:"titleAr"`
	Ordinal    int    `json:"ordinal"`
}

// ListPublicShoppingShortcuts returns populated presentation shortcuts only.
// The internal StoreTypeIDs/CategoryIDs are never part of the public read model.
// The canonical customer-visible offer view owns publication/availability checks.
func ListPublicShoppingShortcuts(ctx context.Context, db *sql.DB, cityID, verticalID string) ([]PublicShoppingShortcutRecord, error) {
	cityID, verticalID = strings.TrimSpace(cityID), strings.TrimSpace(verticalID)
	if db == nil || cityID == "" || len(cityID) > 128 || len(verticalID) > 128 {
		return nil, errors.New("invalid public shortcut scope")
	}
	const statement = `
SELECT shortcut.id,shortcut.vertical_id,shortcut.title_ar,shortcut.ordinal
FROM dsh.catalog_shopping_shortcuts shortcut
JOIN dsh.commerce_verticals cv ON cv.id=shortcut.vertical_id AND cv.active=true
JOIN dsh.service_cities city ON city.id=$1 AND city.active=true
WHERE shortcut.active=true AND ($2='' OR shortcut.vertical_id=$2)
AND EXISTS (
    SELECT 1
    FROM dsh.stores store
    JOIN dsh.catalog_store_offers offer ON offer.store_id=store.id
    JOIN dsh.catalog_customer_visible_offers visible ON visible.offer_id=offer.id
    JOIN dsh.catalog_product_variants variant ON variant.id=offer.variant_id
    JOIN dsh.catalog_products product ON product.id=variant.product_id
    WHERE store.primary_vertical_id=shortcut.vertical_id AND store.service_city_id=city.id
      AND store.publication_state='published' AND store.publication_changed_at IS NOT NULL
      AND EXISTS (SELECT 1 FROM dsh.joining_cases joined WHERE joined.partner_actor_id=store.partner_actor_id
                  AND joined.financial_profile_state='ACTIVE')
      AND dsh.shopping_shortcut_matches_product(shortcut.id,store.id,product.id)
)
ORDER BY shortcut.vertical_id,shortcut.ordinal,lower(shortcut.title_ar),shortcut.id
LIMIT 100`
	rows, err := db.QueryContext(ctx, statement, cityID, verticalID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]PublicShoppingShortcutRecord, 0)
	for rows.Next() {
		var s PublicShoppingShortcutRecord
		if err = rows.Scan(&s.ID, &s.VerticalID, &s.TitleAr, &s.Ordinal); err != nil {
			return nil, err
		}
		items = append(items, s)
	}
	return items, rows.Err()
}
