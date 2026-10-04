package postgres

import (
	"context"
	"database/sql"
	"errors"
	"strings"
)

var ErrFieldCatalogAuthority = errors.New("Field catalog authority is not active for this joining case")

type FieldCatalogScope struct {
	JoiningCaseID string
	StoreID       string
	VerticalID    string
}

type CatalogIdentifierResolution struct {
	Outcome          string
	StoreID          string
	ProductID        string
	VariantID        string
	StoreOfferID     string
	Scope            string
	ProductName      string
	VariantTitle     string
	MeasurementKind  string
	BaseUnit         string
	PublicationState string
}

func AuthorizeFieldCatalogCase(ctx context.Context, db *sql.DB, joiningCaseID, fieldActorID string) (FieldCatalogScope, error) {
	if db == nil || strings.TrimSpace(joiningCaseID) == "" || strings.TrimSpace(fieldActorID) == "" {
		return FieldCatalogScope{}, ErrFieldCatalogAuthority
	}
	var scope FieldCatalogScope
	err := db.QueryRowContext(ctx, `
		SELECT jc.id,s.id,s.primary_vertical_id
		FROM dsh.joining_cases jc
		JOIN dsh.stores s ON s.id=jc.store_id
		JOIN dsh.field_admissions admission ON admission.actor_id=jc.originating_field_actor_id
		WHERE jc.id=$1
		  AND jc.origin='field'
		  AND jc.originating_field_actor_id=$2
		  AND jc.state='approved'
		  AND admission.state='eligible'
		  AND admission.requires_profile_review=false
		  AND s.publication_state='unpublished'
		  AND s.primary_vertical_id=jc.first_store_vertical_id`, strings.TrimSpace(joiningCaseID), strings.TrimSpace(fieldActorID)).Scan(&scope.JoiningCaseID, &scope.StoreID, &scope.VerticalID)
	if errors.Is(err, sql.ErrNoRows) {
		return FieldCatalogScope{}, ErrFieldCatalogAuthority
	}
	return scope, err
}

func ListCatalogProductsForField(ctx context.Context, db *sql.DB, scope FieldCatalogScope, query string, limit int) ([]CatalogProductRecord, error) {
	query = strings.TrimSpace(query)
	if limit < 1 || limit > 100 || len([]rune(query)) > 160 || scope.StoreID == "" || scope.VerticalID == "" {
		return nil, ErrFieldCatalogAuthority
	}
	rows, err := db.QueryContext(ctx, `
		SELECT p.id,p.vertical_id,p.scope,p.store_id,p.canonical_name,p.description,p.brand,p.active,p.version,p.created_at,p.updated_at
		FROM dsh.catalog_products p
		WHERE p.vertical_id=$2
		  AND p.active=true
		  AND ((p.scope='SHARED' AND p.store_id IS NULL) OR (p.scope='STORE_SCOPED' AND p.store_id=$1))
		  AND ($4='' OR lower(p.canonical_name) LIKE lower($4))
		ORDER BY lower(p.canonical_name),p.id
		LIMIT $3`, scope.StoreID, scope.VerticalID, limit, query+"%")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	products := make([]CatalogProductRecord, 0, limit)
	for rows.Next() {
		product, scanErr := readCatalogProductRow(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		products = append(products, product)
	}
	if err = rows.Err(); err != nil {
		return nil, err
	}
	if err = rows.Close(); err != nil {
		return nil, err
	}
	for index := range products {
		products[index], err = hydrateCatalogProduct(ctx, db, products[index])
		if err != nil {
			return nil, err
		}
	}
	return products, nil
}

func ResolveCatalogIdentifier(ctx context.Context, db *sql.DB, storeID, identifierValue string) (CatalogIdentifierResolution, error) {
	storeID = strings.TrimSpace(storeID)
	identifierValue = strings.TrimSpace(identifierValue)
	if db == nil || storeID == "" || len(identifierValue) < 1 || len(identifierValue) > 128 {
		return CatalogIdentifierResolution{}, ErrCatalogIdentifierInvalid
	}
	var verticalID string
	if err := db.QueryRowContext(ctx, "SELECT primary_vertical_id FROM dsh.stores WHERE id=$1", storeID).Scan(&verticalID); errors.Is(err, sql.ErrNoRows) {
		return CatalogIdentifierResolution{}, ErrCatalogOfferStoreNotFound
	} else if err != nil {
		return CatalogIdentifierResolution{}, err
	}
	rows, err := db.QueryContext(ctx, `
		SELECT DISTINCT ON (variant.id) identifier.identifier_type,product.id,variant.id,product.scope,product.store_id,product.canonical_name,variant.title,
	       variant.measurement_kind,variant.base_unit,offer.id,COALESCE(offer.publication_state,'')
		FROM dsh.catalog_variant_identifiers identifier
		JOIN dsh.catalog_product_variants variant ON variant.id=identifier.variant_id
		JOIN dsh.catalog_products product ON product.id=variant.product_id
		LEFT JOIN dsh.catalog_store_offers offer ON offer.store_id=$1 AND offer.variant_id=variant.id
		WHERE lower(btrim(identifier.identifier_value))=lower(btrim($2))
		  AND (identifier.identifier_type<>'SKU' OR identifier.store_id=$1)
		  AND product.vertical_id=$3
		  AND product.active=true
		  AND variant.active=true
		ORDER BY variant.id,identifier.identifier_type`, storeID, identifierValue, verticalID)
	if err != nil {
		return CatalogIdentifierResolution{}, err
	}
	defer rows.Close()
	results := make([]CatalogIdentifierResolution, 0, 2)
	for rows.Next() {
		var item CatalogIdentifierResolution
		var identifierType string
		var productStoreID sql.NullString
		var offerID, publicationState sql.NullString
		if err = rows.Scan(&identifierType, &item.ProductID, &item.VariantID, &item.Scope, &productStoreID, &item.ProductName, &item.VariantTitle, &item.MeasurementKind, &item.BaseUnit, &offerID, &publicationState); err != nil {
			return CatalogIdentifierResolution{}, err
		}
		item.StoreID = storeID
		if offerID.Valid {
			item.StoreOfferID = offerID.String
		}
		if publicationState.Valid {
			item.PublicationState = publicationState.String
		}
		if identifierType != "SKU" && item.Scope == "STORE_SCOPED" {
			if !productStoreID.Valid || productStoreID.String != storeID {
				item.Outcome = "UNAVAILABLE_IN_STORE"
			}
		}
		results = append(results, item)
	}
	if err = rows.Err(); err != nil {
		return CatalogIdentifierResolution{}, err
	}
	if err = rows.Close(); err != nil {
		return CatalogIdentifierResolution{}, err
	}
	if len(results) == 0 {
		return CatalogIdentifierResolution{Outcome: "UNKNOWN_IDENTIFIER", StoreID: storeID}, nil
	}
	if len(results) > 1 {
		return CatalogIdentifierResolution{Outcome: "AMBIGUOUS_IDENTIFIER", StoreID: storeID}, nil
	}
	result := results[0]
	if result.Outcome == "UNAVAILABLE_IN_STORE" {
		return CatalogIdentifierResolution{Outcome: result.Outcome, StoreID: storeID}, nil
	}
	if result.MeasurementKind == "VARIABLE_MEASURE" {
		result.Outcome = "VARIABLE_MEASURE_IDENTIFIER"
	} else if result.StoreOfferID != "" {
		result.Outcome = "EXISTING_STORE_OFFER"
	} else if result.Scope == "SHARED" {
		result.Outcome = "SHARED_PRODUCT_MATCH"
	} else {
		result.Outcome = "STORE_LOCAL_PRODUCT_MATCH"
	}
	return result, nil
}
