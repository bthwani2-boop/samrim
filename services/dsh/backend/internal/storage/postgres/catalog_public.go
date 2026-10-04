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
	rows, err := db.QueryContext(ctx, `WITH RECURSIVE category_tree(id, parent_category_id, vertical_id, name_ar, name_en, image_uri, active, version, created_at, updated_at) AS (
		SELECT category.id, category.parent_category_id, category.vertical_id, category.name_ar, category.name_en,
		COALESCE((SELECT asset.uri FROM dsh.catalog_category_media_assets asset WHERE asset.category_id=category.id AND asset.state='active' AND asset.rights_attested_at IS NOT NULL),''),
		category.active, category.version, category.created_at, category.updated_at
		FROM dsh.catalog_categories category WHERE category.active=true AND category.id=ANY($1)
		UNION
		SELECT parent.id, parent.parent_category_id, parent.vertical_id, parent.name_ar, parent.name_en,
		COALESCE((SELECT asset.uri FROM dsh.catalog_category_media_assets asset WHERE asset.category_id=parent.id AND asset.state='active' AND asset.rights_attested_at IS NOT NULL),''),
		parent.active, parent.version, parent.created_at, parent.updated_at
		FROM dsh.catalog_categories parent JOIN category_tree child ON parent.id=child.parent_category_id
		WHERE parent.active=true AND parent.vertical_id=child.vertical_id
	) SELECT id, vertical_id, COALESCE(parent_category_id,''), name_ar, name_en, COALESCE(image_uri,''), active, version, created_at, updated_at
	FROM category_tree ORDER BY lower(name_ar), id`, pq.Array(ids))
	if err != nil {
		return nil, fmt.Errorf("list public catalog categories: %w", err)
	}
	defer rows.Close()
	categories := make([]CatalogCategoryRecord, 0, len(ids))
	for rows.Next() {
		var category CatalogCategoryRecord
		if err := rows.Scan(&category.ID, &category.VerticalID, &category.ParentCategoryID, &category.NameAr, &category.NameEn, &category.ImageURI, &category.Active, &category.Version, &category.CreatedAt, &category.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan public catalog category: %w", err)
		}
		categories = append(categories, category)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read public catalog categories: %w", err)
	}
	return categories, nil
}

func ListPublicDiscoveryCategories(ctx context.Context, db *sql.DB, serviceCityID string) ([]CatalogCategoryRecord, error) {
	if db == nil || strings.TrimSpace(serviceCityID) == "" {
		return nil, errors.New("public discovery category scope is invalid")
	}
	const query = `SELECT DISTINCT pc.category_id
		FROM dsh.stores s
		JOIN dsh.service_cities sc ON sc.id=s.service_city_id AND sc.active=true
		JOIN dsh.joining_cases jc ON jc.partner_actor_id=s.partner_actor_id AND jc.financial_profile_state='ACTIVE'
		JOIN dsh.catalog_store_offers o ON o.store_id=s.id
		JOIN dsh.catalog_product_variants v ON v.id=o.variant_id
		JOIN dsh.catalog_products p ON p.id=v.product_id
		JOIN dsh.catalog_product_categories pc ON pc.product_id=p.id
		JOIN dsh.catalog_categories c ON c.id=pc.category_id AND c.active=true AND c.vertical_id=p.vertical_id
		WHERE sc.id=$1 AND s.publication_state='published' AND s.publication_changed_at IS NOT NULL
		AND EXISTS (SELECT 1 FROM dsh.catalog_customer_visible_offers visible WHERE visible.offer_id=o.id)
		ORDER BY pc.category_id`
	rows, err := db.QueryContext(ctx, query, strings.TrimSpace(serviceCityID))
	if err != nil {
		return nil, fmt.Errorf("list public discovery categories: %w", err)
	}
	categoryIDs := make([]string, 0)
	for rows.Next() {
		var categoryID string
		if err := rows.Scan(&categoryID); err != nil {
			_ = rows.Close()
			return nil, fmt.Errorf("scan public discovery category: %w", err)
		}
		categoryIDs = append(categoryIDs, categoryID)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return nil, fmt.Errorf("read public discovery categories: %w", err)
	}
	if err := rows.Close(); err != nil {
		return nil, fmt.Errorf("close public discovery categories: %w", err)
	}
	return ListPublicCatalogCategories(ctx, db, categoryIDs)
}

func ListPublicDiscoveryVerticals(ctx context.Context, db *sql.DB, serviceCityID string) ([]CommerceVerticalRecord, error) {
	serviceCityID = strings.TrimSpace(serviceCityID)
	if db == nil || serviceCityID == "" || len(serviceCityID) > 128 {
		return nil, errors.New("public discovery vertical scope is invalid")
	}
	rows, err := db.QueryContext(ctx, `SELECT vertical.id,vertical.name_ar,vertical.name_en,true,vertical.version,vertical.created_at,vertical.updated_at
		FROM dsh.commerce_verticals vertical
		WHERE vertical.active=true AND EXISTS (
			SELECT 1 FROM dsh.stores store
			JOIN dsh.service_cities city ON city.id=store.service_city_id AND city.active=true
			JOIN dsh.joining_cases joining ON joining.partner_actor_id=store.partner_actor_id AND joining.financial_profile_state='ACTIVE'
			WHERE city.id=$1 AND store.primary_vertical_id=vertical.id AND store.publication_state='published' AND store.publication_changed_at IS NOT NULL
			AND EXISTS (SELECT 1 FROM dsh.catalog_store_offers offer WHERE offer.store_id=store.id
				AND EXISTS (SELECT 1 FROM dsh.catalog_customer_visible_offers visible WHERE visible.offer_id=offer.id)))
		ORDER BY lower(vertical.name_ar),vertical.id`, serviceCityID)
	if err != nil {
		return nil, fmt.Errorf("list public discovery verticals: %w", err)
	}
	defer rows.Close()
	items := make([]CommerceVerticalRecord, 0)
	for rows.Next() {
		var item CommerceVerticalRecord
		if err := rows.Scan(&item.ID, &item.NameAr, &item.NameEn, &item.Active, &item.Version, &item.CreatedAt, &item.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan public discovery vertical: %w", err)
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read public discovery verticals: %w", err)
	}
	return items, nil
}

func listPublicStoreCatalogCategories(ctx context.Context, db *sql.DB, storeID, serviceCityID, verticalID string) ([]CatalogCategoryRecord, error) {
	const query = `SELECT DISTINCT pc.category_id FROM dsh.catalog_store_offers o
		JOIN dsh.catalog_product_variants v ON v.id=o.variant_id
		JOIN dsh.catalog_products p ON p.id=v.product_id
		JOIN dsh.stores s ON s.id=o.store_id
		JOIN dsh.service_cities sc ON sc.id=s.service_city_id AND sc.active=true
		JOIN dsh.catalog_product_categories pc ON pc.product_id=p.id
		JOIN dsh.catalog_categories c ON c.id=pc.category_id AND c.active=true AND c.vertical_id=p.vertical_id
		WHERE s.id=$1 AND s.service_city_id=$2 AND p.vertical_id=$3
		AND EXISTS (SELECT 1 FROM dsh.catalog_customer_visible_offers visible WHERE visible.offer_id=o.id)
		ORDER BY pc.category_id`
	rows, err := db.QueryContext(ctx, query, storeID, serviceCityID, verticalID)
	if err != nil {
		return nil, fmt.Errorf("list public store catalog category assignments: %w", err)
	}
	categoryIDs := make([]string, 0)
	for rows.Next() {
		var categoryID string
		if err := rows.Scan(&categoryID); err != nil {
			_ = rows.Close()
			return nil, fmt.Errorf("scan public store catalog category: %w", err)
		}
		categoryIDs = append(categoryIDs, categoryID)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return nil, fmt.Errorf("read public store catalog categories: %w", err)
	}
	if err := rows.Close(); err != nil {
		return nil, fmt.Errorf("close public store catalog categories: %w", err)
	}
	return ListPublicCatalogCategories(ctx, db, categoryIDs)
}

type rowQueryer interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

func HasPublishableCatalog(ctx context.Context, db *sql.DB, storeID string) (bool, error) {
	var present bool
	err := db.QueryRowContext(ctx, `SELECT EXISTS (
		SELECT 1 FROM dsh.catalog_publishable_offers publishable
		JOIN dsh.catalog_store_offers o ON o.id=publishable.offer_id
		WHERE o.store_id=$1)`, strings.TrimSpace(storeID)).Scan(&present)
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
	const unlockedQuery = `SELECT o.id,o.store_id,o.variant_id,o.price_minor,o.currency,o.quantity_policy,o.quantity_min_base_units,o.quantity_max_base_units,o.quantity_step_base_units,o.pricing_basis,o.pricing_unit_base_units,o.inventory_policy,o.inventory_on_hand_base_units,o.inventory_reserved_base_units,o.availability,o.publication_state,o.version,o.created_at,o.updated_at,
		v.id,v.product_id,v.title,v.measurement_kind,v.base_unit,v.active,v.version,v.created_at,v.updated_at,
		p.id,p.vertical_id,p.scope,p.store_id,p.canonical_name,p.brand,p.active,p.version,p.created_at,p.updated_at,
		s.name
		FROM dsh.catalog_store_offers o
		JOIN dsh.catalog_product_variants v ON v.id=o.variant_id
		JOIN dsh.catalog_products p ON p.id=v.product_id
		JOIN dsh.stores s ON s.id=o.store_id
		WHERE o.store_id=$1 AND o.id=$2
		AND EXISTS (SELECT 1 FROM dsh.catalog_customer_visible_offers visible WHERE visible.offer_id=o.id)`
	const lockedQuery = `SELECT o.id,o.store_id,o.variant_id,o.price_minor,o.currency,o.quantity_policy,o.quantity_min_base_units,o.quantity_max_base_units,o.quantity_step_base_units,o.pricing_basis,o.pricing_unit_base_units,o.inventory_policy,o.inventory_on_hand_base_units,o.inventory_reserved_base_units,o.availability,o.publication_state,o.version,o.created_at,o.updated_at,
		v.id,v.product_id,v.title,v.measurement_kind,v.base_unit,v.active,v.version,v.created_at,v.updated_at,
		p.id,p.vertical_id,p.scope,p.store_id,p.canonical_name,p.brand,p.active,p.version,p.created_at,p.updated_at,
		s.name
		FROM dsh.catalog_store_offers o
		JOIN dsh.catalog_product_variants v ON v.id=o.variant_id
		JOIN dsh.catalog_products p ON p.id=v.product_id
		JOIN dsh.stores s ON s.id=o.store_id
		WHERE o.store_id=$1 AND o.id=$2
		AND EXISTS (SELECT 1 FROM dsh.catalog_customer_visible_offers visible WHERE visible.offer_id=o.id)
		FOR UPDATE OF o,v,p,s`
	query := unlockedQuery
	if lock {
		query = lockedQuery
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
		categories, err = listPublicStoreCatalogCategories(ctx, db, storeID, serviceCityID, verticalID)
		if err != nil {
			return PublicCatalogRecord{}, err
		}
		sections, err = listStorefrontSections(ctx, db, storeID)
		if err != nil {
			return PublicCatalogRecord{}, err
		}
	}
	offers, nextCursor, err := listCustomerVisibleOffers(ctx, db, storeID, serviceCityID, verticalID, categoryID, productID, query, favoriteActorID, limit, cursor)
	if err != nil {
		return PublicCatalogRecord{}, err
	}
	return PublicCatalogRecord{StoreID: storeID, VerticalID: verticalID, Categories: categories, Sections: sections, Offers: offers, NextCursor: nextCursor}, nil
}

func SearchPublicCatalog(ctx context.Context, db *sql.DB, serviceCityID, verticalID, categoryID, query string, limit int, cursor string) (PublicCatalogSearchRecord, error) {
	serviceCityID = strings.TrimSpace(serviceCityID)
	verticalID = strings.TrimSpace(verticalID)
	categoryID = strings.TrimSpace(categoryID)
	query = strings.TrimSpace(query)
	if db == nil || serviceCityID == "" || query == "" || utf8.RuneCountInString(query) > 160 || len(verticalID) > 128 || len(categoryID) > 128 || len(cursor) > 1024 || limit < 1 || limit > 50 {
		return PublicCatalogSearchRecord{}, errors.New("public catalog search input is invalid")
	}
	offers, nextCursor, err := listCustomerVisibleOffers(ctx, db, "", serviceCityID, verticalID, categoryID, "", query, "", limit, cursor)
	if err != nil {
		return PublicCatalogSearchRecord{}, err
	}
	return PublicCatalogSearchRecord{Offers: offers, NextCursor: nextCursor}, nil
}

func listCustomerVisibleOffers(ctx context.Context, db *sql.DB, storeID, serviceCityID, verticalID, categoryID, productID, query, favoriteActorID string, limit int, cursor string) ([]CatalogStoreOfferRecord, *string, error) {
	conditions := []string{"EXISTS (SELECT 1 FROM dsh.catalog_customer_visible_offers visible WHERE visible.offer_id=o.id)"}
	args := make([]any, 0, 7)
	storeID = strings.TrimSpace(storeID)
	serviceCityID = strings.TrimSpace(serviceCityID)
	verticalID = strings.TrimSpace(verticalID)
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
	if verticalID != "" {
		args = append(args, verticalID)
		conditions = append(conditions, fmt.Sprintf("s.primary_vertical_id=$%d", len(args)))
	}
	if productID != "" {
		args = append(args, productID)
		conditions = append(conditions, fmt.Sprintf("p.id=$%d", len(args)))
	}
	if categoryID != "" {
		args = append(args, categoryID)
		conditions = append(conditions, fmt.Sprintf(`EXISTS (WITH RECURSIVE category_subtree(id) AS (
			SELECT c.id FROM dsh.catalog_categories c WHERE c.id=$%d AND c.active=true AND c.vertical_id=s.primary_vertical_id
			UNION
			SELECT child.id FROM dsh.catalog_categories child JOIN category_subtree parent ON child.parent_category_id=parent.id WHERE child.active=true AND child.vertical_id=s.primary_vertical_id
		) SELECT 1 FROM dsh.catalog_product_categories pc JOIN category_subtree subtree ON subtree.id=pc.category_id WHERE pc.product_id=p.id)`, len(args)))
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
		position, decodeErr := decodeCatalogSearchCursor(cursor, storeID, serviceCityID, verticalID, categoryID, query, productID, favoriteActorID)
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
		value := encodeCatalogSearchCursor(last.Product.CanonicalName, last.ID, storeID, serviceCityID, verticalID, categoryID, query, productID, favoriteActorID)
		nextCursor = &value
	}
	return items, nextCursor, nil
}

type catalogSearchCursorPosition struct {
	canonicalName string
	offerID       string
}

func encodeCatalogSearchCursor(canonicalName, offerID, storeID, serviceCityID, verticalID, categoryID, query, productID, favoriteActorID string) string {
	payload := make([]byte, 0, len(canonicalName)+len(offerID)+18)
	payload = append(payload, canonicalName...)
	payload = append(payload, 0)
	payload = append(payload, offerID...)
	payload = append(payload, 0)
	fingerprint := catalogSearchCursorFingerprint(storeID, serviceCityID, verticalID, categoryID, query, productID, favoriteActorID)
	payload = append(payload, fingerprint[:]...)
	return base64.RawURLEncoding.EncodeToString(payload)
}

func decodeCatalogSearchCursor(cursor, storeID, serviceCityID, verticalID, categoryID, query, productID, favoriteActorID string) (catalogSearchCursorPosition, error) {
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
	expected := catalogSearchCursorFingerprint(storeID, serviceCityID, verticalID, categoryID, query, productID, favoriteActorID)
	actual := decoded[secondSeparator+1:]
	for index := range expected {
		if actual[index] != expected[index] {
			return catalogSearchCursorPosition{}, errors.New("catalog cursor does not match the current search")
		}
	}
	return catalogSearchCursorPosition{canonicalName: string(decoded[:firstSeparator]), offerID: string(decoded[firstSeparator+1 : secondSeparator])}, nil
}

func catalogSearchCursorFingerprint(storeID, serviceCityID, verticalID, categoryID, query, productID, favoriteActorID string) [16]byte {
	input := make([]byte, 0, len(storeID)+len(serviceCityID)+len(verticalID)+len(categoryID)+len(query)+len(productID)+len(favoriteActorID)+28)
	for _, value := range []string{storeID, serviceCityID, verticalID, categoryID, query, productID, favoriteActorID} {
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
	rows, err := db.QueryContext(ctx, `SELECT ss.id,ss.store_id,ss.name_ar,ss.name_en,ss.ordinal,ss.active,ss.version,ss.created_at,ss.updated_at FROM dsh.catalog_storefront_sections ss JOIN dsh.stores s ON s.id=ss.store_id JOIN dsh.commerce_verticals cv ON cv.id=s.primary_vertical_id WHERE ss.store_id=$1 AND ss.active=true AND cv.active=true ORDER BY ss.ordinal,ss.id`, storeID)
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
		WHERE so.section_id=$1 AND EXISTS (SELECT 1 FROM dsh.catalog_customer_visible_offers visible WHERE visible.offer_id=o.id)
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
