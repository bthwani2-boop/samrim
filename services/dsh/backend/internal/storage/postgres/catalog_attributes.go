package postgres

import (
	"context"
	"database/sql"
	"errors"
	"strings"

	"github.com/lib/pq"
)

func listProductAttributes(ctx context.Context, db queryer, productID string) ([]CatalogAttributeValueRecord, error) {
	return listAttributeValues(ctx, db, `FROM dsh.catalog_product_attribute_values av JOIN dsh.catalog_attribute_definitions ad ON ad.id=av.attribute_id WHERE av.product_id=$1 ORDER BY ad.code`, productID)
}

func listVariantAttributes(ctx context.Context, db queryer, variantID string) ([]CatalogAttributeValueRecord, error) {
	return listAttributeValues(ctx, db, `FROM dsh.catalog_variant_attribute_values av JOIN dsh.catalog_attribute_definitions ad ON ad.id=av.attribute_id WHERE av.variant_id=$1 ORDER BY ad.code`, variantID)
}

func listAttributeValues(ctx context.Context, db queryer, suffix, ownerID string) ([]CatalogAttributeValueRecord, error) {
	rows, err := db.QueryContext(ctx, `SELECT av.attribute_id,ad.code,ad.value_kind,av.text_value,av.integer_value,av.decimal_value,av.boolean_value,av.enum_value,av.date_value,av.measurement_unit `+suffix, ownerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]CatalogAttributeValueRecord, 0)
	for rows.Next() {
		var item CatalogAttributeValueRecord
		var textValue, decimalValue, enumValue, measurementUnit sql.NullString
		var integerValue sql.NullInt64
		var booleanValue sql.NullBool
		var dateValue sql.NullTime
		if err := rows.Scan(&item.AttributeID, &item.Code, &item.ValueKind, &textValue, &integerValue, &decimalValue, &booleanValue, &enumValue, &dateValue, &measurementUnit); err != nil {
			return nil, err
		}
		item.TextValue = nullableString(textValue)
		if integerValue.Valid {
			value := integerValue.Int64
			item.IntegerValue = &value
		}
		if decimalValue.Valid {
			value := decimalValue.String
			item.DecimalValue = &value
		}
		if booleanValue.Valid {
			value := booleanValue.Bool
			item.BooleanValue = &value
		}
		if enumValue.Valid {
			value := enumValue.String
			item.EnumValue = &value
		}
		if dateValue.Valid {
			value := dateValue.Time.Format("2006-01-02")
			item.DateValue = &value
		}
		if measurementUnit.Valid {
			value := measurementUnit.String
			item.MeasurementUnit = &value
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func listOfferModifierGroups(ctx context.Context, db queryer, offerID string) ([]CatalogModifierGroupRecord, error) {
	rows, err := db.QueryContext(ctx, `SELECT g.id,g.store_id,g.name_ar,g.required,g.min_selections,g.max_selections,g.active,g.version FROM dsh.catalog_store_offer_modifier_groups og JOIN dsh.catalog_modifier_groups g ON g.id=og.group_id WHERE og.offer_id=$1 AND g.active=true ORDER BY og.ordinal,g.id`, offerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]CatalogModifierGroupRecord, 0)
	for rows.Next() {
		var item CatalogModifierGroupRecord
		if err := rows.Scan(&item.ID, &item.StoreID, &item.NameAr, &item.Required, &item.MinSelections, &item.MaxSelections, &item.Active, &item.Version); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	for i := range items {
		items[i].Options, err = listModifierOptions(ctx, db, items[i].ID)
		if err != nil {
			return nil, err
		}
	}
	return items, nil
}

func listModifierOptions(ctx context.Context, db queryer, groupID string) ([]CatalogModifierOptionRecord, error) {
	rows, err := db.QueryContext(ctx, `SELECT id,group_id,name_ar,price_delta_minor,availability,ordinal,version FROM dsh.catalog_modifier_options WHERE group_id=$1 ORDER BY ordinal,id`, groupID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]CatalogModifierOptionRecord, 0)
	for rows.Next() {
		var item CatalogModifierOptionRecord
		if err := rows.Scan(&item.ID, &item.GroupID, &item.NameAr, &item.PriceDeltaMinor, &item.Availability, &item.Ordinal, &item.Version); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func ReadCatalogAttributeRules(ctx context.Context, db *sql.DB, categoryID string) ([]CatalogAttributeRuleRecord, error) {
	rows, err := db.QueryContext(ctx, `SELECT r.category_id,r.attribute_id,a.code,a.name_ar,a.value_kind,r.required,r.filterable,r.variant_axis,r.version FROM dsh.catalog_category_attribute_rules r JOIN dsh.catalog_attribute_definitions a ON a.id=r.attribute_id WHERE r.category_id=$1 ORDER BY a.code`, strings.TrimSpace(categoryID))
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

func ReadCatalogModifierGroup(ctx context.Context, db *sql.DB, groupID string) (CatalogModifierGroupRecord, error) {
	items, err := listModifierGroupsByID(ctx, db, strings.TrimSpace(groupID))
	if err != nil {
		return CatalogModifierGroupRecord{}, err
	}
	if len(items) != 1 {
		return CatalogModifierGroupRecord{}, ErrCatalogCategoryNotFound
	}
	return items[0], nil
}

func ReadCatalogStorefrontSection(ctx context.Context, db *sql.DB, sectionID string) (CatalogStorefrontSectionRecord, error) {
	rows, err := db.QueryContext(ctx, `SELECT s.id,s.store_id,s.name_ar,s.name_en,s.ordinal,s.active,s.version,s.created_at,s.updated_at,
		COALESCE(array_agg(so.offer_id ORDER BY so.ordinal,so.offer_id) FILTER (WHERE so.offer_id IS NOT NULL), ARRAY[]::text[])
		FROM dsh.catalog_storefront_sections s
		LEFT JOIN dsh.catalog_storefront_section_offers so ON so.section_id=s.id
		WHERE s.id=$1
		GROUP BY s.id`, strings.TrimSpace(sectionID))
	if err != nil {
		return CatalogStorefrontSectionRecord{}, err
	}
	defer rows.Close()
	if !rows.Next() {
		if err := rows.Err(); err != nil {
			return CatalogStorefrontSectionRecord{}, err
		}
		return CatalogStorefrontSectionRecord{}, ErrCatalogCategoryNotFound
	}
	var item CatalogStorefrontSectionRecord
	if err := rows.Scan(&item.ID, &item.StoreID, &item.NameAr, &item.NameEn, &item.Ordinal, &item.Active, &item.Version, &item.CreatedAt, &item.UpdatedAt, pq.Array(&item.OfferIDs)); err != nil {
		return CatalogStorefrontSectionRecord{}, err
	}
	return item, rows.Err()
}

func ReadCatalogAttributeDefinition(ctx context.Context, db *sql.DB, attributeID string) (string, string, string, error) {
	var verticalID, valueKind string
	var active bool
	err := db.QueryRowContext(ctx, "SELECT vertical_id,value_kind,active FROM dsh.catalog_attribute_definitions WHERE id=$1", strings.TrimSpace(attributeID)).Scan(&verticalID, &valueKind, &active)
	if errors.Is(err, sql.ErrNoRows) {
		return "", "", "", ErrCatalogCategoryNotFound
	}
	if err != nil {
		return "", "", "", err
	}
	if !active {
		return "", "", "", ErrCatalogCategoryNotFound
	}
	return verticalID, valueKind, attributeID, nil
}
