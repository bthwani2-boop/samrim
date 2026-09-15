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
	if ownerColumn == "product_id" {
		var ownerVertical string
		if err := db.QueryRowContext(ctx, "SELECT vertical_id FROM dsh.catalog_products WHERE id=$1", ownerID).Scan(&ownerVertical); err != nil {
			return err
		}
		if ownerVertical != verticalID {
			return ErrCatalogCategoryNotFound
		}
	} else {
		var ownerVertical string
		if err := db.QueryRowContext(ctx, "SELECT p.vertical_id FROM dsh.catalog_product_variants v JOIN dsh.catalog_products p ON p.id=v.product_id WHERE v.id=$1", ownerID).Scan(&ownerVertical); err != nil {
			return err
		}
		if ownerVertical != verticalID {
			return ErrCatalogCategoryNotFound
		}
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

func upsertAttributeValue(ctx context.Context, db *sql.DB, table, ownerColumn, ownerID string, input CatalogAttributeValueInput) error {
	if strings.TrimSpace(input.AttributeID) == "" || strings.TrimSpace(ownerID) == "" {
		return ErrCatalogCategoryNotFound
	}
	if err := validateAttributeValue(ctx, db, ownerColumn, ownerID, input); err != nil {
		return err
	}
	_, err := db.ExecContext(ctx, fmt.Sprintf(`INSERT INTO dsh.%s(%s,attribute_id,text_value,integer_value,decimal_value,boolean_value,enum_value,date_value,measurement_unit) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (%s,attribute_id) DO UPDATE SET text_value=EXCLUDED.text_value,integer_value=EXCLUDED.integer_value,decimal_value=EXCLUDED.decimal_value,boolean_value=EXCLUDED.boolean_value,enum_value=EXCLUDED.enum_value,date_value=EXCLUDED.date_value,measurement_unit=EXCLUDED.measurement_unit`, table, ownerColumn, ownerColumn), ownerID, input.AttributeID, input.TextValue, input.IntegerValue, input.DecimalValue, input.BooleanValue, input.EnumValue, input.DateValue, input.MeasurementUnit)
	return err
}

func UpsertCatalogProductAttributeValue(ctx context.Context, db *sql.DB, productID string, input CatalogAttributeValueInput) error {
	return upsertAttributeValue(ctx, db, "catalog_product_attribute_values", "product_id", productID, input)
}
func UpsertCatalogVariantAttributeValue(ctx context.Context, db *sql.DB, variantID string, input CatalogAttributeValueInput) error {
	return upsertAttributeValue(ctx, db, "catalog_variant_attribute_values", "variant_id", variantID, input)
}

func UpsertCatalogCategoryAttributeRule(ctx context.Context, db *sql.DB, rule CatalogAttributeRuleRecord) error {
	if strings.TrimSpace(rule.CategoryID) == "" || strings.TrimSpace(rule.AttributeID) == "" {
		return ErrCatalogCategoryNotFound
	}
	var categoryVertical, attributeVertical string
	if err := db.QueryRowContext(ctx, "SELECT vertical_id FROM dsh.catalog_categories WHERE id=$1 AND active=true", rule.CategoryID).Scan(&categoryVertical); err != nil {
		return err
	}
	if err := db.QueryRowContext(ctx, "SELECT vertical_id FROM dsh.catalog_attribute_definitions WHERE id=$1 AND active=true", rule.AttributeID).Scan(&attributeVertical); err != nil {
		return err
	}
	if categoryVertical != attributeVertical {
		return ErrCatalogCategoryNotFound
	}
	_, err := db.ExecContext(ctx, `INSERT INTO dsh.catalog_category_attribute_rules(category_id,attribute_id,required,filterable,variant_axis,version) VALUES($1,$2,$3,$4,$5,1) ON CONFLICT(category_id,attribute_id) DO UPDATE SET required=EXCLUDED.required,filterable=EXCLUDED.filterable,variant_axis=EXCLUDED.variant_axis,version=dsh.catalog_category_attribute_rules.version+1,updated_at=clock_timestamp()`, rule.CategoryID, rule.AttributeID, rule.Required, rule.Filterable, rule.VariantAxis)
	return err
}

func CreateCatalogModifierGroup(ctx context.Context, db *sql.DB, input CatalogModifierGroupInput) (CatalogModifierGroupRecord, error) {
	if input.ID == "" {
		var err error
		input.ID, err = newID("modifier-group")
		if err != nil {
			return CatalogModifierGroupRecord{}, err
		}
	}
	if _, err := db.ExecContext(ctx, "INSERT INTO dsh.catalog_modifier_groups(id,store_id,name_ar,required,min_selections,max_selections,active) VALUES($1,$2,$3,$4,$5,$6,$7)", input.ID, input.StoreID, input.NameAr, input.Required, input.MinSelections, input.MaxSelections, input.Active); err != nil {
		return CatalogModifierGroupRecord{}, err
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
	_, err := db.ExecContext(ctx, "INSERT INTO dsh.catalog_store_offer_modifier_groups(offer_id,group_id,ordinal) VALUES($1,$2,$3) ON CONFLICT(offer_id,group_id) DO UPDATE SET ordinal=EXCLUDED.ordinal", offerID, groupID, ordinal)
	return err
}

func CreateCatalogStorefrontSection(ctx context.Context, db *sql.DB, input CatalogStorefrontSectionInput) (CatalogStorefrontSectionRecord, error) {
	if input.ID == "" {
		var err error
		input.ID, err = newID("section")
		if err != nil {
			return CatalogStorefrontSectionRecord{}, err
		}
	}
	if _, err := db.ExecContext(ctx, "INSERT INTO dsh.catalog_storefront_sections(id,store_id,name_ar,name_en,ordinal,active) VALUES($1,$2,$3,$4,$5,$6)", input.ID, input.StoreID, input.NameAr, input.NameEn, input.Ordinal, input.Active); err != nil {
		return CatalogStorefrontSectionRecord{}, err
	}
	items, err := listStorefrontSections(ctx, db, input.StoreID)
	if err != nil {
		return CatalogStorefrontSectionRecord{}, err
	}
	for _, item := range items {
		if item.ID == input.ID {
			return item, nil
		}
	}
	return CatalogStorefrontSectionRecord{}, ErrCatalogCategoryNotFound
}

func AttachOfferToCatalogStorefrontSection(ctx context.Context, db *sql.DB, sectionID, offerID string, ordinal int) error {
	var sectionStore, offerStore string
	if err := db.QueryRowContext(ctx, "SELECT store_id FROM dsh.catalog_storefront_sections WHERE id=$1", sectionID).Scan(&sectionStore); err != nil {
		return err
	}
	if err := db.QueryRowContext(ctx, "SELECT store_id FROM dsh.catalog_store_offers WHERE id=$1", offerID).Scan(&offerStore); err != nil {
		return err
	}
	if sectionStore != offerStore {
		return ErrCatalogProductOwnership
	}
	_, err := db.ExecContext(ctx, "INSERT INTO dsh.catalog_storefront_section_offers(section_id,offer_id,ordinal) VALUES($1,$2,$3) ON CONFLICT(section_id,offer_id) DO UPDATE SET ordinal=EXCLUDED.ordinal", sectionID, offerID, ordinal)
	return err
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
