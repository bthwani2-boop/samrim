-- Catalog semantic correction.  Migrations 010 and 011 are immutable history;
-- this migration is the single current cutover for ownership, quantity,
-- attributes, proposals, sections, modifiers, and transaction snapshots.

ALTER TABLE dsh.catalog_products
    ADD COLUMN store_id text;
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM dsh.catalog_products WHERE scope = 'STORE_SCOPED' AND store_id IS NULL) THEN
        RAISE EXCEPTION 'catalog Product ownership is ambiguous; Store-scoped rows require an owner Store before v12';
    END IF;
END $$;
ALTER TABLE dsh.catalog_products
    ADD CONSTRAINT catalog_products_store_fk FOREIGN KEY (store_id) REFERENCES dsh.stores(id) ON DELETE RESTRICT,
    ADD CONSTRAINT catalog_products_scope_store_chk CHECK ((scope = 'SHARED' AND store_id IS NULL) OR (scope = 'STORE_SCOPED' AND store_id IS NOT NULL));
CREATE INDEX catalog_products_store_idx ON dsh.catalog_products(store_id, active, lower(canonical_name), id);

ALTER TABLE dsh.catalog_product_variants
    ADD COLUMN measurement_kind text,
    ADD COLUMN base_unit text;
UPDATE dsh.catalog_product_variants
SET measurement_kind = CASE WHEN sell_unit = 'piece' THEN 'DISCRETE' ELSE 'MEASURED' END,
    base_unit = CASE WHEN sell_unit = 'piece' THEN 'COUNT' ELSE 'GRAM' END;
ALTER TABLE dsh.catalog_product_variants
    ALTER COLUMN measurement_kind SET NOT NULL,
    ALTER COLUMN base_unit SET NOT NULL,
    DROP CONSTRAINT catalog_product_variants_sell_unit_chk,
    ADD CONSTRAINT catalog_product_variants_measurement_kind_chk CHECK (measurement_kind IN ('DISCRETE', 'MEASURED', 'VARIABLE_MEASURE')),
    ADD CONSTRAINT catalog_product_variants_base_unit_chk CHECK (base_unit IN ('COUNT', 'GRAM', 'MILLILITER')),
    ADD CONSTRAINT catalog_product_variants_measurement_identity_chk CHECK ((measurement_kind = 'DISCRETE' AND base_unit = 'COUNT') OR (measurement_kind IN ('MEASURED', 'VARIABLE_MEASURE') AND base_unit <> 'COUNT'));
ALTER TABLE dsh.catalog_product_variants DROP COLUMN sell_unit;

ALTER TABLE dsh.catalog_store_offers
    ADD COLUMN quantity_min_base_units bigint,
    ADD COLUMN quantity_max_base_units bigint,
    ADD COLUMN quantity_step_base_units bigint,
    ADD COLUMN pricing_unit_base_units bigint;
UPDATE dsh.catalog_store_offers
SET pricing_basis = CASE WHEN pricing_basis = 'PER_KILOGRAM' THEN 'PER_MEASURE' ELSE pricing_basis END,
    pricing_unit_base_units = CASE WHEN pricing_basis = 'PER_KILOGRAM' THEN 1000 ELSE 1 END,
    publication_state = CASE WHEN pricing_basis = 'PER_KILOGRAM' THEN 'hidden' ELSE publication_state END,
    availability = CASE WHEN pricing_basis = 'PER_KILOGRAM' THEN false ELSE availability END;
ALTER TABLE dsh.catalog_store_offers
    ALTER COLUMN pricing_unit_base_units SET NOT NULL,
    DROP CONSTRAINT catalog_store_offers_quantity_policy_chk,
    DROP CONSTRAINT catalog_store_offers_pricing_basis_chk,
    ADD CONSTRAINT catalog_store_offers_quantity_policy_chk CHECK (quantity_policy IN ('DISCRETE', 'MEASURED', 'VARIABLE_MEASURE')),
    ADD CONSTRAINT catalog_store_offers_pricing_basis_chk CHECK (pricing_basis IN ('PER_UNIT', 'PER_MEASURE')),
    ADD CONSTRAINT catalog_store_offers_pricing_unit_chk CHECK (pricing_unit_base_units > 0),
    ADD CONSTRAINT catalog_store_offers_quantity_policy_bounds_chk CHECK ((quantity_min_base_units IS NULL AND quantity_max_base_units IS NULL AND quantity_step_base_units IS NULL) OR (quantity_min_base_units > 0 AND quantity_max_base_units >= quantity_min_base_units AND quantity_step_base_units > 0 AND (quantity_max_base_units - quantity_min_base_units) % quantity_step_base_units = 0));
CREATE INDEX catalog_store_offers_quantity_idx ON dsh.catalog_store_offers(store_id, quantity_policy, quantity_min_base_units, quantity_max_base_units, quantity_step_base_units);

ALTER TABLE dsh.catalog_attribute_definitions
    DROP CONSTRAINT catalog_attribute_definitions_kind_chk,
    ADD CONSTRAINT catalog_attribute_definitions_kind_chk CHECK (value_kind IN ('TEXT', 'INTEGER', 'DECIMAL', 'BOOLEAN', 'ENUM', 'MEASUREMENT', 'DATE'));
ALTER TABLE dsh.catalog_product_attribute_values
    RENAME COLUMN unit TO measurement_unit;
ALTER TABLE dsh.catalog_product_attribute_values
    ADD COLUMN enum_value text,
    ADD COLUMN date_value date;
ALTER TABLE dsh.catalog_product_attribute_values
    DROP CONSTRAINT catalog_product_attribute_values_one_value_chk,
    ADD CONSTRAINT catalog_product_attribute_values_one_value_chk CHECK (((text_value IS NOT NULL)::integer + (integer_value IS NOT NULL)::integer + (decimal_value IS NOT NULL)::integer + (boolean_value IS NOT NULL)::integer + (enum_value IS NOT NULL)::integer + (date_value IS NOT NULL)::integer) = 1);

CREATE TABLE dsh.catalog_attribute_enum_options (
    attribute_id text NOT NULL,
    option_value text NOT NULL,
    active boolean NOT NULL DEFAULT true,
    ordinal integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (attribute_id, option_value),
    CONSTRAINT catalog_attribute_enum_options_attribute_fk FOREIGN KEY (attribute_id) REFERENCES dsh.catalog_attribute_definitions(id) ON DELETE RESTRICT,
    CONSTRAINT catalog_attribute_enum_options_value_chk CHECK (char_length(btrim(option_value)) BETWEEN 1 AND 160),
    CONSTRAINT catalog_attribute_enum_options_ordinal_chk CHECK (ordinal BETWEEN 0 AND 100)
);
CREATE INDEX catalog_attribute_enum_options_active_idx ON dsh.catalog_attribute_enum_options(attribute_id, active, ordinal, option_value);

CREATE TABLE dsh.catalog_category_attribute_rules (
    category_id text NOT NULL,
    attribute_id text NOT NULL,
    required boolean NOT NULL DEFAULT false,
    filterable boolean NOT NULL DEFAULT false,
    variant_axis boolean NOT NULL DEFAULT false,
    version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (category_id, attribute_id),
    CONSTRAINT catalog_category_attribute_rules_category_fk FOREIGN KEY (category_id) REFERENCES dsh.catalog_categories(id) ON DELETE RESTRICT,
    CONSTRAINT catalog_category_attribute_rules_attribute_fk FOREIGN KEY (attribute_id) REFERENCES dsh.catalog_attribute_definitions(id) ON DELETE RESTRICT,
    CONSTRAINT catalog_category_attribute_rules_version_chk CHECK (version > 0)
);
CREATE INDEX catalog_category_attribute_rules_attribute_idx ON dsh.catalog_category_attribute_rules(attribute_id, required, variant_axis, category_id);

CREATE TABLE dsh.catalog_variant_attribute_values (
    variant_id text NOT NULL,
    attribute_id text NOT NULL,
    text_value text,
    integer_value bigint,
    decimal_value numeric(24, 6),
    boolean_value boolean,
    enum_value text,
    date_value date,
    measurement_unit text,
    PRIMARY KEY (variant_id, attribute_id),
    CONSTRAINT catalog_variant_attribute_values_variant_fk FOREIGN KEY (variant_id) REFERENCES dsh.catalog_product_variants(id) ON DELETE RESTRICT,
    CONSTRAINT catalog_variant_attribute_values_attribute_fk FOREIGN KEY (attribute_id) REFERENCES dsh.catalog_attribute_definitions(id) ON DELETE RESTRICT,
    CONSTRAINT catalog_variant_attribute_values_one_value_chk CHECK (((text_value IS NOT NULL)::integer + (integer_value IS NOT NULL)::integer + (decimal_value IS NOT NULL)::integer + (boolean_value IS NOT NULL)::integer + (enum_value IS NOT NULL)::integer + (date_value IS NOT NULL)::integer) = 1)
);
CREATE INDEX catalog_variant_attribute_values_attribute_idx ON dsh.catalog_variant_attribute_values(attribute_id, variant_id);

ALTER TABLE dsh.catalog_product_proposals
    DROP CONSTRAINT catalog_product_proposals_sell_unit_chk,
    DROP COLUMN proposed_sell_unit,
    ADD COLUMN proposed_variant_title text NOT NULL DEFAULT 'الافتراضي',
    ADD COLUMN proposed_measurement_kind text NOT NULL DEFAULT 'DISCRETE',
    ADD COLUMN proposed_base_unit text NOT NULL DEFAULT 'COUNT';
ALTER TABLE dsh.catalog_product_proposals
    ADD CONSTRAINT catalog_product_proposals_variant_title_chk CHECK (char_length(btrim(proposed_variant_title)) BETWEEN 1 AND 160),
    ADD CONSTRAINT catalog_product_proposals_measurement_kind_chk CHECK (proposed_measurement_kind IN ('DISCRETE', 'MEASURED', 'VARIABLE_MEASURE')),
    ADD CONSTRAINT catalog_product_proposals_base_unit_chk CHECK (proposed_base_unit IN ('COUNT', 'GRAM', 'MILLILITER')),
    ADD CONSTRAINT catalog_product_proposals_measurement_identity_chk CHECK ((proposed_measurement_kind = 'DISCRETE' AND proposed_base_unit = 'COUNT') OR (proposed_measurement_kind IN ('MEASURED', 'VARIABLE_MEASURE') AND proposed_base_unit <> 'COUNT'));

CREATE TABLE dsh.catalog_product_proposal_idempotency (
    idempotency_key text PRIMARY KEY,
    request_hash text NOT NULL,
    proposal_id text NOT NULL,
    operation text NOT NULL,
    result_version integer NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT catalog_product_proposal_idempotency_operation_chk CHECK (operation IN ('create', 'submit', 'review')),
    CONSTRAINT catalog_product_proposal_idempotency_version_chk CHECK (result_version > 0),
    CONSTRAINT catalog_product_proposal_idempotency_proposal_fk FOREIGN KEY (proposal_id) REFERENCES dsh.catalog_product_proposals(id) ON DELETE RESTRICT
);
CREATE INDEX catalog_product_proposal_idempotency_proposal_idx ON dsh.catalog_product_proposal_idempotency(proposal_id, created_at DESC);

CREATE TABLE dsh.catalog_product_proposal_audit (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_type text NOT NULL,
    idempotency_key text NOT NULL,
    correlation_id text NOT NULL,
    acting_actor_id text NOT NULL,
    proposal_id text NOT NULL,
    from_state text,
    to_state text NOT NULL,
    result_version integer NOT NULL,
    request_hash text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT catalog_product_proposal_audit_event_type_chk CHECK (event_type IN ('proposal_created', 'proposal_submitted', 'proposal_reviewed')),
    CONSTRAINT catalog_product_proposal_audit_event_idempotency_uq UNIQUE (event_type, idempotency_key),
    CONSTRAINT catalog_product_proposal_audit_proposal_fk FOREIGN KEY (proposal_id) REFERENCES dsh.catalog_product_proposals(id) ON DELETE RESTRICT,
    CONSTRAINT catalog_product_proposal_audit_version_chk CHECK (result_version > 0)
);
CREATE INDEX catalog_product_proposal_audit_proposal_idx ON dsh.catalog_product_proposal_audit(proposal_id, created_at DESC);

CREATE TABLE dsh.catalog_storefront_sections (
    id text PRIMARY KEY,
    store_id text NOT NULL,
    name_ar text NOT NULL,
    name_en text,
    ordinal integer NOT NULL DEFAULT 0,
    active boolean NOT NULL DEFAULT true,
    version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT catalog_storefront_sections_store_fk FOREIGN KEY (store_id) REFERENCES dsh.stores(id) ON DELETE RESTRICT,
    CONSTRAINT catalog_storefront_sections_name_chk CHECK (char_length(btrim(name_ar)) BETWEEN 1 AND 160),
    CONSTRAINT catalog_storefront_sections_name_en_chk CHECK (name_en IS NULL OR char_length(btrim(name_en)) BETWEEN 1 AND 160),
    CONSTRAINT catalog_storefront_sections_ordinal_chk CHECK (ordinal BETWEEN 0 AND 1000),
    CONSTRAINT catalog_storefront_sections_version_chk CHECK (version > 0),
    CONSTRAINT catalog_storefront_sections_store_name_uq UNIQUE (store_id, name_ar)
);
CREATE INDEX catalog_storefront_sections_store_idx ON dsh.catalog_storefront_sections(store_id, active, ordinal, id);

CREATE TABLE dsh.catalog_storefront_section_offers (
    section_id text NOT NULL,
    offer_id text NOT NULL,
    ordinal integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (section_id, offer_id),
    CONSTRAINT catalog_storefront_section_offers_section_fk FOREIGN KEY (section_id) REFERENCES dsh.catalog_storefront_sections(id) ON DELETE RESTRICT,
    CONSTRAINT catalog_storefront_section_offers_offer_fk FOREIGN KEY (offer_id) REFERENCES dsh.catalog_store_offers(id) ON DELETE RESTRICT,
    CONSTRAINT catalog_storefront_section_offers_ordinal_chk CHECK (ordinal BETWEEN 0 AND 1000)
);
CREATE INDEX catalog_storefront_section_offers_offer_idx ON dsh.catalog_storefront_section_offers(offer_id, section_id);

CREATE TABLE dsh.catalog_modifier_groups (
    id text PRIMARY KEY,
    store_id text NOT NULL,
    name_ar text NOT NULL,
    required boolean NOT NULL DEFAULT false,
    min_selections integer NOT NULL DEFAULT 0,
    max_selections integer NOT NULL DEFAULT 1,
    active boolean NOT NULL DEFAULT true,
    version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT catalog_modifier_groups_store_fk FOREIGN KEY (store_id) REFERENCES dsh.stores(id) ON DELETE RESTRICT,
    CONSTRAINT catalog_modifier_groups_name_chk CHECK (char_length(btrim(name_ar)) BETWEEN 1 AND 160),
    CONSTRAINT catalog_modifier_groups_selection_chk CHECK (min_selections >= 0 AND max_selections >= min_selections AND max_selections <= 100 AND ((required AND min_selections > 0) OR NOT required)),
    CONSTRAINT catalog_modifier_groups_version_chk CHECK (version > 0)
);
CREATE INDEX catalog_modifier_groups_store_idx ON dsh.catalog_modifier_groups(store_id, active, id);

CREATE TABLE dsh.catalog_modifier_options (
    id text PRIMARY KEY,
    group_id text NOT NULL,
    name_ar text NOT NULL,
    price_delta_minor bigint NOT NULL DEFAULT 0,
    availability boolean NOT NULL DEFAULT true,
    ordinal integer NOT NULL DEFAULT 0,
    version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT catalog_modifier_options_group_fk FOREIGN KEY (group_id) REFERENCES dsh.catalog_modifier_groups(id) ON DELETE RESTRICT,
    CONSTRAINT catalog_modifier_options_name_chk CHECK (char_length(btrim(name_ar)) BETWEEN 1 AND 160),
    CONSTRAINT catalog_modifier_options_price_chk CHECK (price_delta_minor >= 0),
    CONSTRAINT catalog_modifier_options_ordinal_chk CHECK (ordinal BETWEEN 0 AND 1000),
    CONSTRAINT catalog_modifier_options_version_chk CHECK (version > 0)
);
CREATE INDEX catalog_modifier_options_group_idx ON dsh.catalog_modifier_options(group_id, availability, ordinal, id);

CREATE TABLE dsh.catalog_store_offer_modifier_groups (
    offer_id text NOT NULL,
    group_id text NOT NULL,
    ordinal integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (offer_id, group_id),
    CONSTRAINT catalog_store_offer_modifier_groups_offer_fk FOREIGN KEY (offer_id) REFERENCES dsh.catalog_store_offers(id) ON DELETE RESTRICT,
    CONSTRAINT catalog_store_offer_modifier_groups_group_fk FOREIGN KEY (group_id) REFERENCES dsh.catalog_modifier_groups(id) ON DELETE RESTRICT,
    CONSTRAINT catalog_store_offer_modifier_groups_ordinal_chk CHECK (ordinal BETWEEN 0 AND 1000)
);
CREATE INDEX catalog_store_offer_modifier_groups_group_idx ON dsh.catalog_store_offer_modifier_groups(group_id, offer_id);

ALTER TABLE dsh.commerce_cart_lines
    DROP CONSTRAINT commerce_cart_lines_modifiers_chk;
CREATE INDEX commerce_cart_lines_modifier_idx ON dsh.commerce_cart_lines USING GIN (selected_modifier_option_ids);

ALTER TABLE dsh.commerce_order_lines
    ADD COLUMN final_quantity_base_units bigint,
    ADD COLUMN modifier_amount_minor bigint NOT NULL DEFAULT 0,
    ADD COLUMN measurement_kind text,
    ADD COLUMN base_unit text,
    ADD COLUMN quantity_policy text,
    ADD COLUMN quantity_min_base_units bigint,
    ADD COLUMN quantity_max_base_units bigint,
    ADD COLUMN quantity_step_base_units bigint,
    ADD COLUMN pricing_unit_base_units bigint;
UPDATE dsh.commerce_order_lines l
SET measurement_kind = v.measurement_kind,
    base_unit = v.base_unit,
    quantity_policy = o.quantity_policy,
    quantity_min_base_units = o.quantity_min_base_units,
    quantity_max_base_units = o.quantity_max_base_units,
    quantity_step_base_units = o.quantity_step_base_units,
    pricing_unit_base_units = o.pricing_unit_base_units
FROM dsh.catalog_product_variants v
JOIN dsh.catalog_store_offers o ON o.variant_id = v.id
WHERE l.variant_id = v.id AND l.store_offer_id = o.id;
ALTER TABLE dsh.commerce_order_lines
    ALTER COLUMN measurement_kind SET NOT NULL,
    ALTER COLUMN base_unit SET NOT NULL,
    ALTER COLUMN quantity_policy SET NOT NULL,
    ALTER COLUMN quantity_min_base_units SET NOT NULL,
    ALTER COLUMN quantity_max_base_units SET NOT NULL,
    ALTER COLUMN quantity_step_base_units SET NOT NULL,
    ALTER COLUMN pricing_unit_base_units SET NOT NULL,
    DROP CONSTRAINT commerce_order_lines_unit_chk,
    DROP CONSTRAINT commerce_order_lines_pricing_chk,
    DROP CONSTRAINT commerce_order_lines_modifiers_chk,
    DROP COLUMN sell_unit,
    ADD CONSTRAINT commerce_order_lines_final_quantity_chk CHECK (final_quantity_base_units IS NULL OR final_quantity_base_units > 0),
    ADD CONSTRAINT commerce_order_lines_modifier_amount_chk CHECK (modifier_amount_minor >= 0),
    ADD CONSTRAINT commerce_order_lines_pricing_chk CHECK (pricing_basis IN ('PER_UNIT', 'PER_MEASURE'));
CREATE TABLE dsh.commerce_order_line_modifier_snapshots (
    order_line_id text NOT NULL,
    option_id text NOT NULL,
    option_name_ar text NOT NULL,
    price_delta_minor bigint NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (order_line_id, option_id),
    CONSTRAINT commerce_order_line_modifier_snapshots_line_fk FOREIGN KEY (order_line_id) REFERENCES dsh.commerce_order_lines(id) ON DELETE RESTRICT,
    CONSTRAINT commerce_order_line_modifier_snapshots_name_chk CHECK (char_length(btrim(option_name_ar)) BETWEEN 1 AND 160),
    CONSTRAINT commerce_order_line_modifier_snapshots_price_chk CHECK (price_delta_minor >= 0)
);
CREATE INDEX commerce_order_line_modifier_snapshots_option_idx ON dsh.commerce_order_line_modifier_snapshots(option_id, order_line_id);

CREATE TABLE dsh.commerce_order_line_attribute_snapshots (
    order_line_id text NOT NULL,
    attribute_id text NOT NULL,
    attribute_code text NOT NULL,
    value_kind text NOT NULL,
    text_value text,
    integer_value bigint,
    decimal_value numeric(24, 6),
    boolean_value boolean,
    enum_value text,
    date_value date,
    measurement_unit text,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (order_line_id, attribute_id),
    CONSTRAINT commerce_order_line_attribute_snapshots_line_fk FOREIGN KEY (order_line_id) REFERENCES dsh.commerce_order_lines(id) ON DELETE RESTRICT,
    CONSTRAINT commerce_order_line_attribute_snapshots_kind_chk CHECK (value_kind IN ('TEXT', 'INTEGER', 'DECIMAL', 'BOOLEAN', 'ENUM', 'MEASUREMENT', 'DATE')),
    CONSTRAINT commerce_order_line_attribute_snapshots_one_value_chk CHECK (((text_value IS NOT NULL)::integer + (integer_value IS NOT NULL)::integer + (decimal_value IS NOT NULL)::integer + (boolean_value IS NOT NULL)::integer + (enum_value IS NOT NULL)::integer + (date_value IS NOT NULL)::integer) = 1)
);
CREATE INDEX commerce_order_line_attribute_snapshots_attribute_idx ON dsh.commerce_order_line_attribute_snapshots(attribute_id, order_line_id);

COMMENT ON TABLE dsh.catalog_products IS 'Canonical Product family identity; store_id is mandatory only for STORE_SCOPED products.';
COMMENT ON TABLE dsh.catalog_store_offers IS 'Canonical StoreOffer commercial truth; NULL quantity bounds are legacy closed records only.';
COMMENT ON TABLE dsh.commerce_order_line_modifier_snapshots IS 'Immutable transaction evidence; never a live modifier authority.';
