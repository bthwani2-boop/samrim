package postgres

import (
	"context"
	"database/sql"
	"errors"
	"strings"
)

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
