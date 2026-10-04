package postgres

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
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
	CategoryIDs                   []string
	CreatedAt, UpdatedAt          time.Time
}

type CatalogProductRegistryPage struct {
	Products   []CatalogProductRegistryItem
	NextCursor string
}

type catalogProductRegistryCursor struct {
	Version    int    `json:"v"`
	Query      string `json:"q"`
	VerticalID string `json:"verticalId"`
	CategoryID string `json:"categoryId"`
	Active     string `json:"active"`
	Sort       string `json:"sort"`
	Value      string `json:"value"`
	ProductID  string `json:"productId"`
}

func ListCatalogProductRegistry(ctx context.Context, db *sql.DB, query, verticalID, categoryID, active, sort string, limit int, rawCursor string) (CatalogProductRegistryPage, error) {
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
	if limit < 1 || limit > 100 || (active != "all" && active != "active" && active != "inactive") || (sort != "name_asc" && sort != "name_desc" && sort != "updated_desc" && sort != "updated_asc") {
		return CatalogProductRegistryPage{}, ErrCatalogProductRegistryInvalidCursor
	}
	cursor, err := decodeCatalogProductRegistryCursor(rawCursor, query, verticalID, categoryID, active, sort)
	if err != nil {
		return CatalogProductRegistryPage{}, err
	}
	var cursorNameKey string
	var cursorUpdatedAt any
	var cursorProductID string
	if cursor != nil {
		if strings.HasPrefix(sort, "updated_") {
			cursorUpdatedAt = cursor.Value
		} else {
			cursorNameKey = cursor.Value
		}
		cursorProductID = cursor.ProductID
	}
	const querySQL = `SELECT product.id,product.vertical_id,product.canonical_name,product.brand,product.active,product.version,COUNT(DISTINCT variant.id),
		ARRAY(SELECT pc.category_id FROM dsh.catalog_product_categories pc WHERE pc.product_id=product.id ORDER BY pc.category_id),
		(SELECT ma.uri FROM dsh.catalog_media cm JOIN dsh.catalog_media_assets ma ON ma.product_id=cm.product_id AND ma.id=cm.media_asset_id AND ma.state='active' AND ma.rights_attested_at IS NOT NULL WHERE cm.product_id=product.id AND cm.media_role='primary' ORDER BY cm.ordinal LIMIT 1),
		(SELECT COUNT(DISTINCT o.store_id) FROM dsh.catalog_store_offers o JOIN dsh.catalog_product_variants v ON v.id=o.variant_id WHERE v.product_id=product.id AND EXISTS (SELECT 1 FROM dsh.catalog_customer_visible_offers visible WHERE visible.offer_id=o.id)),
		product.created_at,product.updated_at
		FROM dsh.catalog_products product JOIN dsh.commerce_verticals cv ON cv.id=product.vertical_id LEFT JOIN dsh.catalog_product_variants variant ON variant.product_id=product.id
		WHERE product.scope='SHARED' AND cv.active=true
		AND ($1='' OR product.canonical_name ILIKE '%'||$1||'%' OR COALESCE(product.brand,'') ILIKE '%'||$1||'%')
		AND ($2='' OR product.vertical_id=$2)
		AND ($3='' OR EXISTS (WITH RECURSIVE category_subtree(id) AS (
			SELECT c.id FROM dsh.catalog_categories c WHERE c.id=$3 AND c.vertical_id=product.vertical_id AND c.active=true
			UNION SELECT child.id FROM dsh.catalog_categories child JOIN category_subtree parent ON child.parent_category_id=parent.id WHERE child.vertical_id=product.vertical_id AND child.active=true
		) SELECT 1 FROM dsh.catalog_product_categories pc JOIN category_subtree subtree ON subtree.id=pc.category_id WHERE pc.product_id=product.id))
		AND ($4='all' OR product.active=($4='active'))
		AND (NOT $8::boolean
			OR ($9='name_asc' AND (lower(product.canonical_name),product.id)>($5::text,$7::text))
			OR ($9='name_desc' AND (lower(product.canonical_name),product.id)<($5::text,$7::text))
			OR ($9='updated_asc' AND (product.updated_at,product.id)>($6::timestamptz,$7::text))
			OR ($9='updated_desc' AND (product.updated_at,product.id)<($6::timestamptz,$7::text)))
		GROUP BY product.id
		ORDER BY CASE WHEN $9='name_asc' THEN lower(product.canonical_name) END ASC,CASE WHEN $9='name_desc' THEN lower(product.canonical_name) END DESC,
		CASE WHEN $9='updated_asc' THEN product.updated_at END ASC,CASE WHEN $9='updated_desc' THEN product.updated_at END DESC,
		CASE WHEN $9 IN ('name_asc','updated_asc') THEN product.id END ASC,CASE WHEN $9 IN ('name_desc','updated_desc') THEN product.id END DESC
		LIMIT $10`
	rows, err := db.QueryContext(ctx, querySQL, query, verticalID, categoryID, active, cursorNameKey, cursorUpdatedAt, cursorProductID, cursor != nil, sort, limit+1)
	if err != nil {
		return CatalogProductRegistryPage{}, err
	}
	defer rows.Close()
	items := make([]CatalogProductRegistryItem, 0, limit+1)
	for rows.Next() {
		var item CatalogProductRegistryItem
		var categories pq.StringArray
		if err := rows.Scan(&item.ID, &item.VerticalID, &item.CanonicalName, &item.Brand, &item.Active, &item.Version, &item.VariantCount, &categories, &item.PrimaryImageURI, &item.StoreCount, &item.CreatedAt, &item.UpdatedAt); err != nil {
			return CatalogProductRegistryPage{}, err
		}
		item.CategoryIDs = []string(categories)
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return CatalogProductRegistryPage{}, err
	}
	page := CatalogProductRegistryPage{Products: items}
	if len(items) > limit {
		page.Products = items[:limit]
		last := page.Products[len(page.Products)-1]
		value := strings.ToLower(last.CanonicalName)
		if strings.HasPrefix(sort, "updated_") {
			value = last.UpdatedAt.UTC().Format(time.RFC3339Nano)
		}
		page.NextCursor, err = encodeCatalogProductRegistryCursor(catalogProductRegistryCursor{Version: 1, Query: query, VerticalID: verticalID, CategoryID: categoryID, Active: active, Sort: sort, Value: value, ProductID: last.ID})
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
func decodeCatalogProductRegistryCursor(raw, query, verticalID, categoryID, active, sort string) (*catalogProductRegistryCursor, error) {
	if strings.TrimSpace(raw) == "" {
		return nil, nil
	}
	b, err := base64.RawURLEncoding.DecodeString(strings.TrimSpace(raw))
	if err != nil {
		return nil, ErrCatalogProductRegistryInvalidCursor
	}
	var cursor catalogProductRegistryCursor
	if json.Unmarshal(b, &cursor) != nil || cursor.Version != 1 || cursor.Value == "" || cursor.ProductID == "" || cursor.Query != query || cursor.VerticalID != verticalID || cursor.CategoryID != categoryID || cursor.Active != active || cursor.Sort != sort {
		return nil, ErrCatalogProductRegistryInvalidCursor
	}
	return &cursor, nil
}
