package postgres

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"time"

	"github.com/lib/pq"
)

var ErrCatalogProductRegistryInvalidCursor = errors.New("catalog Product registry cursor is invalid")

type CatalogProductRegistryItem struct {
	ID, VerticalID, CanonicalName string
	Brand, PrimaryImageURI        *string
	Active                        bool
	Version, VariantCount         int
	StoreCount                    int
	CategoryIDs, CategoryNamesAr  []string
	CreatedAt, UpdatedAt          time.Time
}

type CatalogProductRegistryPage struct {
	Products   []CatalogProductRegistryItem
	NextCursor string
	TotalCount int64
	MeasuredAt time.Time
}

type catalogProductRegistryCursor struct {
	Version         int    `json:"v"`
	Query           string `json:"q"`
	VerticalID      string `json:"verticalId"`
	CategoryID      string `json:"categoryId"`
	Active          string `json:"active"`
	MinVariantCount int    `json:"minVariantCount"`
	MinStoreCount   int    `json:"minStoreCount"`
	Sort            string `json:"sort"`
	Value           string `json:"value"`
	ProductID       string `json:"productId"`
}

func ListCatalogProductRegistry(ctx context.Context, db *sql.DB, query, verticalID, categoryID, active string, minVariantCount, minStoreCount int, sort string, limit int, rawCursor string) (CatalogProductRegistryPage, error) {
	query = strings.TrimSpace(query)
	verticalID = strings.TrimSpace(verticalID)
	categoryID = strings.TrimSpace(categoryID)
	active = strings.TrimSpace(active)
	sort = strings.TrimSpace(sort)
	if active == "" {
		active = "all"
	}
	if sort == "" {
		sort = "name_asc"
	}
	if limit < 1 || limit > 100 || minVariantCount < 0 || minStoreCount < 0 || (active != "all" && active != "active" && active != "inactive") || !validCatalogProductRegistrySort(sort) {
		return CatalogProductRegistryPage{}, ErrCatalogProductRegistryInvalidCursor
	}
	cursor, err := decodeCatalogProductRegistryCursor(rawCursor, query, verticalID, categoryID, active, minVariantCount, minStoreCount, sort)
	if err != nil {
		return CatalogProductRegistryPage{}, err
	}
	var cursorNameKey string
	var cursorUpdatedAt any
	var cursorProductID string
	var cursorCount int
	if cursor != nil {
		if strings.HasPrefix(sort, "updated_") {
			cursorUpdatedAt = cursor.Value
		} else {
			cursorNameKey = cursor.Value
		}
		if strings.HasPrefix(sort, "variants_") || strings.HasPrefix(sort, "stores_") {
			cursorCount, err = strconv.Atoi(cursor.Value)
			if err != nil || cursorCount < 0 {
				return CatalogProductRegistryPage{}, ErrCatalogProductRegistryInvalidCursor
			}
		}
		cursorProductID = cursor.ProductID
	}
	const registryFilterSQL = `WHERE product.scope='SHARED' AND cv.active=true AND product.deleted_at IS NULL
		AND ($1='' OR product.canonical_name ILIKE '%'||$1||'%' OR COALESCE(product.brand,'') ILIKE '%'||$1||'%')
		AND ($2='' OR product.vertical_id=$2)
		AND ($3='' OR EXISTS (WITH RECURSIVE category_subtree(id) AS (
			SELECT c.id FROM dsh.catalog_categories c WHERE c.id=$3 AND c.vertical_id=product.vertical_id AND c.active=true
			UNION SELECT child.id FROM dsh.catalog_categories child JOIN category_subtree parent ON child.parent_category_id=parent.id WHERE child.vertical_id=product.vertical_id AND child.active=true
		) SELECT 1 FROM dsh.catalog_product_categories pc JOIN category_subtree subtree ON subtree.id=pc.category_id WHERE pc.product_id=product.id))
		AND ($4='all' OR product.active=($4='active'))`
	const storeCountSQL = `COALESCE(catalog_store_counts.store_count,0)`
	const querySQL = `SELECT product.id,product.vertical_id,product.canonical_name,product.brand,product.active,product.version,COUNT(DISTINCT variant.id),
		ARRAY(SELECT pc.category_id FROM dsh.catalog_product_categories pc WHERE pc.product_id=product.id ORDER BY pc.category_id),
		ARRAY(SELECT category.name_ar FROM dsh.catalog_product_categories pc JOIN dsh.catalog_categories category ON category.id=pc.category_id WHERE pc.product_id=product.id ORDER BY category.name_ar,category.id),
		(SELECT ma.uri FROM dsh.catalog_media cm JOIN dsh.catalog_media_assets ma ON ma.product_id=cm.product_id AND ma.id=cm.media_asset_id AND ma.state='active' AND ma.rights_attested_at IS NOT NULL WHERE cm.product_id=product.id AND cm.media_role='primary' ORDER BY cm.ordinal LIMIT 1),
		` + storeCountSQL + `,product.created_at,product.updated_at
		FROM dsh.catalog_products product JOIN dsh.commerce_verticals cv ON cv.id=product.vertical_id LEFT JOIN dsh.catalog_product_variants variant ON variant.product_id=product.id LEFT JOIN (SELECT offer_variant.product_id,COUNT(DISTINCT o.store_id) AS store_count FROM dsh.catalog_store_offers o JOIN dsh.catalog_product_variants offer_variant ON offer_variant.id=o.variant_id WHERE EXISTS (SELECT 1 FROM dsh.catalog_customer_visible_offers visible WHERE visible.offer_id=o.id) GROUP BY offer_variant.product_id) catalog_store_counts ON catalog_store_counts.product_id=product.id
		` + registryFilterSQL + `
		GROUP BY product.id,catalog_store_counts.store_count
		HAVING COUNT(DISTINCT variant.id)>=$5 AND ` + storeCountSQL + `>=$6
		AND (NOT $10::boolean
			OR ($11='name_asc' AND (lower(product.canonical_name),product.id)>($7::text,$9::text))
			OR ($11='name_desc' AND (lower(product.canonical_name),product.id)<($7::text,$9::text))
			OR ($11='updated_asc' AND (product.updated_at,product.id)>($8::timestamptz,$9::text))
			OR ($11='updated_desc' AND (product.updated_at,product.id)<($8::timestamptz,$9::text))
			OR ($11='variants_asc' AND (COUNT(DISTINCT variant.id),product.id)>($13::integer,$9::text))
			OR ($11='variants_desc' AND (COUNT(DISTINCT variant.id),product.id)<($13::integer,$9::text))
			OR ($11='stores_asc' AND (` + storeCountSQL + `,product.id)>($13::integer,$9::text))
			OR ($11='stores_desc' AND (` + storeCountSQL + `,product.id)<($13::integer,$9::text)))
		ORDER BY CASE WHEN $11='name_asc' THEN lower(product.canonical_name) END ASC,CASE WHEN $11='name_desc' THEN lower(product.canonical_name) END DESC,
		CASE WHEN $11='updated_asc' THEN product.updated_at END ASC,CASE WHEN $11='updated_desc' THEN product.updated_at END DESC,
		CASE WHEN $11='variants_asc' THEN COUNT(DISTINCT variant.id) END ASC,CASE WHEN $11='variants_desc' THEN COUNT(DISTINCT variant.id) END DESC,
		CASE WHEN $11='stores_asc' THEN ` + storeCountSQL + ` END ASC,CASE WHEN $11='stores_desc' THEN ` + storeCountSQL + ` END DESC,
		CASE WHEN $11 IN ('name_asc','updated_asc','variants_asc','stores_asc') THEN product.id END ASC,CASE WHEN $11 IN ('name_desc','updated_desc','variants_desc','stores_desc') THEN product.id END DESC
		LIMIT $12`
	countSQL := `SELECT COUNT(*),CURRENT_TIMESTAMP FROM (SELECT product.id,COUNT(DISTINCT variant.id)
		FROM dsh.catalog_products product JOIN dsh.commerce_verticals cv ON cv.id=product.vertical_id LEFT JOIN dsh.catalog_product_variants variant ON variant.product_id=product.id LEFT JOIN (SELECT offer_variant.product_id,COUNT(DISTINCT o.store_id) AS store_count FROM dsh.catalog_store_offers o JOIN dsh.catalog_product_variants offer_variant ON offer_variant.id=o.variant_id WHERE EXISTS (SELECT 1 FROM dsh.catalog_customer_visible_offers visible WHERE visible.offer_id=o.id) GROUP BY offer_variant.product_id) catalog_store_counts ON catalog_store_counts.product_id=product.id
		` + registryFilterSQL + ` GROUP BY product.id,catalog_store_counts.store_count HAVING COUNT(DISTINCT variant.id)>=$5 AND ` + storeCountSQL + `>=$6) filtered`
	// Count and page share one repeatable-read snapshot and exactly the same filters.
	tx, err := db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	if err != nil {
		return CatalogProductRegistryPage{}, err
	}
	defer tx.Rollback()
	var totalCount int64
	var measuredAt time.Time
	if err := tx.QueryRowContext(ctx, countSQL, query, verticalID, categoryID, active, minVariantCount, minStoreCount).Scan(&totalCount, &measuredAt); err != nil {
		return CatalogProductRegistryPage{}, err
	}
	rows, err := tx.QueryContext(ctx, querySQL, query, verticalID, categoryID, active, minVariantCount, minStoreCount, cursorNameKey, cursorUpdatedAt, cursorProductID, cursor != nil, sort, limit+1, cursorCount)
	if err != nil {
		return CatalogProductRegistryPage{}, err
	}
	defer rows.Close()
	items := make([]CatalogProductRegistryItem, 0, limit+1)
	for rows.Next() {
		var item CatalogProductRegistryItem
		var categories, categoryNames pq.StringArray
		if err := rows.Scan(&item.ID, &item.VerticalID, &item.CanonicalName, &item.Brand, &item.Active, &item.Version, &item.VariantCount, &categories, &categoryNames, &item.PrimaryImageURI, &item.StoreCount, &item.CreatedAt, &item.UpdatedAt); err != nil {
			return CatalogProductRegistryPage{}, err
		}
		item.CategoryIDs = append([]string{}, categories...)
		item.CategoryNamesAr = append([]string{}, categoryNames...)
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return CatalogProductRegistryPage{}, err
	}
	if err := rows.Close(); err != nil {
		return CatalogProductRegistryPage{}, err
	}
	if err := tx.Commit(); err != nil {
		return CatalogProductRegistryPage{}, err
	}
	page := CatalogProductRegistryPage{Products: items, TotalCount: totalCount, MeasuredAt: measuredAt}
	if len(items) > limit {
		page.Products = items[:limit]
		last := page.Products[len(page.Products)-1]
		value := strings.ToLower(last.CanonicalName)
		if strings.HasPrefix(sort, "updated_") {
			value = last.UpdatedAt.UTC().Format(time.RFC3339Nano)
		} else if strings.HasPrefix(sort, "variants_") {
			value = strconv.Itoa(last.VariantCount)
		} else if strings.HasPrefix(sort, "stores_") {
			value = strconv.Itoa(last.StoreCount)
		}
		page.NextCursor, err = encodeCatalogProductRegistryCursor(catalogProductRegistryCursor{Version: 1, Query: query, VerticalID: verticalID, CategoryID: categoryID, Active: active, MinVariantCount: minVariantCount, MinStoreCount: minStoreCount, Sort: sort, Value: value, ProductID: last.ID})
		if err != nil {
			return CatalogProductRegistryPage{}, err
		}
	}
	return page, nil
}

func encodeCatalogProductRegistryCursor(cursor catalogProductRegistryCursor) (string, error) {
	b, err := json.Marshal(cursor)
	if err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}
func validCatalogProductRegistrySort(sort string) bool {
	return sort == "name_asc" || sort == "name_desc" || sort == "updated_desc" || sort == "updated_asc" || sort == "variants_asc" || sort == "variants_desc" || sort == "stores_asc" || sort == "stores_desc"
}

func decodeCatalogProductRegistryCursor(raw, query, verticalID, categoryID, active string, minVariantCount, minStoreCount int, sort string) (*catalogProductRegistryCursor, error) {
	if strings.TrimSpace(raw) == "" {
		return nil, nil
	}
	b, err := base64.RawURLEncoding.DecodeString(strings.TrimSpace(raw))
	if err != nil {
		return nil, ErrCatalogProductRegistryInvalidCursor
	}
	var cursor catalogProductRegistryCursor
	if json.Unmarshal(b, &cursor) != nil || cursor.Version != 1 || cursor.Value == "" || cursor.ProductID == "" || cursor.Query != query || cursor.VerticalID != verticalID || cursor.CategoryID != categoryID || cursor.Active != active || cursor.MinVariantCount != minVariantCount || cursor.MinStoreCount != minStoreCount || cursor.Sort != sort {
		return nil, ErrCatalogProductRegistryInvalidCursor
	}
	return &cursor, nil
}
