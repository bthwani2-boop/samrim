package postgres

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
)

type CatalogAttributeDefinitionRecord struct {
	ID, VerticalID, Code, NameAr, ValueKind string
	Active, Filterable                      bool
	Version                                 int
}

type CatalogAttributeDefinitionInput struct {
	ID, VerticalID, Code, NameAr, ValueKind string
	Active                                  bool
}

type CatalogAttributeEnumOptionRecord struct {
	AttributeID, OptionValue string
	Active                   bool
	Ordinal                  int
}

type CatalogAttributeEnumOptionInput struct {
	AttributeID, OptionValue string
	Active                   bool
	Ordinal                  int
}

type CatalogAttributeValueInput struct {
	AttributeID, ValueKind string
	TextValue              *string
	IntegerValue           *int64
	DecimalValue           *string
	BooleanValue           *bool
	EnumValue              *string
	DateValue              *string
	MeasurementUnit        *string
}

type CatalogModifierGroupInput struct {
	ID, StoreID, NameAr          string
	Required                     bool
	MinSelections, MaxSelections int
	Active                       bool
}

type CatalogModifierOptionInput struct {
	ID, GroupID, NameAr string
	PriceDeltaMinor     int64
	Availability        bool
	Ordinal             int
}

type CatalogStorefrontSectionInput struct {
	ID, StoreID, NameAr string
	NameEn              *string
	Ordinal             int
	Active              bool
}

func HashCatalogAttributeDefinitionRequest(input CatalogAttributeDefinitionInput) string {
	return hashFacts("attribute", input.ID, input.VerticalID, input.Code, input.NameAr, input.ValueKind, fmt.Sprint(input.Active))
}

func HashCatalogAttributeEnumOptionRequest(input CatalogAttributeEnumOptionInput) string {
	return hashFacts("attribute-enum-option", input.AttributeID, input.OptionValue, fmt.Sprint(input.Active), fmt.Sprint(input.Ordinal))
}

func CreateCatalogAttributeDefinition(ctx context.Context, db *sql.DB, input CatalogAttributeDefinitionInput, idempotencyKey, requestHash string) (CatalogAttributeDefinitionRecord, bool, error) {
	if strings.TrimSpace(input.ID) == "" || strings.TrimSpace(idempotencyKey) == "" || strings.TrimSpace(requestHash) == "" {
		return CatalogAttributeDefinitionRecord{}, false, ErrCatalogIdempotencyConflict
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return CatalogAttributeDefinitionRecord{}, false, err
	}
	defer func() { _ = tx.Rollback() }()
	var sharedCatalog bool
	if err = tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM dsh.commerce_verticals WHERE id=$1 AND active=true AND catalog_model='SHARED_CATALOG' FOR SHARE)`, input.VerticalID).Scan(&sharedCatalog); err != nil {
		return CatalogAttributeDefinitionRecord{}, false, err
	}
	if !sharedCatalog {
		return CatalogAttributeDefinitionRecord{}, false, ErrCatalogProductModelMismatch
	}
	var storedHash, storedID, operation string
	err = tx.QueryRowContext(ctx, "SELECT request_hash,attribute_id,operation FROM dsh.catalog_attribute_mutation_idempotency WHERE idempotency_key=$1 FOR UPDATE", idempotencyKey).Scan(&storedHash, &storedID, &operation)
	if err == nil {
		if storedHash != requestHash || storedID != input.ID || operation != "create" {
			return CatalogAttributeDefinitionRecord{}, false, ErrCatalogIdempotencyConflict
		}
		item, readErr := readCatalogAttributeDefinitionTx(ctx, tx, input.ID)
		if readErr != nil {
			return CatalogAttributeDefinitionRecord{}, false, readErr
		}
		if err = tx.Commit(); err != nil {
			return CatalogAttributeDefinitionRecord{}, false, err
		}
		return item, true, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return CatalogAttributeDefinitionRecord{}, false, err
	}
	if _, err = tx.ExecContext(ctx, "INSERT INTO dsh.catalog_attribute_definitions(id,vertical_id,code,name_ar,value_kind,active) VALUES($1,$2,$3,$4,$5,$6)", input.ID, input.VerticalID, input.Code, input.NameAr, input.ValueKind, input.Active); err != nil {
		return CatalogAttributeDefinitionRecord{}, false, err
	}
	item, err := readCatalogAttributeDefinitionTx(ctx, tx, input.ID)
	if err != nil {
		return CatalogAttributeDefinitionRecord{}, false, err
	}
	if _, err = tx.ExecContext(ctx, "INSERT INTO dsh.catalog_attribute_mutation_idempotency(idempotency_key,request_hash,attribute_id,operation,result_version) VALUES($1,$2,$3,'create',$4)", idempotencyKey, requestHash, input.ID, item.Version); err != nil {
		return CatalogAttributeDefinitionRecord{}, false, err
	}
	if err = tx.Commit(); err != nil {
		return CatalogAttributeDefinitionRecord{}, false, err
	}
	return item, false, nil
}

func readCatalogAttributeDefinitionTx(ctx context.Context, tx *sql.Tx, id string) (CatalogAttributeDefinitionRecord, error) {
	var item CatalogAttributeDefinitionRecord
	err := tx.QueryRowContext(ctx, "SELECT id,vertical_id,code,name_ar,value_kind,active,version FROM dsh.catalog_attribute_definitions WHERE id=$1", id).Scan(&item.ID, &item.VerticalID, &item.Code, &item.NameAr, &item.ValueKind, &item.Active, &item.Version)
	if errors.Is(err, sql.ErrNoRows) {
		return CatalogAttributeDefinitionRecord{}, ErrCatalogCategoryNotFound
	}
	return item, err
}

func ListCatalogAttributeDefinitions(ctx context.Context, db *sql.DB, verticalID string, activeOnly bool) ([]CatalogAttributeDefinitionRecord, error) {
	var catalogModel string
	if err := db.QueryRowContext(ctx, "SELECT COALESCE(catalog_model,'') FROM dsh.commerce_verticals WHERE id=$1", strings.TrimSpace(verticalID)).Scan(&catalogModel); errors.Is(err, sql.ErrNoRows) {
		return nil, ErrCatalogVerticalNotFound
	} else if err != nil {
		return nil, err
	}
	if catalogModel != "SHARED_CATALOG" {
		return []CatalogAttributeDefinitionRecord{}, nil
	}
	where := []string{"vertical_id=$1"}
	args := []any{strings.TrimSpace(verticalID)}
	if activeOnly {
		where = append(where, "active=true")
	}
	rows, err := db.QueryContext(ctx, "SELECT id,vertical_id,code,name_ar,value_kind,active,version FROM dsh.catalog_attribute_definitions WHERE "+strings.Join(where, " AND ")+" ORDER BY code,id", args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]CatalogAttributeDefinitionRecord, 0)
	for rows.Next() {
		var item CatalogAttributeDefinitionRecord
		if err := rows.Scan(&item.ID, &item.VerticalID, &item.Code, &item.NameAr, &item.ValueKind, &item.Active, &item.Version); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func ListCatalogAttributeEnumOptions(ctx context.Context, db *sql.DB, attributeID string, activeOnly bool) ([]CatalogAttributeEnumOptionRecord, error) {
	where := "attribute_id=$1"
	if activeOnly {
		where += " AND active=true"
	}
	rows, err := db.QueryContext(ctx, "SELECT attribute_id,option_value,active,ordinal FROM dsh.catalog_attribute_enum_options WHERE "+where+" ORDER BY ordinal,option_value", strings.TrimSpace(attributeID))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]CatalogAttributeEnumOptionRecord, 0)
	for rows.Next() {
		var item CatalogAttributeEnumOptionRecord
		if err := rows.Scan(&item.AttributeID, &item.OptionValue, &item.Active, &item.Ordinal); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func CreateCatalogAttributeEnumOption(ctx context.Context, db *sql.DB, input CatalogAttributeEnumOptionInput, idempotencyKey, requestHash string) (CatalogAttributeEnumOptionRecord, bool, error) {
	input.AttributeID = strings.TrimSpace(input.AttributeID)
	input.OptionValue = strings.Join(strings.Fields(strings.TrimSpace(input.OptionValue)), " ")
	if input.AttributeID == "" || input.OptionValue == "" || input.Ordinal < 0 || input.Ordinal > 100 || strings.TrimSpace(idempotencyKey) == "" || strings.TrimSpace(requestHash) == "" {
		return CatalogAttributeEnumOptionRecord{}, false, ErrCatalogIdempotencyConflict
	}
	_, kind, _, err := readCatalogAttributeDefinition(ctx, db, input.AttributeID)
	if err != nil {
		return CatalogAttributeEnumOptionRecord{}, false, err
	}
	if kind != "ENUM" {
		return CatalogAttributeEnumOptionRecord{}, false, ErrCatalogCategoryNotFound
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return CatalogAttributeEnumOptionRecord{}, false, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err = tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "dsh:catalog-attribute-option:idempotency:"+idempotencyKey); err != nil {
		return CatalogAttributeEnumOptionRecord{}, false, err
	}
	var storedHash, storedID, operation string
	err = tx.QueryRowContext(ctx, "SELECT request_hash,attribute_id,operation FROM dsh.catalog_attribute_mutation_idempotency WHERE idempotency_key=$1 FOR UPDATE", idempotencyKey).Scan(&storedHash, &storedID, &operation)
	if err == nil {
		if storedHash != requestHash || storedID != input.AttributeID || operation != "update" {
			return CatalogAttributeEnumOptionRecord{}, false, ErrCatalogIdempotencyConflict
		}
		var item CatalogAttributeEnumOptionRecord
		if err = tx.QueryRowContext(ctx, "SELECT attribute_id,option_value,active,ordinal FROM dsh.catalog_attribute_enum_options WHERE attribute_id=$1 AND option_value=$2", input.AttributeID, input.OptionValue).Scan(&item.AttributeID, &item.OptionValue, &item.Active, &item.Ordinal); err != nil {
			return CatalogAttributeEnumOptionRecord{}, false, err
		}
		if err = tx.Commit(); err != nil {
			return CatalogAttributeEnumOptionRecord{}, false, err
		}
		return item, true, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return CatalogAttributeEnumOptionRecord{}, false, err
	}
	if _, err = tx.ExecContext(ctx, "INSERT INTO dsh.catalog_attribute_enum_options(attribute_id,option_value,active,ordinal) VALUES($1,$2,$3,$4)", input.AttributeID, input.OptionValue, input.Active, input.Ordinal); err != nil {
		return CatalogAttributeEnumOptionRecord{}, false, err
	}
	if _, err = tx.ExecContext(ctx, "INSERT INTO dsh.catalog_attribute_mutation_idempotency(idempotency_key,request_hash,attribute_id,operation,result_version) VALUES($1,$2,$3,'update',1)", idempotencyKey, requestHash, input.AttributeID); err != nil {
		return CatalogAttributeEnumOptionRecord{}, false, err
	}
	if err = tx.Commit(); err != nil {
		return CatalogAttributeEnumOptionRecord{}, false, err
	}
	return CatalogAttributeEnumOptionRecord{AttributeID: input.AttributeID, OptionValue: input.OptionValue, Active: input.Active, Ordinal: input.Ordinal}, false, nil
}

func readCatalogAttributeDefinition(ctx context.Context, db *sql.DB, attributeID string) (string, string, bool, error) {
	var verticalID, valueKind string
	var active bool
	err := db.QueryRowContext(ctx, "SELECT vertical_id,value_kind,active FROM dsh.catalog_attribute_definitions WHERE id=$1", attributeID).Scan(&verticalID, &valueKind, &active)
	if errors.Is(err, sql.ErrNoRows) {
		return "", "", false, ErrCatalogCategoryNotFound
	}
	return verticalID, valueKind, active, err
}

func validateAttributeValue(ctx context.Context, db rowQueryer, ownerColumn, ownerID string, input CatalogAttributeValueInput) error {
	var kind, verticalID string
	var active bool
	if err := db.QueryRowContext(ctx, "SELECT value_kind,vertical_id,active FROM dsh.catalog_attribute_definitions WHERE id=$1", input.AttributeID).Scan(&kind, &verticalID, &active); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return ErrCatalogCategoryNotFound
		}
		return err
	}
	if !active || (input.ValueKind != "" && input.ValueKind != kind) {
		return ErrCatalogCategoryNotFound
	}
	if err := validateSingleAttributeValue(input, kind); err != nil {
		return err
	}
	if kind == "ENUM" {
		var optionActive bool
		if err := db.QueryRowContext(ctx, "SELECT active FROM dsh.catalog_attribute_enum_options WHERE attribute_id=$1 AND option_value=$2", input.AttributeID, strings.TrimSpace(*input.EnumValue)).Scan(&optionActive); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return ErrCatalogCategoryNotFound
			}
			return err
		}
		if !optionActive {
			return ErrCatalogCategoryNotFound
		}
	}
	variantAxis := ownerColumn == "variant_id"
	var productID, ownerVertical, ownerScope, catalogModel string
	if variantAxis {
		err := db.QueryRowContext(ctx, `SELECT p.id,p.vertical_id,p.scope,vx.catalog_model
			FROM dsh.catalog_product_variants v
			JOIN dsh.catalog_products p ON p.id=v.product_id
			JOIN dsh.commerce_verticals vx ON vx.id=p.vertical_id WHERE v.id=$1`, ownerID).
			Scan(&productID, &ownerVertical, &ownerScope, &catalogModel)
		if err != nil {
			return err
		}
	} else {
		err := db.QueryRowContext(ctx, `SELECT p.id,p.vertical_id,p.scope,vx.catalog_model
			FROM dsh.catalog_products p
			JOIN dsh.commerce_verticals vx ON vx.id=p.vertical_id WHERE p.id=$1`, ownerID).
			Scan(&productID, &ownerVertical, &ownerScope, &catalogModel)
		if err != nil {
			return err
		}
	}
	if ownerVertical != verticalID || ownerScope != "SHARED" || catalogModel != "SHARED_CATALOG" {
		return ErrCatalogCategoryNotFound
	}
	var configured bool
	if err := db.QueryRowContext(ctx, `SELECT EXISTS (
		SELECT 1 FROM dsh.catalog_product_categories pc
		JOIN dsh.catalog_categories c ON c.id=pc.category_id AND c.active=true
		JOIN dsh.catalog_category_attribute_rules r ON r.category_id=c.id AND r.attribute_id=$2 AND r.variant_axis=$3
		WHERE pc.product_id=$1)`, productID, input.AttributeID, variantAxis).Scan(&configured); err != nil {
		return err
	}
	if !configured {
		return ErrCatalogCategoryNotFound
	}
	return nil
}

func validateSingleAttributeValue(input CatalogAttributeValueInput, kind string) error {
	count := 0
	if input.TextValue != nil {
		count++
	}
	if input.IntegerValue != nil {
		count++
	}
	if input.DecimalValue != nil {
		count++
	}
	if input.BooleanValue != nil {
		count++
	}
	if input.EnumValue != nil {
		count++
	}
	if input.DateValue != nil {
		count++
	}
	if count != 1 {
		return errors.New("catalog attribute value must contain exactly one typed value")
	}
	if (kind == "TEXT" && input.TextValue == nil) || (kind == "INTEGER" && input.IntegerValue == nil) || (kind == "DECIMAL" && input.DecimalValue == nil) || (kind == "BOOLEAN" && input.BooleanValue == nil) || (kind == "ENUM" && input.EnumValue == nil) || (kind == "DATE" && input.DateValue == nil) || (kind == "MEASUREMENT" && (input.DecimalValue == nil || input.MeasurementUnit == nil || strings.TrimSpace(*input.MeasurementUnit) == "")) {
		return errors.New("catalog attribute value kind does not match its typed value")
	}
	return nil
}

type attributeValueExecutor interface {
	rowQueryer
	ExecContext(context.Context, string, ...any) (sql.Result, error)
}

func upsertAttributeValue(ctx context.Context, db attributeValueExecutor, table, ownerColumn, ownerID string, input CatalogAttributeValueInput) error {
	if strings.TrimSpace(input.AttributeID) == "" || strings.TrimSpace(ownerID) == "" {
		return ErrCatalogCategoryNotFound
	}
	if err := validateAttributeValue(ctx, db, ownerColumn, ownerID, input); err != nil {
		return err
	}
	_, err := db.ExecContext(ctx, fmt.Sprintf(`INSERT INTO dsh.%s(%s,attribute_id,text_value,integer_value,decimal_value,boolean_value,enum_value,date_value,measurement_unit) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (%s,attribute_id) DO UPDATE SET text_value=EXCLUDED.text_value,integer_value=EXCLUDED.integer_value,decimal_value=EXCLUDED.decimal_value,boolean_value=EXCLUDED.boolean_value,enum_value=EXCLUDED.enum_value,date_value=EXCLUDED.date_value,measurement_unit=EXCLUDED.measurement_unit`, table, ownerColumn, ownerColumn), ownerID, input.AttributeID, input.TextValue, input.IntegerValue, input.DecimalValue, input.BooleanValue, input.EnumValue, input.DateValue, input.MeasurementUnit)
	return err
}

func persistCatalogProductAttributes(ctx context.Context, tx *sql.Tx, verticalID string, categoryIDs []string, productID, variantID string, productValues, variantValues []CatalogAttributeValueInput) error {
	type rule struct {
		kind        string
		required    bool
		variantAxis bool
	}
	rules := make(map[string]rule)
	for _, categoryID := range categoryIDs {
		rows, err := tx.QueryContext(ctx, `SELECT r.attribute_id,a.value_kind,r.required,r.variant_axis FROM dsh.catalog_category_attribute_rules r JOIN dsh.catalog_categories c ON c.id=r.category_id AND c.active=true JOIN dsh.catalog_attribute_definitions a ON a.id=r.attribute_id AND a.active=true WHERE c.id=$1 AND c.vertical_id=$2`, categoryID, verticalID)
		if err != nil {
			return err
		}
		for rows.Next() {
			var id string
			var current rule
			if err := rows.Scan(&id, &current.kind, &current.required, &current.variantAxis); err != nil {
				_ = rows.Close()
				return err
			}
			if previous, ok := rules[id]; ok && (previous.kind != current.kind || previous.variantAxis != current.variantAxis) {
				_ = rows.Close()
				return ErrCatalogCategoryNotFound
			}
			if previous, ok := rules[id]; ok {
				current.required = current.required || previous.required
			}
			rules[id] = current
		}
		if err := rows.Err(); err != nil {
			_ = rows.Close()
			return err
		}
		if err := rows.Close(); err != nil {
			return err
		}
	}
	provided := make(map[string]bool, len(productValues)+len(variantValues))
	persist := func(values []CatalogAttributeValueInput, variant bool) error {
		for _, value := range values {
			id := strings.TrimSpace(value.AttributeID)
			configured, ok := rules[id]
			if !ok || configured.variantAxis != variant || value.ValueKind != configured.kind || provided[id] {
				return ErrCatalogCategoryNotFound
			}
			ownerColumn, table, ownerID := "product_id", "catalog_product_attribute_values", productID
			if variant {
				ownerColumn, table, ownerID = "variant_id", "catalog_variant_attribute_values", variantID
			}
			if err := upsertAttributeValue(ctx, tx, table, ownerColumn, ownerID, value); err != nil {
				return err
			}
			provided[id] = true
		}
		return nil
	}
	if err := persist(productValues, false); err != nil {
		return err
	}
	if err := persist(variantValues, true); err != nil {
		return err
	}
	for id, configured := range rules {
		if configured.required && !provided[id] {
			return ErrCatalogCategoryNotFound
		}
	}
	return nil
}

func UpsertCatalogProductAttributeValue(ctx context.Context, db *sql.DB, productID string, input CatalogAttributeValueInput) error {
	return upsertAttributeValue(ctx, db, "catalog_product_attribute_values", "product_id", productID, input)
}
func UpsertCatalogVariantAttributeValue(ctx context.Context, db *sql.DB, variantID string, input CatalogAttributeValueInput) error {
	return upsertAttributeValue(ctx, db, "catalog_variant_attribute_values", "variant_id", variantID, input)
}

func UpsertCatalogCategoryAttributeRule(ctx context.Context, db *sql.DB, rule CatalogAttributeRuleRecord, expectedVersion int, idempotencyKey, requestHash string, audit CatalogRegistryAuditInput) error {
	rule.CategoryID = strings.TrimSpace(rule.CategoryID)
	rule.AttributeID = strings.TrimSpace(rule.AttributeID)
	idempotencyKey = strings.TrimSpace(idempotencyKey)
	if rule.CategoryID == "" || rule.AttributeID == "" || expectedVersion < 0 || idempotencyKey == "" || requestHash == "" {
		return ErrCatalogCategoryNotFound
	}
	if rule.Filterable {
		return ErrCatalogAttributeRuleInvalid
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	entityID := rule.CategoryID + ":" + rule.AttributeID
	if _, err = tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "dsh:catalog-registry:"+idempotencyKey); err != nil {
		return err
	}
	var entityType, storedEntityID, storedHash string
	err = tx.QueryRowContext(ctx, "SELECT entity_type,entity_id,request_hash FROM dsh.catalog_registry_mutation_idempotency WHERE idempotency_key=$1 FOR UPDATE", idempotencyKey).Scan(&entityType, &storedEntityID, &storedHash)
	if err == nil {
		if entityType != "attribute_rule" || storedEntityID != entityID || storedHash != requestHash {
			return ErrCatalogIdempotencyConflict
		}
		if err = tx.Commit(); err != nil {
			return err
		}
		return nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	if _, err = tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "dsh:catalog-attribute-rule:"+entityID); err != nil {
		return err
	}
	var categoryVertical, attributeVertical, catalogModel string
	if err = tx.QueryRowContext(ctx, `SELECT c.vertical_id,COALESCE(cv.catalog_model,'') FROM dsh.catalog_categories c JOIN dsh.commerce_verticals cv ON cv.id=c.vertical_id WHERE c.id=$1 AND c.active=true FOR SHARE OF cv`, rule.CategoryID).Scan(&categoryVertical, &catalogModel); err != nil {
		return err
	}
	if catalogModel != "SHARED_CATALOG" {
		return ErrCatalogProductModelMismatch
	}
	if err = tx.QueryRowContext(ctx, "SELECT vertical_id FROM dsh.catalog_attribute_definitions WHERE id=$1 AND active=true", rule.AttributeID).Scan(&attributeVertical); err != nil {
		return err
	}
	if categoryVertical != attributeVertical {
		return ErrCatalogCategoryNotFound
	}
	requested := rule
	var before *CatalogAttributeRuleRecord
	var currentRequired, currentFilterable, currentVariantAxis bool
	var version int
	err = tx.QueryRowContext(ctx, "SELECT required,filterable,variant_axis,version FROM dsh.catalog_category_attribute_rules WHERE category_id=$1 AND attribute_id=$2 FOR UPDATE", rule.CategoryID, rule.AttributeID).Scan(&currentRequired, &currentFilterable, &currentVariantAxis, &version)
	if errors.Is(err, sql.ErrNoRows) {
		if expectedVersion != 0 {
			return ErrCatalogVersionConflict
		}
	} else if err != nil {
		return err
	} else {
		if version != expectedVersion {
			return ErrCatalogVersionConflict
		}
		before = &CatalogAttributeRuleRecord{CategoryID: rule.CategoryID, AttributeID: rule.AttributeID, Required: currentRequired, Filterable: currentFilterable, VariantAxis: currentVariantAxis, Version: version}
	}
	if before == nil {
		_, err = tx.ExecContext(ctx, "INSERT INTO dsh.catalog_category_attribute_rules(category_id,attribute_id,required,filterable,variant_axis,version) VALUES($1,$2,$3,$4,$5,1)", rule.CategoryID, rule.AttributeID, requested.Required, requested.Filterable, requested.VariantAxis)
	} else {
		_, err = tx.ExecContext(ctx, "UPDATE dsh.catalog_category_attribute_rules SET required=$3,filterable=$4,variant_axis=$5,version=version+1,updated_at=clock_timestamp() WHERE category_id=$1 AND attribute_id=$2 AND version=$6", rule.CategoryID, rule.AttributeID, requested.Required, requested.Filterable, requested.VariantAxis, expectedVersion)
	}
	if err != nil {
		return err
	}
	afterVersion := expectedVersion + 1
	if _, err = tx.ExecContext(ctx, "INSERT INTO dsh.catalog_registry_mutation_idempotency(idempotency_key,request_hash,entity_type,entity_id) VALUES($1,$2,'attribute_rule',$3)", idempotencyKey, requestHash, entityID); err != nil {
		return err
	}
	after := CatalogAttributeRuleRecord{CategoryID: rule.CategoryID, AttributeID: rule.AttributeID, Required: requested.Required, Filterable: requested.Filterable, VariantAxis: requested.VariantAxis, Version: afterVersion}
	action := "UPDATED"
	if before == nil {
		action = "CREATED"
	}
	audit.EntityType, audit.EntityID, audit.Action = "attribute_rule", entityID, action
	audit.ExpectedVersion, audit.ResultingVersion = expectedVersion, afterVersion
	audit.BeforeState, audit.AfterState = before, after
	if err = writeCatalogRegistryAudit(ctx, tx, audit); err != nil {
		return err
	}
	return tx.Commit()
}

func CreateCatalogModifierGroup(ctx context.Context, db *sql.DB, input CatalogModifierGroupInput) (CatalogModifierGroupRecord, error) {
	if input.ID == "" {
		var err error
		input.ID, err = newID("modifier-group")
		if err != nil {
			return CatalogModifierGroupRecord{}, err
		}
	}
	result, err := db.ExecContext(ctx, `INSERT INTO dsh.catalog_modifier_groups(id,store_id,name_ar,required,min_selections,max_selections,active)
		SELECT $1,$2,$3,$4,$5,$6,$7 WHERE EXISTS (
			SELECT 1 FROM dsh.stores s JOIN dsh.commerce_verticals cv ON cv.id=s.primary_vertical_id
			WHERE s.id=$2 AND cv.active=true AND cv.catalog_model='STORE_LOCAL_CATALOG'
		)`, input.ID, input.StoreID, input.NameAr, input.Required, input.MinSelections, input.MaxSelections, input.Active)
	if err != nil {
		return CatalogModifierGroupRecord{}, err
	}
	if rows, err := result.RowsAffected(); err != nil || rows != 1 {
		if err != nil {
			return CatalogModifierGroupRecord{}, err
		}
		return CatalogModifierGroupRecord{}, ErrCatalogProductModelMismatch
	}
	items, err := listModifierGroupsByID(ctx, db, input.ID)
	if err != nil {
		return CatalogModifierGroupRecord{}, err
	}
	if len(items) != 1 {
		return CatalogModifierGroupRecord{}, ErrCatalogCategoryNotFound
	}
	return items[0], nil
}

func CreateCatalogModifierOption(ctx context.Context, db *sql.DB, input CatalogModifierOptionInput) (CatalogModifierOptionRecord, error) {
	if input.ID == "" {
		var err error
		input.ID, err = newID("modifier-option")
		if err != nil {
			return CatalogModifierOptionRecord{}, err
		}
	}
	if _, err := db.ExecContext(ctx, "INSERT INTO dsh.catalog_modifier_options(id,group_id,name_ar,price_delta_minor,availability,ordinal) VALUES($1,$2,$3,$4,$5,$6)", input.ID, input.GroupID, input.NameAr, input.PriceDeltaMinor, input.Availability, input.Ordinal); err != nil {
		return CatalogModifierOptionRecord{}, err
	}
	var item CatalogModifierOptionRecord
	err := db.QueryRowContext(ctx, "SELECT id,group_id,name_ar,price_delta_minor,availability,ordinal,version FROM dsh.catalog_modifier_options WHERE id=$1", input.ID).Scan(&item.ID, &item.GroupID, &item.NameAr, &item.PriceDeltaMinor, &item.Availability, &item.Ordinal, &item.Version)
	return item, err
}

func AttachCatalogModifierGroup(ctx context.Context, db *sql.DB, offerID, groupID string, ordinal int) error {
	var offerStore, groupStore string
	if err := db.QueryRowContext(ctx, "SELECT store_id FROM dsh.catalog_store_offers WHERE id=$1", offerID).Scan(&offerStore); err != nil {
		return err
	}
	if err := db.QueryRowContext(ctx, "SELECT store_id FROM dsh.catalog_modifier_groups WHERE id=$1", groupID).Scan(&groupStore); err != nil {
		return err
	}
	if offerStore != groupStore {
		return ErrCatalogProductOwnership
	}
	var localCatalog bool
	if err := db.QueryRowContext(ctx, `SELECT EXISTS (
		SELECT 1 FROM dsh.stores s JOIN dsh.commerce_verticals cv ON cv.id=s.primary_vertical_id
		WHERE s.id=$1 AND cv.active=true AND cv.catalog_model='STORE_LOCAL_CATALOG'
	)`, offerStore).Scan(&localCatalog); err != nil {
		return err
	}
	if !localCatalog {
		return ErrCatalogProductModelMismatch
	}
	_, err := db.ExecContext(ctx, "INSERT INTO dsh.catalog_store_offer_modifier_groups(offer_id,group_id,ordinal) VALUES($1,$2,$3) ON CONFLICT(offer_id,group_id) DO UPDATE SET ordinal=EXCLUDED.ordinal", offerID, groupID, ordinal)
	return err
}

func CreateCatalogStorefrontSection(ctx context.Context, db *sql.DB, input CatalogStorefrontSectionInput) (CatalogStorefrontSectionRecord, error) {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return CatalogStorefrontSectionRecord{}, err
	}
	defer func() { _ = tx.Rollback() }()
	var catalogModel string
	if err = tx.QueryRowContext(ctx, `SELECT COALESCE(cv.catalog_model,'') FROM dsh.stores s JOIN dsh.commerce_verticals cv ON cv.id=s.primary_vertical_id WHERE s.id=$1 FOR SHARE OF cv`, input.StoreID).Scan(&catalogModel); errors.Is(err, sql.ErrNoRows) {
		return CatalogStorefrontSectionRecord{}, ErrCatalogOfferStoreNotFound
	} else if err != nil {
		return CatalogStorefrontSectionRecord{}, err
	}
	if catalogModel != "STORE_LOCAL_CATALOG" {
		return CatalogStorefrontSectionRecord{}, ErrCatalogProductModelMismatch
	}
	if input.ID == "" {
		input.ID, err = newID("section")
		if err != nil {
			return CatalogStorefrontSectionRecord{}, err
		}
	}
	if _, err = tx.ExecContext(ctx, "INSERT INTO dsh.catalog_storefront_sections(id,store_id,name_ar,name_en,ordinal,active) VALUES($1,$2,$3,$4,$5,$6)", input.ID, input.StoreID, input.NameAr, input.NameEn, input.Ordinal, input.Active); err != nil {
		return CatalogStorefrontSectionRecord{}, err
	}
	items, err := listStorefrontSections(ctx, tx, input.StoreID)
	if err != nil {
		return CatalogStorefrontSectionRecord{}, err
	}
	for _, item := range items {
		if item.ID == input.ID {
			if err = tx.Commit(); err != nil {
				return CatalogStorefrontSectionRecord{}, err
			}
			return item, nil
		}
	}
	return CatalogStorefrontSectionRecord{}, ErrCatalogCategoryNotFound
}

func AttachOfferToCatalogStorefrontSection(ctx context.Context, db *sql.DB, sectionID, offerID string, ordinal int) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	var sectionStore, catalogModel, offerStore, productScope string
	if err := tx.QueryRowContext(ctx, `SELECT ss.store_id,COALESCE(cv.catalog_model,'') FROM dsh.catalog_storefront_sections ss JOIN dsh.stores s ON s.id=ss.store_id JOIN dsh.commerce_verticals cv ON cv.id=s.primary_vertical_id WHERE ss.id=$1 FOR SHARE OF cv`, sectionID).Scan(&sectionStore, &catalogModel); err != nil {
		return err
	}
	if err := tx.QueryRowContext(ctx, "SELECT o.store_id,p.scope FROM dsh.catalog_store_offers o JOIN dsh.catalog_product_variants v ON v.id=o.variant_id JOIN dsh.catalog_products p ON p.id=v.product_id WHERE o.id=$1", offerID).Scan(&offerStore, &productScope); err != nil {
		return err
	}
	if catalogModel != "STORE_LOCAL_CATALOG" || sectionStore != offerStore || productScope != "STORE_SCOPED" {
		return ErrCatalogProductOwnership
	}
	if _, err = tx.ExecContext(ctx, "INSERT INTO dsh.catalog_storefront_section_offers(section_id,offer_id,ordinal) VALUES($1,$2,$3) ON CONFLICT(section_id,offer_id) DO UPDATE SET ordinal=EXCLUDED.ordinal", sectionID, offerID, ordinal); err != nil {
		return err
	}
	return tx.Commit()
}

func listModifierGroupsByID(ctx context.Context, db queryer, groupID string) ([]CatalogModifierGroupRecord, error) {
	rows, err := db.QueryContext(ctx, "SELECT id,store_id,name_ar,required,min_selections,max_selections,active,version FROM dsh.catalog_modifier_groups WHERE id=$1", groupID)
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
