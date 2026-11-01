package postgres

import (
	"context"
	"database/sql"
	"errors"
	"strings"
)

type CatalogInventorySummary struct {
	StoreID           string
	TotalOffers       int64
	PublishedOffers   int64
	AvailableOffers   int64
	UnavailableOffers int64
	StockoutOffers    int64
}

// ReadCatalogInventorySummary uses the canonical StoreOffer rows, not a client-side
// preview page. "Available" concerns offer/catalog eligibility only, not Store
// operational orderability or geographic serviceability.
func ReadCatalogInventorySummary(ctx context.Context, db *sql.DB, storeID string) (CatalogInventorySummary, error) {
	storeID = strings.TrimSpace(storeID)
	if db == nil {
		return CatalogInventorySummary{}, errors.New("DSH database is nil")
	}
	if storeID == "" || len(storeID) > 128 {
		return CatalogInventorySummary{}, ErrCatalogOfferInvalidCursor
	}
	// A single static SQL statement keeps untrusted Store IDs in the $1 bind parameter.
	const query = `SELECT s.id,
 COUNT(o.id),
 COUNT(o.id) FILTER (WHERE o.publication_state='published'),
 COUNT(o.id) FILTER (WHERE o.publication_state='published'
   AND o.availability AND COALESCE(p.active,false) AND p.deleted_at IS NULL
   AND COALESCE(v.active,false) AND (o.inventory_policy <> 'QUANTITY_ON_HAND' OR o.inventory_on_hand_base_units > o.inventory_reserved_base_units)),
 COUNT(o.id) FILTER (WHERE o.publication_state='published'
   AND NOT (o.availability AND COALESCE(p.active,false) AND p.deleted_at IS NULL
   AND COALESCE(v.active,false) AND (o.inventory_policy <> 'QUANTITY_ON_HAND' OR o.inventory_on_hand_base_units > o.inventory_reserved_base_units))),
 COUNT(o.id) FILTER (WHERE o.publication_state='published' AND o.inventory_policy='QUANTITY_ON_HAND' AND o.inventory_on_hand_base_units <= o.inventory_reserved_base_units)
 FROM dsh.stores s
 LEFT JOIN dsh.catalog_store_offers o ON o.store_id=s.id
 LEFT JOIN dsh.catalog_product_variants v ON v.id=o.variant_id
 LEFT JOIN dsh.catalog_products p ON p.id=v.product_id
 WHERE s.id=$1 GROUP BY s.id`
	var result CatalogInventorySummary
	err := db.QueryRowContext(ctx, query, storeID).Scan(&result.StoreID, &result.TotalOffers, &result.PublishedOffers, &result.AvailableOffers, &result.UnavailableOffers, &result.StockoutOffers)
	if errors.Is(err, sql.ErrNoRows) {
		return CatalogInventorySummary{}, ErrStoreNotFound
	}
	if err != nil {
		return CatalogInventorySummary{}, err
	}
	return result, nil
}
