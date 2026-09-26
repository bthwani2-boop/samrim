package postgres

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"

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

type PublicCatalogSearchRecord struct {
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

func ReadPublicCatalog(ctx context.Context, db *sql.DB, storeID, serviceCityID, categoryID, productID, query string, limit int, cursor string) (PublicCatalogRecord, error) {
	return readPublicCatalog(ctx, db, storeID, serviceCityID, categoryID, productID, query, "", limit, cursor)
}

func ReadPublicFavoriteStoreCatalog(ctx context.Context, db *sql.DB, storeID, serviceCityID, clientActorID string, limit int, cursor string) (PublicCatalogRecord, error) {
	clientActorID = strings.TrimSpace(clientActorID)
	if clientActorID == "" || len(clientActorID) > 128 {
		return PublicCatalogRecord{}, errors.New("favorite catalog client actor is invalid")
	}
	return readPublicCatalog(ctx, db, storeID, serviceCityID, "", "", "", clientActorID, limit, cursor)
}

func readPublicCatalog(ctx context.Context, db *sql.DB, storeID, serviceCityID, categoryID, productID, query, favoriteActorID string, limit int, cursor string) (PublicCatalogRecord, error) {
	storeID = strings.TrimSpace(storeID)
	serviceCityID = strings.TrimSpace(serviceCityID)
	categoryID = strings.TrimSpace(categoryID)
	productID = strings.TrimSpace(productID)
	query = strings.TrimSpace(query)
	favoriteActorID = strings.TrimSpace(favoriteActorID)
	if storeID == "" || serviceCityID == "" || len(productID) > 128 || len(favoriteActorID) > 128 || limit < 1 || limit > 100 {
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

	categories := []CatalogCategoryRecord{}
	sections := []CatalogStorefrontSectionRecord{}
	if favoriteActorID == "" {
		categories, err = ListCatalogCategories(ctx, db, verticalID, true)
		if err != nil {
			return PublicCatalogRecord{}, err
		}
		sections, err = listStorefrontSections(ctx, db, storeID)
		if err != nil {
			return PublicCatalogRecord{}, err
		}
	}
	offers, nextCursor, err := listCustomerVisibleOffers(ctx, db, storeID, serviceCityID, categoryID, productID, query, favoriteActorID, limit, cursor)
	if err != nil {
		return PublicCatalogRecord{}, err
	}
	return PublicCatalogRecord{StoreID: storeID, VerticalID: verticalID, Categories: categories, Sections: sections, Offers: offers, NextCursor: nextCursor}, nil
}

func SearchPublicCatalog(ctx context.Context, db *sql.DB, serviceCityID, categoryID, query string, limit int, cursor string) (PublicCatalogSearchRecord, error) {
	serviceCityID = strings.TrimSpace(serviceCityID)
	categoryID = strings.TrimSpace(categoryID)
	query = strings.TrimSpace(query)
	if db == nil || serviceCityID == "" || query == "" || utf8.RuneCountInString(query) > 160 || len(categoryID) > 128 || len(cursor) > 1024 || limit < 1 || limit > 50 {
		return PublicCatalogSearchRecord{}, errors.New("public catalog search input is invalid")
	}
	offers, nextCursor, err := listCustomerVisibleOffers(ctx, db, "", serviceCityID, categoryID, "", query, "", limit, cursor)
	if err != nil {
		return PublicCatalogSearchRecord{}, err
	}
	return PublicCatalogSearchRecord{Offers: offers, NextCursor: nextCursor}, nil
}

func listCustomerVisibleOffers(ctx context.Context, db *sql.DB, storeID, serviceCityID, categoryID, productID, query, favoriteActorID string, limit int, cursor string) ([]CatalogStoreOfferRecord, *string, error) {
	conditions := customerVisibleOfferConditions()
	args := make([]any, 0, 7)
	storeID = strings.TrimSpace(storeID)
	serviceCityID = strings.TrimSpace(serviceCityID)
	productID = strings.TrimSpace(productID)
	favoriteActorID = strings.TrimSpace(favoriteActorID)
	if storeID != "" {
		args = append(args, storeID)
		conditions = append([]string{fmt.Sprintf("o.store_id=$%d", len(args))}, conditions...)
	}
	if serviceCityID != "" {
		args = append(args, serviceCityID)
		cityArgument := len(args)
		conditions = append(conditions, fmt.Sprintf("s.service_city_id=$%d", cityArgument), "EXISTS (SELECT 1 FROM dsh.service_cities c WHERE c.id=s.service_city_id AND c.active=true)")
	}
	if storeID == "" && serviceCityID == "" {
		return nil, nil, errors.New("public catalog scope is required")
	}
	if productID != "" {
		args = append(args, productID)
		conditions = append(conditions, fmt.Sprintf("p.id=$%d", len(args)))
	}
	if categoryID != "" {
		args = append(args, categoryID)
		conditions = append(conditions, fmt.Sprintf("EXISTS (SELECT 1 FROM dsh.catalog_product_categories pc JOIN dsh.catalog_categories c ON c.id=pc.category_id WHERE pc.product_id=p.id AND c.id=$%d AND c.active=true AND c.vertical_id=s.primary_vertical_id)", len(args)))
	}
	if query != "" {
		args = append(args, escapeCatalogSearchPrefix(query))
		conditions = append(conditions, fmt.Sprintf("lower(p.canonical_name) LIKE lower($%d) ESCAPE '!'", len(args)))
	}
	if favoriteActorID != "" {
		args = append(args, favoriteActorID)
		conditions = append(conditions, fmt.Sprintf("EXISTS (SELECT 1 FROM dsh.client_favorite_store_offers f WHERE f.client_actor_id=$%d AND f.store_offer_id=o.id)", len(args)))
	}
	if cursor != "" {
		position, decodeErr := decodeCatalogSearchCursor(cursor, storeID, serviceCityID, categoryID, query, productID, favoriteActorID)
		if decodeErr != nil {
			return nil, nil, decodeErr
		}
		args = append(args, position.canonicalName, position.offerID)
		conditions = append(conditions, fmt.Sprintf("(lower(p.canonical_name),o.id) > (lower($%d),$%d)", len(args)-1, len(args)))
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
		value := encodeCatalogSearchCursor(last.Product.CanonicalName, last.ID, storeID, serviceCityID, categoryID, query, productID, favoriteActorID)
		nextCursor = &value
	}
	return items, nextCursor, nil
}

type catalogSearchCursorPosition struct {
	canonicalName string
	offerID       string
}

func encodeCatalogSearchCursor(canonicalName, offerID, storeID, serviceCityID, categoryID, query, productID, favoriteActorID string) string {
	payload := make([]byte, 0, len(canonicalName)+len(offerID)+18)
	payload = append(payload, canonicalName...)
	payload = append(payload, 0)
	payload = append(payload, offerID...)
	payload = append(payload, 0)
	fingerprint := catalogSearchCursorFingerprint(storeID, serviceCityID, categoryID, query, productID, favoriteActorID)
	payload = append(payload, fingerprint[:]...)
	return base64.RawURLEncoding.EncodeToString(payload)
}

func decodeCatalogSearchCursor(cursor, storeID, serviceCityID, categoryID, query, productID, favoriteActorID string) (catalogSearchCursorPosition, error) {
	decoded, err := base64.RawURLEncoding.DecodeString(cursor)
	if err != nil {
		return catalogSearchCursorPosition{}, errors.New("catalog cursor is invalid")
	}
	firstSeparator := bytes.IndexByte(decoded, 0)
	if firstSeparator < 1 || firstSeparator == len(decoded)-1 {
		return catalogSearchCursorPosition{}, errors.New("catalog cursor is invalid")
	}
	secondSeparatorRelative := bytes.IndexByte(decoded[firstSeparator+1:], 0)
	if secondSeparatorRelative < 1 {
		return catalogSearchCursorPosition{}, errors.New("catalog cursor is invalid")
	}
	secondSeparator := firstSeparator + 1 + secondSeparatorRelative
	if len(decoded)-secondSeparator-1 != 16 {
		return catalogSearchCursorPosition{}, errors.New("catalog cursor is invalid")
	}
	expected := catalogSearchCursorFingerprint(storeID, serviceCityID, categoryID, query, productID, favoriteActorID)
	actual := decoded[secondSeparator+1:]
	for index := range expected {
		if actual[index] != expected[index] {
			return catalogSearchCursorPosition{}, errors.New("catalog cursor does not match the current search")
		}
	}
	return catalogSearchCursorPosition{canonicalName: string(decoded[:firstSeparator]), offerID: string(decoded[firstSeparator+1 : secondSeparator])}, nil
}

func catalogSearchCursorFingerprint(storeID, serviceCityID, categoryID, query, productID, favoriteActorID string) [16]byte {
	input := make([]byte, 0, len(storeID)+len(serviceCityID)+len(categoryID)+len(query)+len(productID)+len(favoriteActorID)+24)
	for _, value := range []string{storeID, serviceCityID, categoryID, query, productID, favoriteActorID} {
		var length [4]byte
		binary.BigEndian.PutUint32(length[:], uint32(len(value)))
		input = append(input, length[:]...)
		input = append(input, value...)
	}
	digest := sha256.Sum256(input)
	var fingerprint [16]byte
	copy(fingerprint[:], digest[:len(fingerprint)])
	return fingerprint
}

func escapeCatalogSearchPrefix(query string) string {
	return strings.NewReplacer("!", "!!", "%", "!%", "_", "!_").Replace(strings.TrimSpace(query)) + "%"
}

func listStorefrontSections(ctx context.Context, db queryer, storeID string) ([]CatalogStorefrontSectionRecord, error) {
	rows, err := db.QueryContext(ctx, `SELECT ss.id,ss.store_id,ss.name_ar,ss.name_en,ss.ordinal,ss.active,ss.version,ss.created_at,ss.updated_at FROM dsh.catalog_storefront_sections ss JOIN dsh.stores s ON s.id=ss.store_id JOIN dsh.commerce_verticals cv ON cv.id=s.primary_vertical_id WHERE ss.store_id=$1 AND ss.active=true AND cv.catalog_model='STORE_LOCAL_CATALOG' ORDER BY ss.ordinal,ss.id`, storeID)
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
		"EXISTS (SELECT 1 FROM dsh.commerce_verticals cv WHERE cv.id=" + storeAlias + ".primary_vertical_id AND cv.active=true AND ((cv.catalog_model='SHARED_CATALOG' AND " + productAlias + ".scope='SHARED') OR (cv.catalog_model='STORE_LOCAL_CATALOG' AND " + productAlias + ".scope='STORE_SCOPED' AND " + productAlias + ".store_id=" + offerAlias + ".store_id)))",
		offerAlias + ".quantity_policy=" + variantAlias + ".measurement_kind",
		offerAlias + ".quantity_policy<>'VARIABLE_MEASURE'",
		offerAlias + ".quantity_min_base_units IS NOT NULL",
		offerAlias + ".quantity_max_base_units IS NOT NULL",
		offerAlias + ".quantity_step_base_units IS NOT NULL",
		offerAlias + ".quantity_min_base_units>0 AND " + offerAlias + ".quantity_max_base_units>=" + offerAlias + ".quantity_min_base_units AND " + offerAlias + ".quantity_step_base_units>0",
		"(" + offerAlias + ".quantity_max_base_units-" + offerAlias + ".quantity_min_base_units)%" + offerAlias + ".quantity_step_base_units=0",
		"((" + offerAlias + ".pricing_basis='PER_UNIT' AND " + offerAlias + ".pricing_unit_base_units=1) OR (" + offerAlias + ".pricing_basis='PER_MEASURE' AND " + offerAlias + ".pricing_unit_base_units>0))",
		"(" + offerAlias + ".inventory_policy='AVAILABILITY_ONLY' OR (" + offerAlias + ".inventory_on_hand_base_units-" + offerAlias + ".inventory_reserved_base_units>=" + offerAlias + ".quantity_min_base_units))",
		"((" + productAlias + ".scope='SHARED' AND EXISTS (SELECT 1 FROM dsh.catalog_product_categories pc JOIN dsh.catalog_categories c ON c.id=pc.category_id AND c.active=true AND c.vertical_id=" + productAlias + ".vertical_id WHERE pc.product_id=" + productAlias + ".id)) OR (" + productAlias + ".scope='STORE_SCOPED' AND NOT EXISTS (SELECT 1 FROM dsh.catalog_product_categories pc WHERE pc.product_id=" + productAlias + ".id)))",
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
