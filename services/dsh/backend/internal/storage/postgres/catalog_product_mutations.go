package postgres

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"strings"

	"github.com/lib/pq"
)

const catalogProductSelect = `SELECT p.id,p.vertical_id,p.scope,p.store_id,p.canonical_name,p.description,p.brand,p.active,p.version,p.created_at,p.updated_at FROM dsh.catalog_products p`
const catalogOfferSelect = `SELECT o.id,o.store_id,o.variant_id,o.price_minor,o.currency,o.quantity_policy,o.quantity_min_base_units,o.quantity_max_base_units,o.quantity_step_base_units,o.pricing_basis,o.pricing_unit_base_units,o.inventory_policy,o.inventory_on_hand_base_units,o.inventory_reserved_base_units,o.availability,o.publication_state,o.version,o.created_at,o.updated_at,v.id,v.product_id,v.title,v.measurement_kind,v.base_unit,v.active,v.version,v.created_at,v.updated_at,p.id,p.vertical_id,p.scope,p.store_id,p.canonical_name,p.brand,p.active,p.version,p.created_at,p.updated_at,s.name FROM dsh.catalog_store_offers o JOIN dsh.catalog_product_variants v ON v.id=o.variant_id JOIN dsh.catalog_products p ON p.id=v.product_id JOIN dsh.stores s ON s.id=o.store_id`

type CatalogProductPage struct {
	Products   []CatalogProductRecord
	NextCursor string
}

type catalogProductCursor struct {
	Version        int    `json:"v"`
	Query          string `json:"q"`
	VerticalID     string `json:"verticalId"`
	ActiveOnly     bool   `json:"activeOnly"`
	PartnerActorID string `json:"partnerActorId,omitempty"`
	CanonicalName  string `json:"canonicalName"`
	ProductID      string `json:"productId"`
}

func encodeCatalogProductCursor(cursor catalogProductCursor) (string, error) {
	payload, err := json.Marshal(cursor)
	if err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(payload), nil
}

func decodeCatalogProductCursor(raw, query, verticalID, partnerActorID string, activeOnly bool) (*catalogProductCursor, error) {
	if strings.TrimSpace(raw) == "" {
		return nil, nil
	}
	decoded, err := base64.RawURLEncoding.DecodeString(strings.TrimSpace(raw))
	if err != nil {
		return nil, ErrCatalogProductInvalidCursor
	}
	var cursor catalogProductCursor
	if err := json.Unmarshal(decoded, &cursor); err != nil || cursor.Version != 1 || cursor.CanonicalName == "" || cursor.ProductID == "" || cursor.Query != query || cursor.VerticalID != verticalID || cursor.ActiveOnly != activeOnly || cursor.PartnerActorID != partnerActorID {
		return nil, ErrCatalogProductInvalidCursor
	}
	return &cursor, nil
}

func finishCatalogProductPage(ctx context.Context, db *sql.DB, items []CatalogProductRecord, limit int, cursor catalogProductCursor) (CatalogProductPage, error) {
	hasMore := len(items) > limit
	if hasMore {
		items = items[:limit]
	}
	for i := range items {
		var err error
		items[i], err = hydrateCatalogProduct(ctx, db, items[i])
		if err != nil {
			return CatalogProductPage{}, err
		}
	}
	page := CatalogProductPage{Products: items}
	if hasMore && len(items) > 0 {
		last := items[len(items)-1]
		cursor.CanonicalName = strings.ToLower(last.CanonicalName)
		cursor.ProductID = last.ID
		var err error
		page.NextCursor, err = encodeCatalogProductCursor(cursor)
		if err != nil {
			return CatalogProductPage{}, err
		}
	}
	return page, nil
}

func ReadCatalogProduct(ctx context.Context, db *sql.DB, productID string) (CatalogProductRecord, error) {
	item, err := readCatalogProductRow(db.QueryRowContext(ctx, catalogProductSelect+" WHERE p.id=$1 AND p.deleted_at IS NULL", strings.TrimSpace(productID)))
	if errors.Is(err, sql.ErrNoRows) {
		return CatalogProductRecord{}, ErrCatalogProductNotFound
	}
	if err != nil {
		return CatalogProductRecord{}, err
	}
	return hydrateCatalogProduct(ctx, db, item)
}

func ReadCatalogVariant(ctx context.Context, db *sql.DB, variantID string) (CatalogVariantRecord, error) {
	var variant CatalogVariantRecord
	err := db.QueryRowContext(ctx, "SELECT id,product_id,title,measurement_kind,base_unit,active,version,created_at,updated_at FROM dsh.catalog_product_variants WHERE id=$1", strings.TrimSpace(variantID)).Scan(&variant.ID, &variant.ProductID, &variant.Title, &variant.MeasurementKind, &variant.BaseUnit, &variant.Active, &variant.Version, &variant.CreatedAt, &variant.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return CatalogVariantRecord{}, ErrCatalogVariantNotFound
	}
	if err != nil {
		return CatalogVariantRecord{}, err
	}
	variant.Identifiers, err = listCatalogIdentifiers(ctx, db, variant.ID, "")
	if err != nil {
		return CatalogVariantRecord{}, err
	}
	variant.Attributes, err = listVariantAttributes(ctx, db, variant.ID)
	return variant, err
}
func ListCatalogProducts(ctx context.Context, db *sql.DB, query, verticalID string, activeOnly bool, limit int, rawCursor string) (CatalogProductPage, error) {
	return listCatalogProducts(ctx, db, query, verticalID, "", activeOnly, limit, rawCursor)
}

func ListCatalogProductsForPartner(ctx context.Context, db *sql.DB, query, verticalID, partnerActorID string, limit int, rawCursor string) (CatalogProductPage, error) {
	partnerActorID = strings.TrimSpace(partnerActorID)
	if partnerActorID == "" {
		return CatalogProductPage{}, errors.New("catalog Product partner listing facts are invalid")
	}
	return listCatalogProducts(ctx, db, query, verticalID, partnerActorID, false, limit, rawCursor)
}

func listCatalogProducts(ctx context.Context, db *sql.DB, query, verticalID, partnerActorID string, activeOnly bool, limit int, rawCursor string) (CatalogProductPage, error) {
	if limit < 1 || limit > 100 {
		return CatalogProductPage{}, errors.New("catalog Product limit is invalid")
	}
	query = strings.TrimSpace(query)
	verticalID = strings.TrimSpace(verticalID)
	cursor, err := decodeCatalogProductCursor(rawCursor, query, verticalID, partnerActorID, activeOnly)
	if err != nil {
		return CatalogProductPage{}, err
	}
	var cursorName string
	var cursorProductID string
	if cursor != nil {
		cursorName, cursorProductID = cursor.CanonicalName, cursor.ProductID
	}
	rows, err := db.QueryContext(ctx, `SELECT p.id,p.vertical_id,p.scope,p.store_id,p.canonical_name,p.description,p.brand,p.active,p.version,p.created_at,p.updated_at
		FROM dsh.catalog_products p
		WHERE (($1='' AND p.scope='SHARED') OR ($1<>'' AND ((p.scope='SHARED') OR (p.scope='STORE_SCOPED' AND EXISTS (SELECT 1 FROM dsh.stores owned_store WHERE owned_store.id=p.store_id AND owned_store.partner_actor_id=$1 AND owned_store.primary_vertical_id=p.vertical_id)))))
		AND p.deleted_at IS NULL
		AND ($2='' OR p.vertical_id=$2)
		AND ($3='' OR lower(p.canonical_name) LIKE lower($3))
		AND (NOT $6::boolean OR (lower(p.canonical_name),p.id)>($4::text,$5::text))
		AND (NOT $7::boolean OR p.active=true)
		ORDER BY lower(p.canonical_name),p.id LIMIT $8`, partnerActorID, verticalID, query+"%", cursorName, cursorProductID, cursor != nil, activeOnly, limit+1)
	if err != nil {
		return CatalogProductPage{}, err
	}
	defer rows.Close()
	items := make([]CatalogProductRecord, 0)
	for rows.Next() {
		item, scanErr := readCatalogProductRow(rows)
		if scanErr != nil {
			return CatalogProductPage{}, scanErr
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return CatalogProductPage{}, err
	}
	pageCursor := catalogProductCursor{Version: 1, Query: query, VerticalID: verticalID, PartnerActorID: partnerActorID, ActiveOnly: activeOnly}
	return finishCatalogProductPage(ctx, db, items, limit, pageCursor)
}

func validateCatalogProductFactsTx(ctx context.Context, tx *sql.Tx, input CatalogProductInput) error {
	if input.VerticalID == "" || input.CanonicalName == "" || len([]rune(input.Description)) > 4000 {
		return errors.New("catalog Product facts are invalid")
	}
	if input.Scope != "SHARED" && input.Scope != "STORE_SCOPED" {
		return errors.New("catalog Product scope is invalid")
	}
	if input.Scope == "SHARED" && input.StoreID != "" {
		return ErrCatalogProductOwnership
	}
	if input.Scope == "STORE_SCOPED" && input.StoreID == "" {
		return ErrCatalogProductOwnership
	}
	if input.MeasurementKind != "DISCRETE" && input.MeasurementKind != "MEASURED" && input.MeasurementKind != "VARIABLE_MEASURE" {
		return ErrCatalogOfferQuantityInvalid
	}
	if input.MeasurementKind == "DISCRETE" && input.BaseUnit != "COUNT" {
		return ErrCatalogOfferQuantityInvalid
	}
	if input.MeasurementKind != "DISCRETE" && input.BaseUnit != "GRAM" && input.BaseUnit != "MILLILITER" {
		return ErrCatalogOfferQuantityInvalid
	}
	var active bool
	if err := tx.QueryRowContext(ctx, "SELECT active FROM dsh.commerce_verticals WHERE id=$1 FOR SHARE", input.VerticalID).Scan(&active); errors.Is(err, sql.ErrNoRows) || !active {
		return ErrCatalogVerticalNotFound
	} else if err != nil {
		return err
	}
	if input.Scope == "SHARED" && len(input.CategoryIDs) == 0 {
		return ErrCatalogProductScopeMismatch
	}
	if input.Scope == "STORE_SCOPED" {
		var storeVertical string
		if err := tx.QueryRowContext(ctx, "SELECT primary_vertical_id FROM dsh.stores WHERE id=$1 FOR SHARE", input.StoreID).Scan(&storeVertical); errors.Is(err, sql.ErrNoRows) {
			return ErrCatalogOfferStoreNotFound
		} else if err != nil {
			return err
		} else if storeVertical != input.VerticalID {
			return ErrCatalogProductOwnership
		}
	}
	for _, categoryID := range input.CategoryIDs {
		var categoryVertical string
		err := tx.QueryRowContext(ctx, "SELECT vertical_id FROM dsh.catalog_categories WHERE id=$1 AND active=true", categoryID).Scan(&categoryVertical)
		if errors.Is(err, sql.ErrNoRows) {
			log.Printf("DSH_CATALOG_PRODUCT_CATEGORY_LOOKUP no_rows category_id=%q expected_vertical_id=%q", categoryID, input.VerticalID)
			return ErrCatalogCategoryNotFound
		}
		if err != nil {
			return err
		}
		if categoryVertical != input.VerticalID {
			log.Printf("DSH_CATALOG_PRODUCT_CATEGORY_LOOKUP vertical_mismatch category_id=%q expected_vertical_id=%q actual_vertical_id=%q", categoryID, input.VerticalID, categoryVertical)
			return ErrCatalogCategoryNotFound
		}
	}
	if input.IdentifierValue != "" && (input.IdentifierType != "GTIN" && input.IdentifierType != "EAN" && input.IdentifierType != "UPC" && (input.IdentifierType != "SKU" || input.Scope != "STORE_SCOPED")) {
		return ErrCatalogIdentifierInvalid
	}
	return nil
}

func CreateCatalogProduct(ctx context.Context, db *sql.DB, input CatalogProductInput, idempotencyKey, requestHash, actingActorID, correlationID string) (CatalogProductResult, error) {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return CatalogProductResult{}, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err = tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "dsh:catalog-product:idempotency:"+idempotencyKey); err != nil {
		return CatalogProductResult{}, err
	}
	var storedHash, storedID, operation string
	err = tx.QueryRowContext(ctx, "SELECT request_hash,product_id,operation FROM dsh.catalog_product_mutation_idempotency WHERE idempotency_key=$1 FOR UPDATE", idempotencyKey).Scan(&storedHash, &storedID, &operation)
	if err == nil {
		if storedHash != requestHash || operation != "create" {
			return CatalogProductResult{}, ErrCatalogIdempotencyConflict
		}
		product, e := readCatalogProductTx(ctx, tx, storedID)
		if e != nil {
			return CatalogProductResult{}, e
		}
		if e = tx.Commit(); e != nil {
			return CatalogProductResult{}, e
		}
		return CatalogProductResult{Product: product, Replayed: true}, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return CatalogProductResult{}, err
	}
	if err = validateCatalogProductFactsTx(ctx, tx, input); err != nil {
		return CatalogProductResult{}, fmt.Errorf("validate catalog product facts: %w", err)
	}
	productID := input.ID
	if productID == "" {
		productID, err = newID("product")
		if err != nil {
			return CatalogProductResult{}, err
		}
	}
	if _, err = tx.ExecContext(ctx, "INSERT INTO dsh.catalog_products(id,vertical_id,scope,store_id,canonical_name,description,brand) VALUES($1,$2,$3,NULLIF($4,''),$5,$6,$7)", productID, input.VerticalID, input.Scope, input.StoreID, input.CanonicalName, input.Description, input.Brand); err != nil {
		return CatalogProductResult{}, err
	}
	variantID := "variant_default_" + productID
	title := input.VariantTitle
	if title == "" {
		title = "الافتراضي"
	}
	if _, err = tx.ExecContext(ctx, "INSERT INTO dsh.catalog_product_variants(id,product_id,title,measurement_kind,base_unit) VALUES($1,$2,$3,$4,$5)", variantID, productID, title, input.MeasurementKind, input.BaseUnit); err != nil {
		return CatalogProductResult{}, err
	}
	for _, categoryID := range input.CategoryIDs {
		if _, err = tx.ExecContext(ctx, "INSERT INTO dsh.catalog_product_categories(product_id,category_id) VALUES($1,$2)", productID, categoryID); err != nil {
			return CatalogProductResult{}, err
		}
	}
	if err = persistCatalogProductAttributes(ctx, tx, input.VerticalID, input.CategoryIDs, productID, variantID, input.AttributeValues, input.VariantAttributeValues); err != nil {
		return CatalogProductResult{}, fmt.Errorf("persist catalog product attributes: %w", err)
	}
	if input.IdentifierValue != "" {
		if _, err = tx.ExecContext(ctx, "INSERT INTO dsh.catalog_variant_identifiers(variant_id,identifier_type,identifier_value,store_id) VALUES($1,$2,$3,$4)", variantID, input.IdentifierType, input.IdentifierValue, identifierStoreScope(input.IdentifierType, input.StoreID)); err != nil {
			if isUniqueViolation(err) {
				return CatalogProductResult{}, ErrCatalogDuplicateIdentifier
			}
			return CatalogProductResult{}, err
		}
	}
	product, err := readCatalogProductTx(ctx, tx, productID)
	if err != nil {
		return CatalogProductResult{}, fmt.Errorf("read created catalog product: %w", err)
	}
	if _, err = tx.ExecContext(ctx, "INSERT INTO dsh.catalog_product_mutation_idempotency(idempotency_key,request_hash,product_id,operation,result_version) VALUES($1,$2,$3,'create',$4)", idempotencyKey, requestHash, productID, product.Version); err != nil {
		return CatalogProductResult{}, err
	}
	if _, err = tx.ExecContext(ctx, "INSERT INTO dsh.catalog_product_audit(event_type,idempotency_key,correlation_id,acting_actor_id,product_id,from_version,result_version,request_hash,canonical_name,brand,vertical_id,scope) VALUES('catalog_product_created',$1,$2,$3,$4,NULL,$5,$6,$7,$8,$9,$10)", idempotencyKey, correlationID, actingActorID, productID, product.Version, requestHash, product.CanonicalName, product.Brand, product.VerticalID, product.Scope); err != nil {
		return CatalogProductResult{}, err
	}
	if err = tx.Commit(); err != nil {
		return CatalogProductResult{}, err
	}
	return CatalogProductResult{Product: product}, nil
}

// Product identity and Store ownership are immutable on ordinary edits.
// Store-local to Shared promotion requires its separate attributed cutover.
func validateCatalogProductUpdateIdentity(current CatalogProductRecord, input CatalogProductUpdateInput) error {
	if input.VerticalID != current.VerticalID || input.Scope != current.Scope || input.StoreID != current.StoreID {
		return ErrCatalogProductScopeMismatch
	}
	return nil
}

func UpdateCatalogProduct(ctx context.Context, db *sql.DB, productID string, input CatalogProductUpdateInput, expectedVersion int, idempotencyKey, requestHash, actingActorID, correlationID string) (CatalogProductResult, error) {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return CatalogProductResult{}, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err = tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "dsh:catalog-product:idempotency:"+idempotencyKey); err != nil {
		return CatalogProductResult{}, err
	}
	var storedHash, storedID, operation string
	err = tx.QueryRowContext(ctx, "SELECT request_hash,product_id,operation FROM dsh.catalog_product_mutation_idempotency WHERE idempotency_key=$1 FOR UPDATE", idempotencyKey).Scan(&storedHash, &storedID, &operation)
	if err == nil {
		if storedHash != requestHash || storedID != productID || operation != "update" {
			return CatalogProductResult{}, ErrCatalogIdempotencyConflict
		}
		product, e := readCatalogProductTx(ctx, tx, productID)
		if e != nil {
			return CatalogProductResult{}, e
		}
		if e = tx.Commit(); e != nil {
			return CatalogProductResult{}, e
		}
		return CatalogProductResult{Product: product, Replayed: true}, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return CatalogProductResult{}, err
	}
	current, err := readCatalogProductTxForUpdate(ctx, tx, productID)
	if err != nil {
		return CatalogProductResult{}, err
	}
	if current.Version != expectedVersion {
		return CatalogProductResult{}, ErrCatalogVersionConflict
	}
	if err := validateCatalogProductUpdateIdentity(current, input); err != nil {
		return CatalogProductResult{}, err
	}
	if len([]rune(input.Description)) > 4000 {
		return CatalogProductResult{}, ErrCatalogProductScopeMismatch
	}
	if input.Scope != "SHARED" && input.Scope != "STORE_SCOPED" {
		return CatalogProductResult{}, ErrCatalogProductScopeForbidden
	}
	if input.Scope == "SHARED" && input.StoreID != "" {
		return CatalogProductResult{}, ErrCatalogProductOwnership
	}
	if input.Scope == "STORE_SCOPED" && input.StoreID == "" {
		return CatalogProductResult{}, ErrCatalogProductOwnership
	}
	var verticalActive bool
	if err := tx.QueryRowContext(ctx, "SELECT active FROM dsh.commerce_verticals WHERE id=$1 FOR SHARE", input.VerticalID).Scan(&verticalActive); errors.Is(err, sql.ErrNoRows) || !verticalActive {
		return CatalogProductResult{}, ErrCatalogVerticalNotFound
	} else if err != nil {
		return CatalogProductResult{}, err
	}
	if input.Scope == "STORE_SCOPED" {
		var storeVertical string
		if err := tx.QueryRowContext(ctx, "SELECT primary_vertical_id FROM dsh.stores WHERE id=$1 FOR SHARE", input.StoreID).Scan(&storeVertical); errors.Is(err, sql.ErrNoRows) {
			return CatalogProductResult{}, ErrCatalogOfferStoreNotFound
		} else if err != nil {
			return CatalogProductResult{}, err
		} else if storeVertical != input.VerticalID {
			return CatalogProductResult{}, ErrCatalogProductOwnership
		}
	}
	if input.Scope == "SHARED" && len(input.CategoryIDs) == 0 {
		return CatalogProductResult{}, ErrCatalogProductScopeMismatch
	}
	if input.CategoryIDs == nil {
		var categoryMismatch bool
		if err := tx.QueryRowContext(ctx, "SELECT EXISTS (SELECT 1 FROM dsh.catalog_product_categories pc JOIN dsh.catalog_categories c ON c.id=pc.category_id WHERE pc.product_id=$1 AND (c.vertical_id<>$2 OR NOT c.active))", productID, input.VerticalID).Scan(&categoryMismatch); err != nil {
			return CatalogProductResult{}, err
		}
		if categoryMismatch {
			return CatalogProductResult{}, ErrCatalogCategoryNotFound
		}
	} else {
		if (input.Scope == "SHARED" && (len(input.CategoryIDs) == 0 || input.AttributeValues == nil || input.VariantAttributeValues == nil || len(input.VariantAttributeValues) != len(current.Variants))) || (input.Scope == "STORE_SCOPED" && len(input.VariantAttributeValues) > 0 && len(input.VariantAttributeValues) != len(current.Variants)) {
			return CatalogProductResult{}, ErrCatalogCategoryNotFound
		}
		rows, queryErr := tx.QueryContext(ctx, "SELECT id FROM dsh.catalog_categories WHERE id=ANY($1) AND vertical_id=$2 AND active=true FOR SHARE", pq.Array(input.CategoryIDs), input.VerticalID)
		if queryErr != nil {
			return CatalogProductResult{}, queryErr
		}
		validCategoryCount := 0
		for rows.Next() {
			var categoryID string
			if scanErr := rows.Scan(&categoryID); scanErr != nil {
				_ = rows.Close()
				return CatalogProductResult{}, scanErr
			}
			validCategoryCount++
		}
		rowsErr := rows.Err()
		closeErr := rows.Close()
		if rowsErr != nil {
			return CatalogProductResult{}, rowsErr
		}
		if closeErr != nil {
			return CatalogProductResult{}, closeErr
		}
		if validCategoryCount != len(input.CategoryIDs) {
			return CatalogProductResult{}, ErrCatalogCategoryNotFound
		}
		variantValuesByID := make(map[string][]CatalogAttributeValueInput, len(input.VariantAttributeValues))
		for _, set := range input.VariantAttributeValues {
			if _, exists := variantValuesByID[set.VariantID]; exists || set.Values == nil {
				return CatalogProductResult{}, ErrCatalogCategoryNotFound
			}
			variantValuesByID[set.VariantID] = set.Values
		}
		if input.Scope == "SHARED" || len(input.VariantAttributeValues) > 0 {
			for _, variant := range current.Variants {
				if _, exists := variantValuesByID[variant.ID]; !exists {
					return CatalogProductResult{}, ErrCatalogCategoryNotFound
				}
			}
		}
	}
	var result sql.Result
	if result, err = tx.ExecContext(ctx, "UPDATE dsh.catalog_products SET vertical_id=$2,scope=$3,store_id=NULLIF($4,''),canonical_name=$5,description=$6,brand=$7,active=$8,version=version+1,updated_at=clock_timestamp() WHERE id=$1 AND version=$9 AND deleted_at IS NULL", productID, input.VerticalID, input.Scope, input.StoreID, input.CanonicalName, input.Description, input.Brand, input.Active, expectedVersion); err != nil {
		return CatalogProductResult{}, err
	}
	if affected, affectedErr := result.RowsAffected(); affectedErr != nil || affected != 1 {
		return CatalogProductResult{}, ErrCatalogVersionConflict
	}
	if input.CategoryIDs != nil {
		if _, err = tx.ExecContext(ctx, "DELETE FROM dsh.catalog_product_attribute_values WHERE product_id=$1", productID); err != nil {
			return CatalogProductResult{}, err
		}
		if _, err = tx.ExecContext(ctx, "DELETE FROM dsh.catalog_variant_attribute_values av USING dsh.catalog_product_variants v WHERE av.variant_id=v.id AND v.product_id=$1", productID); err != nil {
			return CatalogProductResult{}, err
		}
		if _, err = tx.ExecContext(ctx, "DELETE FROM dsh.catalog_product_categories WHERE product_id=$1", productID); err != nil {
			return CatalogProductResult{}, err
		}
		for _, categoryID := range input.CategoryIDs {
			if _, err = tx.ExecContext(ctx, "INSERT INTO dsh.catalog_product_categories(product_id,category_id) VALUES($1,$2)", productID, categoryID); err != nil {
				return CatalogProductResult{}, err
			}
		}
		if len(current.Variants) == 0 {
			return CatalogProductResult{}, ErrCatalogProductNotFound
		}
		variantValuesByID := make(map[string][]CatalogAttributeValueInput, len(input.VariantAttributeValues))
		for _, set := range input.VariantAttributeValues {
			variantValuesByID[set.VariantID] = set.Values
		}
		for _, variant := range current.Variants {
			if err = persistCatalogProductAttributes(ctx, tx, input.VerticalID, input.CategoryIDs, productID, variant.ID, input.AttributeValues, variantValuesByID[variant.ID]); err != nil {
				return CatalogProductResult{}, err
			}
		}
	}
	product, err := readCatalogProductTx(ctx, tx, productID)
	if err != nil {
		return CatalogProductResult{}, err
	}
	if _, err = tx.ExecContext(ctx, "INSERT INTO dsh.catalog_product_mutation_idempotency(idempotency_key,request_hash,product_id,operation,result_version) VALUES($1,$2,$3,'update',$4)", idempotencyKey, requestHash, productID, product.Version); err != nil {
		return CatalogProductResult{}, err
	}
	if _, err = tx.ExecContext(ctx, "INSERT INTO dsh.catalog_product_audit(event_type,idempotency_key,correlation_id,acting_actor_id,product_id,from_version,result_version,request_hash,canonical_name,brand,vertical_id,scope) VALUES('catalog_product_updated',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)", idempotencyKey, correlationID, actingActorID, productID, current.Version, product.Version, requestHash, product.CanonicalName, product.Brand, product.VerticalID, product.Scope); err != nil {
		return CatalogProductResult{}, err
	}
	if err = tx.Commit(); err != nil {
		return CatalogProductResult{}, err
	}
	return CatalogProductResult{Product: product}, nil
}

func ReplaceCatalogProductMedia(ctx context.Context, db *sql.DB, productID string, media []CatalogMediaInput, expectedVersion int, idempotencyKey, requestHash, actingActorID, correlationID string) (CatalogProductResult, error) {
	return replaceCatalogProductMedia(ctx, db, productID, media, expectedVersion, idempotencyKey, requestHash, actingActorID, correlationID, nil)
}

func ReplaceCatalogProductMediaWithAsset(ctx context.Context, db *sql.DB, productID string, media []CatalogMediaInput, expectedVersion int, idempotencyKey, requestHash, actingActorID, correlationID string, asset CatalogMediaAssetInput) (CatalogProductResult, error) {
	return replaceCatalogProductMedia(ctx, db, productID, media, expectedVersion, idempotencyKey, requestHash, actingActorID, correlationID, &asset)
}

func optionalMediaAssetKey(asset *CatalogMediaAssetInput) string {
	if asset == nil {
		return ""
	}
	return strings.TrimSpace(asset.IdempotencyKey)
}

func replaceCatalogProductMedia(ctx context.Context, db *sql.DB, productID string, media []CatalogMediaInput, expectedVersion int, idempotencyKey, requestHash, actingActorID, correlationID string, asset *CatalogMediaAssetInput) (CatalogProductResult, error) {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return CatalogProductResult{}, err
	}
	defer func() { _ = tx.Rollback() }()
	if strings.TrimSpace(productID) == "" || expectedVersion < 1 || strings.TrimSpace(idempotencyKey) == "" || strings.TrimSpace(requestHash) == "" || strings.TrimSpace(actingActorID) == "" || strings.TrimSpace(correlationID) == "" {
		return CatalogProductResult{}, ErrCatalogMediaInvalid
	}
	if _, err = tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "dsh:catalog-media:idempotency:"+idempotencyKey); err != nil {
		return CatalogProductResult{}, err
	}
	var storedHash, storedProductID string
	var storedExpectedVersion int
	err = tx.QueryRowContext(ctx, "SELECT request_hash,product_id,expected_version FROM dsh.catalog_media_mutation_idempotency WHERE idempotency_key=$1 FOR UPDATE", idempotencyKey).Scan(&storedHash, &storedProductID, &storedExpectedVersion)
	if err == nil {
		if storedHash != requestHash || storedProductID != productID || storedExpectedVersion != expectedVersion {
			return CatalogProductResult{}, ErrCatalogIdempotencyConflict
		}
		product, readErr := readCatalogProductTx(ctx, tx, productID)
		if readErr != nil {
			return CatalogProductResult{}, readErr
		}
		if err = tx.Commit(); err != nil {
			return CatalogProductResult{}, err
		}
		return CatalogProductResult{Product: product, Replayed: true}, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return CatalogProductResult{}, err
	}
	current, err := readCatalogProductTxForUpdate(ctx, tx, productID)
	if errors.Is(err, sql.ErrNoRows) {
		return CatalogProductResult{}, ErrCatalogProductNotFound
	}
	if err != nil {
		return CatalogProductResult{}, err
	}
	if current.Version != expectedVersion {
		return CatalogProductResult{}, ErrCatalogVersionConflict
	}
	for _, item := range media {
		var stored bool
		if err = tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM dsh.catalog_media_assets
			WHERE product_id=$1 AND id=$2 AND state='active') OR
			($3<>'' AND EXISTS(SELECT 1 FROM dsh.catalog_media_assets
			WHERE product_id=$1 AND id=$2 AND idempotency_key=$3 AND state='pending'))`, productID, item.AssetID, optionalMediaAssetKey(asset)).Scan(&stored); err != nil {
			return CatalogProductResult{}, err
		}
		if !stored {
			return CatalogProductResult{}, ErrCatalogMediaInvalid
		}
	}
	oldMedia, err := listCatalogMedia(ctx, tx, productID)
	if err != nil {
		return CatalogProductResult{}, err
	}
	if _, err = tx.ExecContext(ctx, "DELETE FROM dsh.catalog_media WHERE product_id=$1", productID); err != nil {
		return CatalogProductResult{}, err
	}
	for _, item := range media {
		if _, err = tx.ExecContext(ctx, "INSERT INTO dsh.catalog_media(product_id,media_asset_id,media_role,ordinal) VALUES($1,$2,$3,$4)", productID, item.AssetID, item.Role, item.Ordinal); err != nil {
			return CatalogProductResult{}, err
		}
	}
	if asset != nil {
		result, updateErr := tx.ExecContext(ctx, "UPDATE dsh.catalog_media_assets SET state='active', retired_at=NULL, cleaned_at=NULL, last_cleanup_error=NULL WHERE id=$1 AND product_id=$2 AND idempotency_key=$3 AND object_key=$4 AND uri=$5 AND request_hash=$6", asset.ID, asset.ProductID, asset.IdempotencyKey, asset.ObjectKey, asset.URI, asset.RequestHash)
		if updateErr != nil {
			return CatalogProductResult{}, updateErr
		}
		if affected, affectedErr := result.RowsAffected(); affectedErr != nil || affected != 1 {
			return CatalogProductResult{}, ErrCatalogMediaInvalid
		}
	}
	newAssetIDs := make(map[string]struct{}, len(media))
	for _, item := range media {
		newAssetIDs[item.AssetID] = struct{}{}
	}
	for _, item := range oldMedia {
		if _, retained := newAssetIDs[item.AssetID]; retained {
			continue
		}
		if _, err = tx.ExecContext(ctx, "UPDATE dsh.catalog_media_assets SET state='retired', retired_at=COALESCE(retired_at,clock_timestamp()), last_cleanup_error=NULL WHERE product_id=$1 AND id=$2 AND state='active'", productID, item.AssetID); err != nil {
			return CatalogProductResult{}, err
		}
	}
	var result sql.Result
	if result, err = tx.ExecContext(ctx, "UPDATE dsh.catalog_products SET version=version+1,updated_at=clock_timestamp() WHERE id=$1 AND version=$2", productID, expectedVersion); err != nil {
		return CatalogProductResult{}, err
	}
	if affected, affectedErr := result.RowsAffected(); affectedErr != nil || affected != 1 {
		return CatalogProductResult{}, ErrCatalogVersionConflict
	}
	product, err := readCatalogProductTx(ctx, tx, productID)
	if err != nil {
		return CatalogProductResult{}, err
	}
	if _, err = tx.ExecContext(ctx, "INSERT INTO dsh.catalog_media_mutation_idempotency(idempotency_key,request_hash,product_id,expected_version,result_version) VALUES($1,$2,$3,$4,$5)", idempotencyKey, requestHash, productID, expectedVersion, product.Version); err != nil {
		return CatalogProductResult{}, err
	}
	if _, err = tx.ExecContext(ctx, "INSERT INTO dsh.catalog_media_audit(event_type,idempotency_key,correlation_id,acting_actor_id,product_id,from_version,result_version,media_count,request_hash) VALUES('catalog_media_replaced',$1,$2,$3,$4,$5,$6,$7,$8)", idempotencyKey, correlationID, actingActorID, productID, current.Version, product.Version, len(media), requestHash); err != nil {
		return CatalogProductResult{}, err
	}
	if err = tx.Commit(); err != nil {
		return CatalogProductResult{}, err
	}
	return CatalogProductResult{Product: product}, nil
}

func RegisterCatalogMediaAssetPending(ctx context.Context, db *sql.DB, asset CatalogMediaAssetInput) (CatalogMediaAssetRecord, bool, error) {
	if strings.TrimSpace(asset.ID) == "" || strings.TrimSpace(asset.ProductID) == "" || strings.TrimSpace(asset.IdempotencyKey) == "" || strings.TrimSpace(asset.ObjectKey) == "" || strings.TrimSpace(asset.URI) == "" || asset.ExpectedVersion < 1 || len(asset.ContentSHA256) != 64 || len(asset.RequestHash) != 64 || strings.TrimSpace(asset.RightsAttestedByActorID) == "" || asset.ByteSize < 1 || asset.ByteSize > 10485760 || (asset.ContentType != "image/jpeg" && asset.ContentType != "image/png") || (asset.Role != "primary" && asset.Role != "gallery") {
		return CatalogMediaAssetRecord{}, false, ErrCatalogMediaInvalid
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return CatalogMediaAssetRecord{}, false, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err = tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "dsh:catalog-media-asset:idempotency:"+asset.IdempotencyKey); err != nil {
		return CatalogMediaAssetRecord{}, false, err
	}
	stored, err := readCatalogMediaAssetByIdempotencyTx(ctx, tx, asset.IdempotencyKey)
	if err == nil {
		if stored.ProductID != asset.ProductID || stored.ExpectedVersion != asset.ExpectedVersion || stored.ObjectKey != asset.ObjectKey || stored.URI != asset.URI || stored.ContentSHA256 != asset.ContentSHA256 || stored.ContentType != asset.ContentType || stored.Role != asset.Role || stored.ByteSize != asset.ByteSize || stored.RequestHash != asset.RequestHash {
			return CatalogMediaAssetRecord{}, false, ErrCatalogIdempotencyConflict
		}
		if stored.State == "failed" {
			if _, err = tx.ExecContext(ctx, "UPDATE dsh.catalog_media_assets SET state='pending', last_cleanup_error=NULL WHERE id=$1", stored.ID); err != nil {
				return CatalogMediaAssetRecord{}, false, err
			}
			stored.State = "pending"
		}
		if err = tx.Commit(); err != nil {
			return CatalogMediaAssetRecord{}, false, err
		}
		return stored, stored.State == "active", nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return CatalogMediaAssetRecord{}, false, err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO dsh.catalog_media_assets(id,product_id,idempotency_key,expected_version,object_key,uri,content_sha256,content_type,byte_size,media_role,state,request_hash,creator,source_description,source_uri,rights_statement,rights_uri,rights_attested_by_actor_id,rights_attested_at)
		VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending',$11,$12,$13,NULLIF($14,''),$15,NULLIF($16,''),$17,clock_timestamp())`, asset.ID, asset.ProductID, asset.IdempotencyKey, asset.ExpectedVersion, asset.ObjectKey, asset.URI, asset.ContentSHA256, asset.ContentType, asset.ByteSize, asset.Role, asset.RequestHash, asset.Creator, asset.SourceDescription, asset.SourceURI, asset.RightsStatement, asset.RightsURI, asset.RightsAttestedByActorID); err != nil {
		return CatalogMediaAssetRecord{}, false, err
	}
	if err = tx.Commit(); err != nil {
		return CatalogMediaAssetRecord{}, false, err
	}
	return CatalogMediaAssetRecord{ID: asset.ID, ProductID: asset.ProductID, IdempotencyKey: asset.IdempotencyKey, ExpectedVersion: asset.ExpectedVersion, ObjectKey: asset.ObjectKey, URI: asset.URI, ContentSHA256: asset.ContentSHA256, ContentType: asset.ContentType, Role: asset.Role, RequestHash: asset.RequestHash, State: "pending", ByteSize: asset.ByteSize}, false, nil
}

func MarkCatalogMediaAssetFailed(ctx context.Context, db *sql.DB, assetID, message string) error {
	_, err := db.ExecContext(ctx, "UPDATE dsh.catalog_media_assets SET state='failed', cleanup_attempts=cleanup_attempts+1, last_cleanup_error=$2 WHERE id=$1 AND state<>'deleted'", assetID, strings.TrimSpace(message))
	return err
}

func ListCatalogMediaAssetsForCleanup(ctx context.Context, db *sql.DB, limit int) ([]CatalogMediaAssetRecord, error) {
	if limit < 1 || limit > 100 {
		limit = 100
	}
	rows, err := db.QueryContext(ctx, "SELECT id,product_id,idempotency_key,expected_version,object_key,uri,content_sha256,content_type,byte_size,media_role,state,cleanup_attempts,last_cleanup_error FROM dsh.catalog_media_assets WHERE state IN ('retired','failed') OR (state='pending' AND created_at < clock_timestamp() - interval '10 minutes') ORDER BY created_at ASC LIMIT $1", limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	assets := make([]CatalogMediaAssetRecord, 0)
	for rows.Next() {
		var asset CatalogMediaAssetRecord
		if err := rows.Scan(&asset.ID, &asset.ProductID, &asset.IdempotencyKey, &asset.ExpectedVersion, &asset.ObjectKey, &asset.URI, &asset.ContentSHA256, &asset.ContentType, &asset.ByteSize, &asset.Role, &asset.State, &asset.CleanupAttempts, &asset.LastCleanupError); err != nil {
			return nil, err
		}
		assets = append(assets, asset)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return assets, nil
}

func MarkCatalogMediaAssetDeleted(ctx context.Context, db *sql.DB, assetID string) error {
	_, err := db.ExecContext(ctx, "UPDATE dsh.catalog_media_assets SET state='deleted', retired_at=COALESCE(retired_at,clock_timestamp()), cleaned_at=clock_timestamp(), cleanup_attempts=cleanup_attempts+1, last_cleanup_error=NULL WHERE id=$1 AND state IN ('retired','failed','pending')", assetID)
	return err
}

func MarkCatalogMediaAssetCleanupFailure(ctx context.Context, db *sql.DB, assetID, message string) error {
	_, err := db.ExecContext(ctx, "UPDATE dsh.catalog_media_assets SET cleanup_attempts=cleanup_attempts+1, last_cleanup_error=$2 WHERE id=$1 AND state IN ('retired','failed','pending')", assetID, strings.TrimSpace(message))
	return err
}
