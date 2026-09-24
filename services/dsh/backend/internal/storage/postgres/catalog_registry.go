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
	args := []any{query, verticalID, categoryID, active}
	where := `p.scope='SHARED' AND cv.catalog_model='SHARED_CATALOG' AND ($1='' OR p.canonical_name ILIKE '%'||$1||'%' OR COALESCE(p.brand,'') ILIKE '%'||$1||'%') AND ($2='' OR p.vertical_id=$2) AND ($3='' OR EXISTS (SELECT 1 FROM dsh.catalog_product_categories pc WHERE pc.product_id=p.id AND pc.category_id=$3)) AND ($4='all' OR p.active=($4='active'))`
	if cursor != nil {
		args = append(args, cursor.Value, cursor.ProductID)
		valueArg, idArg := len(args)-1, len(args)
		valueExpr := `lower(p.canonical_name)`
		operator := `>`
		if sort == "name_desc" {
			operator = `<`
		}
		if strings.HasPrefix(sort, "updated_") {
			valueExpr = `p.updated_at`
			args[len(args)-2] = cursor.Value
			if sort == "updated_desc" {
				operator = `<`
			} else {
				operator = `>`
			}
			where += ` AND (` + valueExpr + ` ` + operator + ` $` + strconv.Itoa(valueArg) + `::timestamptz OR (` + valueExpr + `=$` + strconv.Itoa(valueArg) + `::timestamptz AND p.id ` + operator + ` $` + strconv.Itoa(idArg) + `))`
		} else {
			where += ` AND (` + valueExpr + ` ` + operator + ` $` + strconv.Itoa(valueArg) + ` OR (` + valueExpr + `=$` + strconv.Itoa(valueArg) + ` AND p.id ` + operator + ` $` + strconv.Itoa(idArg) + `))`
		}
	}
	order := `lower(p.canonical_name) ASC,p.id ASC`
	if sort == "name_desc" {
		order = `lower(p.canonical_name) DESC,p.id DESC`
	}
	if sort == "updated_desc" {
		order = `p.updated_at DESC,p.id DESC`
	}
	if sort == "updated_asc" {
		order = `p.updated_at ASC,p.id ASC`
	}
	args = append(args, limit+1)
	rows, err := db.QueryContext(ctx, `SELECT p.id,p.vertical_id,p.canonical_name,p.brand,p.active,p.version,COUNT(DISTINCT v.id),ARRAY(SELECT pc.category_id FROM dsh.catalog_product_categories pc WHERE pc.product_id=p.id ORDER BY pc.category_id), (SELECT ma.uri FROM dsh.catalog_media_assets ma WHERE ma.product_id=p.id AND ma.state='active' AND ma.media_role='primary' ORDER BY ma.created_at DESC LIMIT 1),p.created_at,p.updated_at FROM dsh.catalog_products p JOIN dsh.commerce_verticals cv ON cv.id=p.vertical_id LEFT JOIN dsh.catalog_product_variants v ON v.product_id=p.id WHERE `+where+` GROUP BY p.id ORDER BY `+order+` LIMIT $`+strconv.Itoa(len(args)), args...)
	if err != nil {
		return CatalogProductRegistryPage{}, err
	}
	defer rows.Close()
	items := make([]CatalogProductRegistryItem, 0, limit+1)
	for rows.Next() {
		var item CatalogProductRegistryItem
		var categories pq.StringArray
		if err := rows.Scan(&item.ID, &item.VerticalID, &item.CanonicalName, &item.Brand, &item.Active, &item.Version, &item.VariantCount, &categories, &item.PrimaryImageURI, &item.CreatedAt, &item.UpdatedAt); err != nil {
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
