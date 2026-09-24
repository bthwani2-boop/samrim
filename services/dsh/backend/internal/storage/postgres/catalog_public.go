package postgres

import (
	"context"
	"database/sql"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"

	"github.com/lib/pq"
)

type PublicCatalogRecord struct {
	StoreID    string
	VerticalID string
	Categories []CatalogCategoryRecord
	Sections   []CatalogStorefrontSectionRecord
	Offers     []CatalogStoreOfferRecord
	NextCursor *string
}

func ListPublicCatalogCategories(ctx context.Context, db *sql.DB, categoryIDs []string) ([]CatalogCategoryRecord, error) {
	if db == nil {
		return nil, errors.New("DSH database is nil")
	}
	ids := make([]string, 0, len(categoryIDs))
	seen := make(map[string]struct{}, len(categoryIDs))
	for _, value := range categoryIDs {
		id := strings.TrimSpace(value)
		if id == "" {
			continue
		}
		if _, exists := seen[id]; exists {
			continue
		}
		seen[id] = struct{}{}
		ids = append(ids, id)
	}
	if len(ids) == 0 {
		return []CatalogCategoryRecord{}, nil
	}
	rows, err := db.QueryContext(ctx, `SELECT id, vertical_id, COALESCE(parent_category_id,''), name_ar, name_en,
		active, version, created_at, updated_at FROM dsh.catalog_categories
		WHERE active=true AND id=ANY($1) ORDER BY lower(name_ar), id`, pq.Array(ids))
	if err != nil {
		return nil, fmt.Errorf("list public catalog categories: %w", err)
	}
	defer rows.Close()
	categories := make([]CatalogCategoryRecord, 0, len(ids))
	for rows.Next() {
		var category CatalogCategoryRecord
		if err := rows.Scan(&category.ID, &category.VerticalID, &category.ParentCategoryID, &category.NameAr, &category.NameEn, &category.Active, &category.Version, &category.CreatedAt, &category.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan public catalog category: %w", err)
		}
		categories = append(categories, category)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read public catalog categories: %w", err)
	}
	return categories, nil
}

type rowQueryer interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

func HasPublishableCatalog(ctx context.Context, db *sql.DB, storeID string) (bool, error) {
	var present bool
	query := `SELECT EXISTS (SELECT 1 FROM dsh.catalog_store_offers o
		JOIN dsh.catalog_product_variants v ON v.id=o.variant_id
		JOIN dsh.catalog_products p ON p.id=v.product_id
		JOIN dsh.stores s ON s.id=o.store_id
		WHERE o.store_id=$1 AND ` + strings.Join(publishableCatalogOfferConditionsForAliases("o", "v", "p", "s"), " AND ") + `)`
	err := db.QueryRowContext(ctx, query, strings.TrimSpace(storeID)).Scan(&present)
	return present, err
}

func ReadCustomerVisibleOffer(ctx context.Context, db *sql.DB, storeID, offerID string) (CatalogStoreOfferRecord, error) {
	item, err := readCustomerVisibleOffer(ctx, db, storeID, offerID, false)
	if errors.Is(err, sql.ErrNoRows) {
		return CatalogStoreOfferRecord{}, ErrCatalogOfferNotFound
	}
	return item, err
}

func readCustomerVisibleOfferTx(ctx context.Context, tx *sql.Tx, storeID, offerID string) (CatalogStoreOfferRecord, error) {
	return readCustomerVisibleOffer(ctx, tx, storeID, offerID, true)
}

func readCustomerVisibleOffer(ctx context.Context, rowSource rowQueryer, storeID, offerID string, lock bool) (CatalogStoreOfferRecord, error) {
	conditions := append([]string{"o.store_id=$1", "o.id=$2"}, customerVisibleOfferConditions()...)
	query := catalogOfferSelect + " WHERE " + strings.Join(conditions, " AND ")
	if lock {
		query += " FOR UPDATE OF o,v,p,s"
	}
	item, err := scanCatalogOffer(rowSource.QueryRowContext(ctx, query, strings.TrimSpace(storeID), strings.TrimSpace(offerID)))
	if err != nil {
		return CatalogStoreOfferRecord{}, err
	}
	return hydrateCatalogOffer(ctx, rowSource, item)
}

func ReadPublicCatalog(ctx context.Context, db *sql.DB, storeID, serviceCityID, categoryID, query string, limit int, cursor string) (PublicCatalogRecord, error) {
	storeID = strings.TrimSpace(storeID)
	serviceCityID = strings.TrimSpace(serviceCityID)
	categoryID = strings.TrimSpace(categoryID)
	query = strings.TrimSpace(query)
	if storeID == "" || serviceCityID == "" || limit < 1 || limit > 100 {
		return PublicCatalogRecord{}, ErrStoreNotFound
	}
	var verticalID string
	err := db.QueryRowContext(ctx, `SELECT s.primary_vertical_id
		FROM dsh.stores s
		JOIN dsh.service_cities c ON c.id=s.service_city_id AND c.active=true
		JOIN dsh.commerce_verticals v ON v.id=s.primary_vertical_id AND v.active=true
		WHERE s.id=$1 AND s.service_city_id=$2 AND s.publication_state='published'`, storeID, serviceCityID).Scan(&verticalID)
	if errors.Is(err, sql.ErrNoRows) {
		return PublicCatalogRecord{}, ErrStoreNotFound
	}
	if err != nil {
		return PublicCatalogRecord{}, fmt.Errorf("read public catalog store scope: %w", err)
	}

	categories, err := ListCatalogCategories(ctx, db, verticalID, true)
	if err != nil {
		return PublicCatalogRecord{}, err
	}
	offers, nextCursor, err := listCustomerVisibleOffers(ctx, db, storeID, categoryID, query, limit, cursor)
	if err != nil {
		return PublicCatalogRecord{}, err
	}
	sections, err := listStorefrontSections(ctx, db, storeID)
	if err != nil {
		return PublicCatalogRecord{}, err
	}
	return PublicCatalogRecord{StoreID: storeID, VerticalID: verticalID, Categories: categories, Sections: sections, Offers: offers, NextCursor: nextCursor}, nil
}

func listCustomerVisibleOffers(ctx context.Context, db *sql.DB, storeID, categoryID, query string, limit int, cursor string) ([]CatalogStoreOfferRecord, *string, error) {
	conditions := customerVisibleOfferConditions()
	args := []any{strings.TrimSpace(storeID)}
	conditions = append([]string{"o.store_id=$1"}, conditions...)
	if categoryID != "" {
		args = append(args, categoryID)
		conditions = append(conditions, fmt.Sprintf("EXISTS (SELECT 1 FROM dsh.catalog_product_categories pc WHERE pc.product_id=p.id AND pc.category_id=$%d)", len(args)))
	}
	if query != "" {
		args = append(args, query+"%")
		conditions = append(conditions, fmt.Sprintf("lower(p.canonical_name) LIKE lower($%d)", len(args)))
	}
	if cursor != "" {
		decoded, decodeErr := base64.RawURLEncoding.DecodeString(cursor)
		if decodeErr != nil {
			return nil, nil, errors.New("catalog cursor is invalid")
		}
		parts := strings.Split(string(decoded), "\x00")
		if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
			return nil, nil, errors.New("catalog cursor is invalid")
		}
		args = append(args, strings.ToLower(parts[0]), parts[1])
		conditions = append(conditions, fmt.Sprintf("(lower(p.canonical_name),o.id) > ($%d,$%d)", len(args)-1, len(args)))
	}
	args = append(args, limit+1)
	rows, err := db.QueryContext(ctx, catalogOfferSelect+" WHERE "+strings.Join(conditions, " AND ")+fmt.Sprintf(" ORDER BY lower(p.canonical_name),o.id LIMIT $%d", len(args)), args...)
	if err != nil {
		return nil, nil, fmt.Errorf("list customer-visible offers: %w", err)
	}
	defer rows.Close()
	items := make([]CatalogStoreOfferRecord, 0)
	for rows.Next() {
		item, scanErr := scanCatalogOffer(rows)
		if scanErr != nil {
			return nil, nil, scanErr
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, nil, err
	}
	if err := rows.Close(); err != nil {
		return nil, nil, err
	}
	for i := range items {
		items[i], err = hydrateCatalogOffer(ctx, db, items[i])
		if err != nil {
			return nil, nil, err
		}
	}
	var nextCursor *string
	if len(items) > limit {
		items = items[:limit]
		last := items[len(items)-1]
		value := base64.RawURLEncoding.EncodeToString([]byte(strings.ToLower(last.Product.CanonicalName) + "\x00" + last.ID))
		nextCursor = &value
	}
	return items, nextCursor, nil
}

func listStorefrontSections(ctx context.Context, db queryer, storeID string) ([]CatalogStorefrontSectionRecord, error) {
	rows, err := db.QueryContext(ctx, `SELECT id,store_id,name_ar,name_en,ordinal,active,version,created_at,updated_at FROM dsh.catalog_storefront_sections WHERE store_id=$1 AND active=true ORDER BY ordinal,id`, storeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	sections := make([]CatalogStorefrontSectionRecord, 0)
	for rows.Next() {
		var section CatalogStorefrontSectionRecord
		if err := rows.Scan(&section.ID, &section.StoreID, &section.NameAr, &section.NameEn, &section.Ordinal, &section.Active, &section.Version, &section.CreatedAt, &section.UpdatedAt); err != nil {
			return nil, err
		}
		section.OfferIDs = make([]string, 0)
		sections = append(sections, section)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	for i := range sections {
		offerRows, err := db.QueryContext(ctx, `SELECT so.offer_id
		FROM dsh.catalog_storefront_section_offers so
		JOIN dsh.catalog_store_offers o ON o.id=so.offer_id
		JOIN dsh.catalog_product_variants v ON v.id=o.variant_id
		JOIN dsh.catalog_products p ON p.id=v.product_id
		JOIN dsh.stores s ON s.id=o.store_id
		WHERE so.section_id=$1 AND `+strings.Join(customerVisibleOfferConditionsForAliases("o", "v", "p", "s"), " AND ")+`
		ORDER BY so.ordinal,so.offer_id`, sections[i].ID)
		if err != nil {
			return nil, err
		}
		for offerRows.Next() {
			var offerID string
			if err := offerRows.Scan(&offerID); err != nil {
				_ = offerRows.Close()
				return nil, err
			}
			sections[i].OfferIDs = append(sections[i].OfferIDs, offerID)
		}
		if err := offerRows.Err(); err != nil {
			_ = offerRows.Close()
			return nil, err
		}
		if err := offerRows.Close(); err != nil {
			return nil, err
		}
	}
	return sections, nil
}

func customerVisibleOfferConditions() []string {
	return customerVisibleOfferConditionsForAliases("o", "v", "p", "s")
}

func customerVisibleOfferConditionsForAliases(offerAlias, variantAlias, productAlias, storeAlias string) []string {
	conditions := publishableCatalogOfferConditionsForAliases(offerAlias, variantAlias, productAlias, storeAlias)
	return append(conditions, storeAlias+".publication_state='published'")
}

func publishableCatalogOfferConditionsForAliases(offerAlias, variantAlias, productAlias, storeAlias string) []string {
	return []string{
		offerAlias + ".publication_state='published'",
		offerAlias + ".availability=true",
		offerAlias + ".price_minor>0",
		productAlias + ".active=true",
		variantAlias + ".active=true",
		storeAlias + ".service_city_id IS NOT NULL",
		storeAlias + ".primary_vertical_id IS NOT NULL",
		productAlias + ".vertical_id=" + storeAlias + ".primary_vertical_id",
		"(" + productAlias + ".scope='SHARED' OR (" + productAlias + ".scope='STORE_SCOPED' AND " + productAlias + ".store_id=" + offerAlias + ".store_id))",
		"EXISTS (SELECT 1 FROM dsh.commerce_verticals cv WHERE cv.id=" + storeAlias + ".primary_vertical_id AND cv.active=true)",
		offerAlias + ".quantity_policy=" + variantAlias + ".measurement_kind",
		offerAlias + ".quantity_policy<>'VARIABLE_MEASURE'",
		offerAlias + ".quantity_min_base_units IS NOT NULL",
		offerAlias + ".quantity_max_base_units IS NOT NULL",
		offerAlias + ".quantity_step_base_units IS NOT NULL",
		offerAlias + ".quantity_min_base_units>0 AND " + offerAlias + ".quantity_max_base_units>=" + offerAlias + ".quantity_min_base_units AND " + offerAlias + ".quantity_step_base_units>0",
		"(" + offerAlias + ".quantity_max_base_units-" + offerAlias + ".quantity_min_base_units)%" + offerAlias + ".quantity_step_base_units=0",
		"((" + offerAlias + ".pricing_basis='PER_UNIT' AND " + offerAlias + ".pricing_unit_base_units=1) OR (" + offerAlias + ".pricing_basis='PER_MEASURE' AND " + offerAlias + ".pricing_unit_base_units>0))",
		"(" + offerAlias + ".inventory_policy='AVAILABILITY_ONLY' OR (" + offerAlias + ".inventory_on_hand_base_units-" + offerAlias + ".inventory_reserved_base_units>=" + offerAlias + ".quantity_min_base_units))",
		"EXISTS (SELECT 1 FROM dsh.catalog_product_categories pc JOIN dsh.catalog_categories c ON c.id=pc.category_id AND c.active=true AND c.vertical_id=" + productAlias + ".vertical_id WHERE pc.product_id=" + productAlias + ".id)",
		"NOT EXISTS (SELECT 1 FROM dsh.catalog_product_categories pc JOIN dsh.catalog_categories c ON c.id=pc.category_id JOIN dsh.catalog_category_attribute_rules r ON r.category_id=c.id JOIN dsh.catalog_attribute_definitions ad ON ad.id=r.attribute_id WHERE pc.product_id=" + productAlias + ".id AND c.active=true AND ad.active=true AND ad.vertical_id=" + productAlias + ".vertical_id AND r.required AND ((r.variant_axis AND NOT EXISTS (SELECT 1 FROM dsh.catalog_variant_attribute_values av WHERE av.variant_id=" + variantAlias + ".id AND av.attribute_id=r.attribute_id)) OR (NOT r.variant_axis AND NOT EXISTS (SELECT 1 FROM dsh.catalog_product_attribute_values av WHERE av.product_id=" + productAlias + ".id AND av.attribute_id=r.attribute_id))))",
		"NOT EXISTS (SELECT 1 FROM dsh.catalog_store_offer_modifier_groups og JOIN dsh.catalog_modifier_groups mg ON mg.id=og.group_id WHERE og.offer_id=" + offerAlias + ".id AND (mg.store_id<>" + offerAlias + ".store_id OR NOT mg.active OR mg.min_selections > (SELECT COUNT(*) FROM dsh.catalog_modifier_options mo WHERE mo.group_id=mg.id AND mo.availability=true)))",
	}
}

func validateCatalogOfferQuantity(offer CatalogStoreOfferRecord, quantity int64) error {
	if quantity <= 0 || offer.QuantityMinBaseUnits == nil || offer.QuantityMaxBaseUnits == nil || offer.QuantityStepBaseUnits == nil {
		return ErrCartQuantityInvalid
	}
	min, max, step := *offer.QuantityMinBaseUnits, *offer.QuantityMaxBaseUnits, *offer.QuantityStepBaseUnits
	if min <= 0 || max < min || step <= 0 || quantity < min || quantity > max || (quantity-min)%step != 0 {
		return ErrCartQuantityInvalid
	}
	if offer.QuantityPolicy != offer.Variant.MeasurementKind {
		return ErrCartQuantityInvalid
	}
	if offer.PricingBasis != "PER_UNIT" && offer.PricingBasis != "PER_MEASURE" {
		return ErrCartQuantityInvalid
	}
	if offer.PricingUnitBaseUnits <= 0 || (offer.PricingBasis == "PER_UNIT" && offer.PricingUnitBaseUnits != 1) {
		return ErrCartQuantityInvalid
	}
	if offer.Variant.MeasurementKind == "DISCRETE" && offer.Variant.BaseUnit != "COUNT" {
		return ErrCartQuantityInvalid
	}
	if offer.Variant.MeasurementKind != "DISCRETE" && (offer.Variant.BaseUnit != "GRAM" && offer.Variant.BaseUnit != "MILLILITER") {
		return ErrCartQuantityInvalid
	}
	if offer.Variant.MeasurementKind != "DISCRETE" && offer.PricingBasis == "PER_UNIT" {
		return ErrCartQuantityInvalid
	}
	return nil
}
