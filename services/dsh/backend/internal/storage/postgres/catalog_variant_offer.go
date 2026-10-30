package postgres

import (
	"context"
	"database/sql"
	"errors"
	"strings"
)

func CreateCatalogVariant(ctx context.Context, db *sql.DB, input CatalogVariantInput, idempotencyKey, requestHash, actingActorID, correlationID string) (CatalogVariantResult, error) {
	if input.ID == "" {
		var err error
		input.ID, err = newID("variant")
		if err != nil {
			return CatalogVariantResult{}, err
		}
	}
	if input.ProductID == "" || input.Title == "" {
		return CatalogVariantResult{}, ErrCatalogVariantNotFound
	}
	if input.MeasurementKind == "DISCRETE" && input.BaseUnit != "COUNT" {
		return CatalogVariantResult{}, ErrCatalogOfferQuantityInvalid
	}
	if input.MeasurementKind != "DISCRETE" && input.BaseUnit != "GRAM" && input.BaseUnit != "MILLILITER" {
		return CatalogVariantResult{}, ErrCatalogOfferQuantityInvalid
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return CatalogVariantResult{}, err
	}
	defer func() { _ = tx.Rollback() }()
	if strings.TrimSpace(idempotencyKey) == "" || strings.TrimSpace(requestHash) == "" {
		return CatalogVariantResult{}, ErrCatalogIdempotencyConflict
	}
	if _, err = tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "dsh:catalog-variant:idempotency:"+idempotencyKey); err != nil {
		return CatalogVariantResult{}, err
	}
	var storedHash, storedID, operation string
	err = tx.QueryRowContext(ctx, "SELECT request_hash,variant_id,operation FROM dsh.catalog_variant_mutation_idempotency WHERE idempotency_key=$1 FOR UPDATE", idempotencyKey).Scan(&storedHash, &storedID, &operation)
	if err == nil {
		if storedHash != requestHash || storedID != input.ID || operation != "create" {
			return CatalogVariantResult{}, ErrCatalogIdempotencyConflict
		}
		variant, readErr := readCatalogVariantTx(ctx, tx, input.ID)
		if readErr != nil {
			return CatalogVariantResult{}, readErr
		}
		if err = tx.Commit(); err != nil {
			return CatalogVariantResult{}, err
		}
		return CatalogVariantResult{Variant: variant, Replayed: true}, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return CatalogVariantResult{}, err
	}
	if err = validateCatalogProductModelTx(ctx, tx, input.ProductID); err != nil {
		return CatalogVariantResult{}, err
	}
	if _, err = tx.ExecContext(ctx, "INSERT INTO dsh.catalog_product_variants(id,product_id,title,measurement_kind,base_unit,active) VALUES($1,$2,$3,$4,$5,$6)", input.ID, input.ProductID, input.Title, input.MeasurementKind, input.BaseUnit, input.Active); err != nil {
		return CatalogVariantResult{}, err
	}
	if input.IdentifierValue != "" {
		var storeID string
		var scope string
		if err = tx.QueryRowContext(ctx, "SELECT scope,COALESCE(store_id,'') FROM dsh.catalog_products WHERE id=$1", input.ProductID).Scan(&scope, &storeID); errors.Is(err, sql.ErrNoRows) {
			return CatalogVariantResult{}, ErrCatalogProductNotFound
		} else if err != nil {
			return CatalogVariantResult{}, err
		}
		if input.IdentifierType != "GTIN" && input.IdentifierType != "EAN" && input.IdentifierType != "UPC" && !(input.IdentifierType == "SKU" && scope == "STORE_SCOPED" && storeID != "") {
			return CatalogVariantResult{}, ErrCatalogIdentifierInvalid
		}
		if _, err = tx.ExecContext(ctx, "INSERT INTO dsh.catalog_variant_identifiers(variant_id,identifier_type,identifier_value,store_id) VALUES($1,$2,$3,$4)", input.ID, input.IdentifierType, input.IdentifierValue, identifierStoreScope(input.IdentifierType, storeID)); err != nil {
			if isUniqueViolation(err) {
				return CatalogVariantResult{}, ErrCatalogDuplicateIdentifier
			}
			return CatalogVariantResult{}, err
		}
	}
	variant, err := readCatalogVariantTx(ctx, tx, input.ID)
	if err != nil {
		return CatalogVariantResult{}, err
	}
	if _, err = tx.ExecContext(ctx, "INSERT INTO dsh.catalog_variant_mutation_idempotency(idempotency_key,request_hash,variant_id,operation,result_version) VALUES($1,$2,$3,'create',$4)", idempotencyKey, requestHash, input.ID, variant.Version); err != nil {
		return CatalogVariantResult{}, err
	}
	if _, err = tx.ExecContext(ctx, "INSERT INTO dsh.catalog_variant_audit(event_type,idempotency_key,correlation_id,acting_actor_id,variant_id,product_id,from_version,result_version,request_hash,title,measurement_kind,base_unit,active) VALUES('catalog_variant_created',$1,$2,$3,$4,$5,NULL,$6,$7,$8,$9,$10,$11)", idempotencyKey, correlationID, actingActorID, variant.ID, variant.ProductID, variant.Version, requestHash, variant.Title, variant.MeasurementKind, variant.BaseUnit, variant.Active); err != nil {
		return CatalogVariantResult{}, err
	}
	if err = tx.Commit(); err != nil {
		return CatalogVariantResult{}, err
	}
	return CatalogVariantResult{Variant: variant}, nil
}
func UpdateCatalogVariant(ctx context.Context, db *sql.DB, variantID string, input CatalogVariantInput, expectedVersion int, idempotencyKey, requestHash, actingActorID, correlationID string) (CatalogVariantResult, error) {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return CatalogVariantResult{}, err
	}
	defer func() { _ = tx.Rollback() }()
	if strings.TrimSpace(idempotencyKey) == "" || strings.TrimSpace(requestHash) == "" || strings.TrimSpace(correlationID) == "" || strings.TrimSpace(actingActorID) == "" {
		return CatalogVariantResult{}, ErrCatalogIdempotencyConflict
	}
	if _, err = tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "dsh:catalog-variant:idempotency:"+idempotencyKey); err != nil {
		return CatalogVariantResult{}, err
	}
	var storedHash, storedID, operation string
	err = tx.QueryRowContext(ctx, "SELECT request_hash,variant_id,operation FROM dsh.catalog_variant_mutation_idempotency WHERE idempotency_key=$1 FOR UPDATE", idempotencyKey).Scan(&storedHash, &storedID, &operation)
	if err == nil {
		if storedHash != requestHash || storedID != variantID || operation != "update" {
			return CatalogVariantResult{}, ErrCatalogIdempotencyConflict
		}
		variant, readErr := readCatalogVariantTx(ctx, tx, variantID)
		if readErr != nil {
			return CatalogVariantResult{}, readErr
		}
		if err = tx.Commit(); err != nil {
			return CatalogVariantResult{}, err
		}
		return CatalogVariantResult{Variant: variant, Replayed: true}, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return CatalogVariantResult{}, err
	}
	current, err := readCatalogVariantTx(ctx, tx, variantID)
	if errors.Is(err, sql.ErrNoRows) {
		return CatalogVariantResult{}, ErrCatalogVariantNotFound
	}
	if err != nil {
		return CatalogVariantResult{}, err
	}
	if current.Version != expectedVersion {
		return CatalogVariantResult{}, ErrCatalogVersionConflict
	}
	if err = validateCatalogProductModelTx(ctx, tx, current.ProductID); err != nil {
		return CatalogVariantResult{}, err
	}
	if _, err = tx.ExecContext(ctx, "UPDATE dsh.catalog_product_variants SET title=$2,measurement_kind=$3,base_unit=$4,active=$5,version=version+1,updated_at=clock_timestamp() WHERE id=$1 AND version=$6", variantID, input.Title, input.MeasurementKind, input.BaseUnit, input.Active, expectedVersion); err != nil {
		return CatalogVariantResult{}, err
	}
	variant, err := readCatalogVariantTx(ctx, tx, variantID)
	if err != nil {
		return CatalogVariantResult{}, err
	}
	if _, err = tx.ExecContext(ctx, "INSERT INTO dsh.catalog_variant_mutation_idempotency(idempotency_key,request_hash,variant_id,operation,result_version) VALUES($1,$2,$3,'update',$4)", idempotencyKey, requestHash, variantID, variant.Version); err != nil {
		return CatalogVariantResult{}, err
	}
	if _, err = tx.ExecContext(ctx, "INSERT INTO dsh.catalog_variant_audit(event_type,idempotency_key,correlation_id,acting_actor_id,variant_id,product_id,from_version,result_version,request_hash,title,measurement_kind,base_unit,active) VALUES('catalog_variant_updated',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)", idempotencyKey, correlationID, actingActorID, variant.ID, variant.ProductID, expectedVersion, variant.Version, requestHash, variant.Title, variant.MeasurementKind, variant.BaseUnit, variant.Active); err != nil {
		return CatalogVariantResult{}, err
	}
	if err = tx.Commit(); err != nil {
		return CatalogVariantResult{}, err
	}
	return CatalogVariantResult{Variant: variant}, nil
}

func validateCatalogProductModelTx(ctx context.Context, tx *sql.Tx, productID string) error {
	var scope string
	err := tx.QueryRowContext(ctx, `SELECT p.scope FROM dsh.catalog_products p
		JOIN dsh.commerce_verticals cv ON cv.id=p.vertical_id WHERE p.id=$1 AND cv.active=true AND p.deleted_at IS NULL FOR SHARE OF cv`, productID).Scan(&scope)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrCatalogProductNotFound
	}
	if err != nil {
		return err
	}
	if scope == "SHARED" || scope == "STORE_SCOPED" {
		return nil
	}
	return ErrCatalogProductScopeMismatch
}

func ReadCatalogOffer(ctx context.Context, db *sql.DB, offerID string) (CatalogStoreOfferRecord, error) {
	item, err := scanCatalogOffer(db.QueryRowContext(ctx, catalogOfferSelect+" WHERE o.id=$1", strings.TrimSpace(offerID)))
	if errors.Is(err, sql.ErrNoRows) {
		return CatalogStoreOfferRecord{}, ErrCatalogOfferNotFound
	}
	if err != nil {
		return CatalogStoreOfferRecord{}, err
	}
	return hydrateCatalogOffer(ctx, db, item)
}
func validateOfferInput(input CatalogOfferInput) error {
	if input.StoreID == "" || input.VariantID == "" || input.PriceMinor <= 0 || input.PricingUnitBaseUnits <= 0 {
		return ErrCatalogOfferQuantityInvalid
	}
	if input.QuantityPolicy != "DISCRETE" && input.QuantityPolicy != "MEASURED" && input.QuantityPolicy != "VARIABLE_MEASURE" {
		return ErrCatalogOfferQuantityInvalid
	}
	if input.QuantityMinBaseUnits <= 0 || input.QuantityMaxBaseUnits < input.QuantityMinBaseUnits || input.QuantityStepBaseUnits <= 0 || (input.QuantityMaxBaseUnits-input.QuantityMinBaseUnits)%input.QuantityStepBaseUnits != 0 {
		return ErrCatalogOfferQuantityInvalid
	}
	if input.PricingBasis != "PER_UNIT" && input.PricingBasis != "PER_MEASURE" {
		return ErrCatalogOfferQuantityInvalid
	}
	if input.InventoryPolicy == "" {
		input.InventoryPolicy = "AVAILABILITY_ONLY"
	}
	if input.InventoryPolicy != "AVAILABILITY_ONLY" && input.InventoryPolicy != "QUANTITY_ON_HAND" {
		return ErrCatalogInventoryInvalid
	}
	if input.InventoryOnHandBaseUnits < 0 {
		return ErrCatalogInventoryInvalid
	}
	if input.InventoryPolicy == "AVAILABILITY_ONLY" && input.InventoryOnHandBaseUnits != 0 {
		return ErrCatalogInventoryInvalid
	}
	if input.InventoryPolicy == "QUANTITY_ON_HAND" && input.InventoryOnHandBaseUnits%input.QuantityStepBaseUnits != 0 {
		return ErrCatalogInventoryInvalid
	}
	if input.QuantityPolicy == "DISCRETE" {
		if input.PricingBasis != "PER_UNIT" || input.PricingUnitBaseUnits != 1 {
			return ErrCatalogOfferQuantityInvalid
		}
	} else if input.PricingBasis != "PER_MEASURE" {
		return ErrCatalogOfferQuantityInvalid
	}
	return nil
}
func CreateCatalogOffer(ctx context.Context, db *sql.DB, input CatalogOfferInput, idempotencyKey, requestHash, actingActorID, correlationID string) (CatalogStoreOfferResult, error) {
	return CreateCatalogOfferWithProvenance(ctx, db, input, idempotencyKey, requestHash, actingActorID, correlationID, "PARTNER")
}

func CreateCatalogOfferWithProvenance(ctx context.Context, db *sql.DB, input CatalogOfferInput, idempotencyKey, requestHash, actingActorID, correlationID, provenance string) (CatalogStoreOfferResult, error) {
	if err := validateOfferInput(input); err != nil {
		return CatalogStoreOfferResult{}, err
	}
	if !validCatalogOfferProvenance(provenance) {
		return CatalogStoreOfferResult{}, ErrCatalogOfferInvalidState
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return CatalogStoreOfferResult{}, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err = tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "dsh:catalog-offer:idempotency:"+idempotencyKey); err != nil {
		return CatalogStoreOfferResult{}, err
	}
	var storedHash, storedID, operation string
	err = tx.QueryRowContext(ctx, "SELECT request_hash,offer_id,operation FROM dsh.catalog_store_offer_mutation_idempotency WHERE idempotency_key=$1 FOR UPDATE", idempotencyKey).Scan(&storedHash, &storedID, &operation)
	if err == nil {
		if storedHash != requestHash || operation != "create" {
			return CatalogStoreOfferResult{}, ErrCatalogIdempotencyConflict
		}
		offer, e := scanCatalogOffer(tx.QueryRowContext(ctx, catalogOfferSelect+" WHERE o.id=$1", storedID))
		if e != nil {
			return CatalogStoreOfferResult{}, e
		}
		offer, e = hydrateCatalogOffer(ctx, tx, offer)
		if e != nil {
			return CatalogStoreOfferResult{}, e
		}
		if e = tx.Commit(); e != nil {
			return CatalogStoreOfferResult{}, e
		}
		return CatalogStoreOfferResult{Offer: offer, Replayed: true}, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return CatalogStoreOfferResult{}, err
	}
	var storeVertical, productVertical, productScope, productStore, kind, baseUnit string
	if err = tx.QueryRowContext(ctx, "SELECT s.primary_vertical_id,p.vertical_id,p.scope,COALESCE(p.store_id,''),v.measurement_kind,v.base_unit FROM dsh.stores s JOIN dsh.commerce_verticals cv ON cv.id=s.primary_vertical_id AND cv.active=true JOIN dsh.catalog_product_variants v ON v.id=$2 JOIN dsh.catalog_products p ON p.id=v.product_id WHERE s.id=$1 AND p.deleted_at IS NULL FOR SHARE OF s,cv", input.StoreID, input.VariantID).Scan(&storeVertical, &productVertical, &productScope, &productStore, &kind, &baseUnit); errors.Is(err, sql.ErrNoRows) {
		return CatalogStoreOfferResult{}, ErrCatalogVariantNotFound
	} else if err != nil {
		return CatalogStoreOfferResult{}, err
	}
	if productScope == "STORE_SCOPED" && productStore != input.StoreID {
		return CatalogStoreOfferResult{}, ErrCatalogOfferProductDisabled
	}
	if storeVertical == "" || productVertical == "" || storeVertical != productVertical {
		return CatalogStoreOfferResult{}, ErrCatalogOfferProductDisabled
	}
	if productScope != "SHARED" && !(productScope == "STORE_SCOPED" && productStore == input.StoreID) {
		return CatalogStoreOfferResult{}, ErrCatalogProductScopeMismatch
	}
	if input.QuantityPolicy != kind {
		return CatalogStoreOfferResult{}, ErrCatalogOfferQuantityInvalid
	}
	offerID, err := newID("offer")
	if err != nil {
		return CatalogStoreOfferResult{}, err
	}
	if input.InventoryPolicy == "" {
		input.InventoryPolicy = "AVAILABILITY_ONLY"
	}
	if _, err = tx.ExecContext(ctx, "INSERT INTO dsh.catalog_store_offers(id,store_id,variant_id,price_minor,quantity_policy,quantity_min_base_units,quantity_max_base_units,quantity_step_base_units,pricing_basis,pricing_unit_base_units,inventory_policy,inventory_on_hand_base_units) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)", offerID, input.StoreID, input.VariantID, input.PriceMinor, input.QuantityPolicy, input.QuantityMinBaseUnits, input.QuantityMaxBaseUnits, input.QuantityStepBaseUnits, input.PricingBasis, input.PricingUnitBaseUnits, input.InventoryPolicy, input.InventoryOnHandBaseUnits); err != nil {
		if isUniqueViolation(err) {
			return CatalogStoreOfferResult{}, ErrCatalogOfferAlreadyExists
		}
		return CatalogStoreOfferResult{}, err
	}
	offer, err := scanCatalogOffer(tx.QueryRowContext(ctx, catalogOfferSelect+" WHERE o.id=$1", offerID))
	if err != nil {
		return CatalogStoreOfferResult{}, err
	}
	if _, err = tx.ExecContext(ctx, "INSERT INTO dsh.catalog_store_offer_mutation_idempotency(idempotency_key,request_hash,offer_id,operation,result_version) VALUES($1,$2,$3,'create',$4)", idempotencyKey, requestHash, offerID, offer.Version); err != nil {
		return CatalogStoreOfferResult{}, err
	}
	if _, err = tx.ExecContext(ctx, "INSERT INTO dsh.catalog_store_offer_audit(event_type,idempotency_key,correlation_id,acting_actor_id,offer_id,from_state,to_state,result_version,request_hash,store_id,variant_id,price_minor,old_price_minor,new_price_minor,provenance,currency,availability) VALUES('catalog_store_offer_created',$1,$2,$3,$4,NULL,$5,$6,$7,$8,$9,$10,NULL,$10,$11,$12,$13)", idempotencyKey, correlationID, actingActorID, offerID, offer.PublicationState, offer.Version, requestHash, offer.StoreID, offer.VariantID, offer.PriceMinor, provenance, offer.Currency, offer.Availability); err != nil {
		return CatalogStoreOfferResult{}, err
	}
	if err = tx.Commit(); err != nil {
		return CatalogStoreOfferResult{}, err
	}
	return CatalogStoreOfferResult{Offer: offer}, nil
}
func UpdateCatalogOffer(ctx context.Context, db *sql.DB, offerID string, input CatalogOfferUpdateInput, expectedVersion int, idempotencyKey, requestHash, actingActorID, correlationID string) (CatalogStoreOfferResult, error) {
	return UpdateCatalogOfferWithProvenance(ctx, db, offerID, input, expectedVersion, idempotencyKey, requestHash, actingActorID, correlationID, "PARTNER")
}

func UpdateCatalogOfferWithProvenance(ctx context.Context, db *sql.DB, offerID string, input CatalogOfferUpdateInput, expectedVersion int, idempotencyKey, requestHash, actingActorID, correlationID, provenance string) (CatalogStoreOfferResult, error) {
	if input.PublicationState != "draft" && input.PublicationState != "published" && input.PublicationState != "hidden" {
		return CatalogStoreOfferResult{}, ErrCatalogOfferInvalidState
	}
	if !validCatalogOfferProvenance(provenance) {
		return CatalogStoreOfferResult{}, ErrCatalogOfferInvalidState
	}
	if err := validateOfferInput(CatalogOfferInput{StoreID: "store", VariantID: "variant", PriceMinor: input.PriceMinor, QuantityPolicy: input.QuantityPolicy, QuantityMinBaseUnits: input.QuantityMinBaseUnits, QuantityMaxBaseUnits: input.QuantityMaxBaseUnits, QuantityStepBaseUnits: input.QuantityStepBaseUnits, PricingBasis: input.PricingBasis, PricingUnitBaseUnits: input.PricingUnitBaseUnits}); err != nil {
		return CatalogStoreOfferResult{}, err
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return CatalogStoreOfferResult{}, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err = tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "dsh:catalog-offer:idempotency:"+idempotencyKey); err != nil {
		return CatalogStoreOfferResult{}, err
	}
	var storedHash, storedID, operation string
	err = tx.QueryRowContext(ctx, "SELECT request_hash,offer_id,operation FROM dsh.catalog_store_offer_mutation_idempotency WHERE idempotency_key=$1 FOR UPDATE", idempotencyKey).Scan(&storedHash, &storedID, &operation)
	if err == nil {
		if storedHash != requestHash || storedID != offerID || operation != "update" {
			return CatalogStoreOfferResult{}, ErrCatalogIdempotencyConflict
		}
		offer, e := scanCatalogOffer(tx.QueryRowContext(ctx, catalogOfferSelect+" WHERE o.id=$1", offerID))
		if e != nil {
			return CatalogStoreOfferResult{}, e
		}
		if e = tx.Commit(); e != nil {
			return CatalogStoreOfferResult{}, e
		}
		return CatalogStoreOfferResult{Offer: offer, Replayed: true}, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return CatalogStoreOfferResult{}, err
	}
	current, err := scanCatalogOffer(tx.QueryRowContext(ctx, catalogOfferSelect+" WHERE o.id=$1 FOR UPDATE OF o", offerID))
	if errors.Is(err, sql.ErrNoRows) {
		return CatalogStoreOfferResult{}, ErrCatalogOfferNotFound
	}
	if err != nil {
		return CatalogStoreOfferResult{}, err
	}
	if current.Version != expectedVersion {
		return CatalogStoreOfferResult{}, ErrCatalogVersionConflict
	}
	var modelMismatch bool
	if err = tx.QueryRowContext(ctx, `SELECT NOT EXISTS (
		SELECT 1 FROM dsh.stores s JOIN dsh.commerce_verticals cv ON cv.id=s.primary_vertical_id
		WHERE s.id=$1 AND cv.active=true AND cv.id=$2 AND (
			($3='SHARED' AND $4='') OR
			($3='STORE_SCOPED' AND $4=$1)
		)
	)`, current.StoreID, current.Product.VerticalID, current.Product.Scope, current.Product.StoreID).Scan(&modelMismatch); err != nil {
		return CatalogStoreOfferResult{}, err
	}
	if modelMismatch {
		return CatalogStoreOfferResult{}, ErrCatalogProductScopeMismatch
	}
	if input.QuantityPolicy != current.Variant.MeasurementKind {
		return CatalogStoreOfferResult{}, ErrCatalogOfferQuantityInvalid
	}
	if input.InventoryPolicy == "" {
		input.InventoryPolicy = "AVAILABILITY_ONLY"
	}
	if input.InventoryPolicy != "AVAILABILITY_ONLY" && input.InventoryPolicy != "QUANTITY_ON_HAND" || input.InventoryOnHandBaseUnits < 0 {
		return CatalogStoreOfferResult{}, ErrCatalogInventoryInvalid
	}
	if input.InventoryPolicy == "AVAILABILITY_ONLY" && (input.InventoryOnHandBaseUnits != 0 || current.InventoryReservedBaseUnits != 0) {
		return CatalogStoreOfferResult{}, ErrCatalogInventoryReserved
	}
	if input.InventoryPolicy == "QUANTITY_ON_HAND" && (input.InventoryOnHandBaseUnits < current.InventoryReservedBaseUnits || input.InventoryOnHandBaseUnits%input.QuantityStepBaseUnits != 0) {
		return CatalogStoreOfferResult{}, ErrCatalogInventoryInvalid
	}
	if input.PublicationState == "published" && current.Variant.MeasurementKind == "VARIABLE_MEASURE" {
		return CatalogStoreOfferResult{}, ErrCatalogOfferProductDisabled
	}
	if input.PublicationState == "published" && (!current.Product.Active || !current.Variant.Active || current.Product.VerticalID == "") {
		return CatalogStoreOfferResult{}, ErrCatalogOfferProductDisabled
	}
	if input.PublicationState == "published" {
		var missingRequiredAttribute bool
		if err = tx.QueryRowContext(ctx, `SELECT EXISTS (
			SELECT 1
			FROM dsh.catalog_product_categories pc
			JOIN dsh.catalog_categories c ON c.id=pc.category_id AND c.active=true
			JOIN dsh.catalog_category_attribute_rules r ON r.category_id=c.id AND r.required=true
			JOIN dsh.catalog_attribute_definitions ad ON ad.id=r.attribute_id AND ad.active=true
			WHERE pc.product_id=$1 AND ad.vertical_id=$2
			AND ((r.variant_axis AND NOT EXISTS (SELECT 1 FROM dsh.catalog_variant_attribute_values av WHERE av.variant_id=$3 AND av.attribute_id=r.attribute_id))
				OR (NOT r.variant_axis AND NOT EXISTS (SELECT 1 FROM dsh.catalog_product_attribute_values av WHERE av.product_id=$1 AND av.attribute_id=r.attribute_id)))
		)`, current.Product.ID, current.Product.VerticalID, current.Variant.ID).Scan(&missingRequiredAttribute); err != nil {
			return CatalogStoreOfferResult{}, err
		}
		if missingRequiredAttribute {
			return CatalogStoreOfferResult{}, ErrCatalogOfferProductDisabled
		}
		var invalidModifierConfiguration bool
		if err = tx.QueryRowContext(ctx, `SELECT EXISTS (
			SELECT 1
			FROM dsh.catalog_store_offer_modifier_groups og
			JOIN dsh.catalog_modifier_groups mg ON mg.id=og.group_id
			WHERE og.offer_id=$1
			AND (mg.store_id<>$2 OR NOT mg.active OR mg.min_selections > (SELECT COUNT(*) FROM dsh.catalog_modifier_options mo WHERE mo.group_id=mg.id AND mo.availability=true))
		)`, current.ID, current.StoreID).Scan(&invalidModifierConfiguration); err != nil {
			return CatalogStoreOfferResult{}, err
		}
		if invalidModifierConfiguration {
			return CatalogStoreOfferResult{}, ErrCatalogOfferProductDisabled
		}
	}
	if _, err = tx.ExecContext(ctx, "UPDATE dsh.catalog_store_offers SET price_minor=$2,quantity_policy=$3,quantity_min_base_units=$4,quantity_max_base_units=$5,quantity_step_base_units=$6,pricing_basis=$7,pricing_unit_base_units=$8,inventory_policy=$9,inventory_on_hand_base_units=$10,inventory_reserved_base_units=CASE WHEN $9='AVAILABILITY_ONLY' THEN 0 ELSE inventory_reserved_base_units END,availability=$11,publication_state=$12,version=version+1,updated_at=clock_timestamp() WHERE id=$1 AND version=$13", offerID, input.PriceMinor, input.QuantityPolicy, input.QuantityMinBaseUnits, input.QuantityMaxBaseUnits, input.QuantityStepBaseUnits, input.PricingBasis, input.PricingUnitBaseUnits, input.InventoryPolicy, input.InventoryOnHandBaseUnits, input.Availability, input.PublicationState, expectedVersion); err != nil {
		return CatalogStoreOfferResult{}, err
	}
	offer, err := scanCatalogOffer(tx.QueryRowContext(ctx, catalogOfferSelect+" WHERE o.id=$1", offerID))
	if err != nil {
		return CatalogStoreOfferResult{}, err
	}
	if _, err = tx.ExecContext(ctx, "INSERT INTO dsh.catalog_store_offer_mutation_idempotency(idempotency_key,request_hash,offer_id,operation,result_version) VALUES($1,$2,$3,'update',$4)", idempotencyKey, requestHash, offerID, offer.Version); err != nil {
		return CatalogStoreOfferResult{}, err
	}
	if _, err = tx.ExecContext(ctx, "INSERT INTO dsh.catalog_store_offer_audit(event_type,idempotency_key,correlation_id,acting_actor_id,offer_id,from_state,to_state,expected_version,result_version,request_hash,store_id,variant_id,price_minor,old_price_minor,new_price_minor,provenance,currency,availability) VALUES('catalog_store_offer_updated',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)", idempotencyKey, correlationID, actingActorID, offerID, current.PublicationState, offer.PublicationState, expectedVersion, offer.Version, requestHash, offer.StoreID, offer.VariantID, offer.PriceMinor, current.PriceMinor, offer.PriceMinor, provenance, offer.Currency, offer.Availability); err != nil {
		return CatalogStoreOfferResult{}, err
	}
	if err = tx.Commit(); err != nil {
		return CatalogStoreOfferResult{}, err
	}
	return CatalogStoreOfferResult{Offer: offer}, nil
}

func validCatalogOfferProvenance(value string) bool {
	switch value {
	case "PARTNER", "CONTROL_PANEL", "IMPORT", "QUICK_PRICES", "LEGACY":
		return true
	default:
		return false
	}
}
