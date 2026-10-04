package postgres

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"time"
)

var ErrCatalogQuickPriceInvalidFilter = errors.New("catalog quick price filter is invalid")

type CatalogQuickPriceUpdateInput struct {
	OfferID         string
	ExpectedVersion int
	PriceMinor      int64
}

type CatalogQuickPriceUpdateResult struct {
	OfferID string
	Outcome string
	Offer   *CatalogStoreOfferRecord
}

func HashCatalogQuickPriceItemKey(idempotencyKey, storeID, offerID string) string {
	return hashFacts("catalog-quick-prices", strings.TrimSpace(idempotencyKey), strings.TrimSpace(storeID), strings.TrimSpace(offerID))
}

type CatalogQuickPriceFilters struct {
	Query            string
	CategoryID       string
	Availability     string
	PublicationState string
}

type catalogQuickPriceCursor struct {
	Version    int       `json:"v"`
	StoreID    string    `json:"storeId"`
	FilterHash string    `json:"filterHash"`
	CreatedAt  time.Time `json:"createdAt"`
	OfferID    string    `json:"offerId"`
}

func ListCatalogQuickPriceOffers(ctx context.Context, db *sql.DB, storeID string, filters CatalogQuickPriceFilters, limit int, rawCursor string) (CatalogStoreOfferPage, error) {
	storeID = strings.TrimSpace(storeID)
	filters.Query = strings.TrimSpace(filters.Query)
	filters.CategoryID = strings.TrimSpace(filters.CategoryID)
	filters.Availability = strings.TrimSpace(filters.Availability)
	filters.PublicationState = strings.TrimSpace(filters.PublicationState)
	if filters.Availability == "" {
		filters.Availability = "all"
	}
	if filters.PublicationState == "" {
		filters.PublicationState = "all"
	}
	if db == nil || storeID == "" || len(storeID) > 128 || len(filters.Query) > 160 || len(filters.CategoryID) > 128 || limit < 1 || limit > 100 || len(rawCursor) > 2048 {
		return CatalogStoreOfferPage{}, ErrCatalogQuickPriceInvalidFilter
	}
	if filters.Availability != "all" && filters.Availability != "available" && filters.Availability != "unavailable" {
		return CatalogStoreOfferPage{}, ErrCatalogQuickPriceInvalidFilter
	}
	if filters.PublicationState != "all" && filters.PublicationState != "draft" && filters.PublicationState != "published" && filters.PublicationState != "hidden" {
		return CatalogStoreOfferPage{}, ErrCatalogQuickPriceInvalidFilter
	}
	filterHash := hashFacts("catalog-quick-price-filter", filters.Query, filters.CategoryID, filters.Availability, filters.PublicationState)
	cursor, err := decodeQuickPriceCursor(rawCursor, storeID, filterHash)
	if err != nil {
		return CatalogStoreOfferPage{}, err
	}
	query := catalogOfferSelect + ` WHERE o.store_id=$1
		AND ($2='' OR strpos(lower(p.canonical_name),lower($2))>0 OR strpos(lower(v.title),lower($2))>0 OR EXISTS (
			SELECT 1 FROM dsh.catalog_variant_identifiers qi WHERE qi.variant_id=v.id AND strpos(lower(qi.identifier_value),lower($2))>0
		))
		AND ($3='' OR EXISTS (SELECT 1 FROM dsh.catalog_product_categories pc WHERE pc.product_id=p.id AND pc.category_id=$3))
		AND ($4='all' OR ($4='available' AND o.availability=true) OR ($4='unavailable' AND o.availability=false))
		AND ($5='all' OR o.publication_state=$5)`
	args := []any{storeID, filters.Query, filters.CategoryID, filters.Availability, filters.PublicationState}
	if cursor != nil {
		args = append(args, cursor.CreatedAt, cursor.OfferID)
		query += " AND (o.created_at,o.id)>($6,$7)"
	}
	args = append(args, limit+1)
	query += " ORDER BY o.created_at ASC,o.id ASC LIMIT $" + itoa(len(args))
	rows, err := db.QueryContext(ctx, query, args...)
	if err != nil {
		return CatalogStoreOfferPage{}, err
	}
	items := make([]CatalogStoreOfferRecord, 0, limit+1)
	for rows.Next() {
		item, scanErr := scanCatalogOffer(rows)
		if scanErr != nil {
			_ = rows.Close()
			return CatalogStoreOfferPage{}, scanErr
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return CatalogStoreOfferPage{}, err
	}
	if err := rows.Close(); err != nil {
		return CatalogStoreOfferPage{}, err
	}
	page := CatalogStoreOfferPage{Offers: items}
	if len(items) > limit {
		page.Offers = items[:limit]
		last := page.Offers[len(page.Offers)-1]
		page.NextCursor, err = encodeQuickPriceCursor(catalogQuickPriceCursor{Version: 2, StoreID: storeID, FilterHash: filterHash, CreatedAt: last.CreatedAt.UTC(), OfferID: last.ID})
		if err != nil {
			return CatalogStoreOfferPage{}, err
		}
	}
	if err := hydrateCatalogOfferPage(ctx, db, page.Offers); err != nil {
		return CatalogStoreOfferPage{}, err
	}
	return page, nil
}

func encodeQuickPriceCursor(cursor catalogQuickPriceCursor) (string, error) {
	value, err := json.Marshal(cursor)
	if err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(value), nil
}

func decodeQuickPriceCursor(raw, storeID, filterHash string) (*catalogQuickPriceCursor, error) {
	if strings.TrimSpace(raw) == "" {
		return nil, nil
	}
	value, err := base64.RawURLEncoding.DecodeString(strings.TrimSpace(raw))
	if err != nil {
		return nil, ErrCatalogOfferInvalidCursor
	}
	var cursor catalogQuickPriceCursor
	if json.Unmarshal(value, &cursor) != nil || cursor.Version != 2 || cursor.StoreID != storeID || cursor.FilterHash != filterHash || cursor.CreatedAt.IsZero() || strings.TrimSpace(cursor.OfferID) == "" {
		return nil, ErrCatalogOfferInvalidCursor
	}
	return &cursor, nil
}
