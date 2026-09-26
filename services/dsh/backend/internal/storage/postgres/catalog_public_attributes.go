package postgres

import (
	"context"
	"database/sql"
	"strings"
)

func ReadPublicCatalogAttributeRules(ctx context.Context, db *sql.DB, categoryID string) ([]CatalogAttributeRuleRecord, error) {
	categoryID = strings.TrimSpace(categoryID)
	if categoryID == "" {
		return nil, ErrCatalogCategoryNotFound
	}
	rows, err := db.QueryContext(ctx, `SELECT r.category_id,r.attribute_id,a.code,a.name_ar,a.value_kind,r.required,r.filterable,r.variant_axis,r.version
		FROM dsh.catalog_category_attribute_rules r
		JOIN dsh.catalog_categories c ON c.id=r.category_id AND c.active=true
		JOIN dsh.catalog_attribute_definitions a ON a.id=r.attribute_id AND a.active=true
		WHERE r.category_id=$1
		ORDER BY a.code,a.id`, categoryID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]CatalogAttributeRuleRecord, 0)
	for rows.Next() {
		var item CatalogAttributeRuleRecord
		if err := rows.Scan(&item.CategoryID, &item.AttributeID, &item.Code, &item.NameAr, &item.ValueKind, &item.Required, &item.Filterable, &item.VariantAxis, &item.Version); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}
