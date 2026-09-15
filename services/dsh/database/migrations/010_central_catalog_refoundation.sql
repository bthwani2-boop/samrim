-- Central Catalog refoundation.  This is a data-preserving cutover from the
-- legacy central_products/store_assortments pair to Product/Variant/StoreOffer.
-- Legacy rows without an admitted vertical/category remain readable to
-- operators but are deliberately ineligible for customer publication.

CREATE TABLE dsh.commerce_verticals (
    id text PRIMARY KEY,
    name_ar text NOT NULL,
    name_en text NOT NULL,
    active boolean NOT NULL DEFAULT true,
    version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT commerce_verticals_id_chk CHECK (id ~ '^[a-z0-9][a-z0-9_-]{1,127}$'),
    CONSTRAINT commerce_verticals_name_ar_chk CHECK (char_length(btrim(name_ar)) BETWEEN 2 AND 160),
    CONSTRAINT commerce_verticals_name_en_chk CHECK (char_length(btrim(name_en)) BETWEEN 2 AND 160),
    CONSTRAINT commerce_verticals_version_chk CHECK (version > 0)
);
CREATE UNIQUE INDEX commerce_verticals_name_en_uq ON dsh.commerce_verticals(lower(btrim(name_en)));
CREATE INDEX commerce_verticals_active_idx ON dsh.commerce_verticals(active, lower(name_en), id);

CREATE TABLE dsh.catalog_categories (
    id text PRIMARY KEY,
    vertical_id text NOT NULL,
    parent_category_id text,
    name_ar text NOT NULL,
    name_en text NOT NULL,
    active boolean NOT NULL DEFAULT true,
    version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT catalog_categories_id_chk CHECK (id ~ '^[a-z0-9][a-z0-9_-]{1,127}$'),
    CONSTRAINT catalog_categories_name_ar_chk CHECK (char_length(btrim(name_ar)) BETWEEN 2 AND 160),
    CONSTRAINT catalog_categories_name_en_chk CHECK (char_length(btrim(name_en)) BETWEEN 2 AND 160),
    CONSTRAINT catalog_categories_version_chk CHECK (version > 0),
    CONSTRAINT catalog_categories_vertical_fk FOREIGN KEY (vertical_id) REFERENCES dsh.commerce_verticals(id) ON DELETE RESTRICT,
    CONSTRAINT catalog_categories_vertical_id_uq UNIQUE (vertical_id, id),
    CONSTRAINT catalog_categories_parent_same_vertical_fk FOREIGN KEY (vertical_id, parent_category_id) REFERENCES dsh.catalog_categories(vertical_id, id) ON DELETE RESTRICT
);
CREATE INDEX catalog_categories_vertical_idx ON dsh.catalog_categories(vertical_id, parent_category_id, lower(name_en), id);

CREATE TABLE dsh.catalog_attribute_definitions (
    id text PRIMARY KEY,
    vertical_id text NOT NULL,
    code text NOT NULL,
    name_ar text NOT NULL,
    value_kind text NOT NULL,
    active boolean NOT NULL DEFAULT true,
    version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT catalog_attribute_definitions_code_chk CHECK (code ~ '^[a-z][a-z0-9_]{1,63}$'),
    CONSTRAINT catalog_attribute_definitions_name_chk CHECK (char_length(btrim(name_ar)) BETWEEN 2 AND 160),
    CONSTRAINT catalog_attribute_definitions_kind_chk CHECK (value_kind IN ('TEXT', 'INTEGER', 'DECIMAL', 'BOOLEAN')),
    CONSTRAINT catalog_attribute_definitions_version_chk CHECK (version > 0),
    CONSTRAINT catalog_attribute_definitions_vertical_fk FOREIGN KEY (vertical_id) REFERENCES dsh.commerce_verticals(id) ON DELETE RESTRICT,
    CONSTRAINT catalog_attribute_definitions_vertical_code_uq UNIQUE (vertical_id, code)
);

CREATE TABLE dsh.catalog_products (
    id text PRIMARY KEY,
    vertical_id text,
    scope text NOT NULL DEFAULT 'SHARED',
    canonical_name text NOT NULL,
    brand text,
    active boolean NOT NULL DEFAULT true,
    version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT catalog_products_name_chk CHECK (char_length(btrim(canonical_name)) BETWEEN 1 AND 160),
    CONSTRAINT catalog_products_scope_chk CHECK (scope IN ('SHARED', 'STORE_SCOPED')),
    CONSTRAINT catalog_products_version_chk CHECK (version > 0),
    CONSTRAINT catalog_products_vertical_fk FOREIGN KEY (vertical_id) REFERENCES dsh.commerce_verticals(id) ON DELETE RESTRICT
);
CREATE INDEX catalog_products_vertical_idx ON dsh.catalog_products(vertical_id, active, lower(canonical_name), id);
CREATE INDEX catalog_products_name_prefix_idx ON dsh.catalog_products(lower(canonical_name) text_pattern_ops, id);

CREATE TABLE dsh.catalog_product_variants (
    id text PRIMARY KEY,
    product_id text NOT NULL,
    title text NOT NULL,
    sell_unit text NOT NULL,
    active boolean NOT NULL DEFAULT true,
    version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT catalog_product_variants_title_chk CHECK (char_length(btrim(title)) BETWEEN 1 AND 160),
    CONSTRAINT catalog_product_variants_sell_unit_chk CHECK (sell_unit IN ('piece', 'kg')),
    CONSTRAINT catalog_product_variants_version_chk CHECK (version > 0),
    CONSTRAINT catalog_product_variants_product_fk FOREIGN KEY (product_id) REFERENCES dsh.catalog_products(id) ON DELETE RESTRICT,
    CONSTRAINT catalog_product_variants_product_title_uq UNIQUE (product_id, title)
);
CREATE INDEX catalog_product_variants_product_idx ON dsh.catalog_product_variants(product_id, active, id);

CREATE TABLE dsh.catalog_variant_identifiers (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    variant_id text NOT NULL,
    identifier_type text NOT NULL,
    identifier_value text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT catalog_variant_identifiers_type_chk CHECK (identifier_type IN ('GTIN', 'EAN', 'UPC', 'SKU', 'LEGACY_BARCODE')),
    CONSTRAINT catalog_variant_identifiers_value_chk CHECK (char_length(btrim(identifier_value)) BETWEEN 1 AND 128),
    CONSTRAINT catalog_variant_identifiers_variant_fk FOREIGN KEY (variant_id) REFERENCES dsh.catalog_product_variants(id) ON DELETE RESTRICT
);
CREATE INDEX catalog_variant_identifiers_variant_idx ON dsh.catalog_variant_identifiers(variant_id, identifier_type);
CREATE UNIQUE INDEX catalog_variant_identifiers_value_uq ON dsh.catalog_variant_identifiers(identifier_type, lower(btrim(identifier_value)));

CREATE TABLE dsh.catalog_product_categories (
    product_id text NOT NULL,
    category_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (product_id, category_id),
    CONSTRAINT catalog_product_categories_product_fk FOREIGN KEY (product_id) REFERENCES dsh.catalog_products(id) ON DELETE RESTRICT,
    CONSTRAINT catalog_product_categories_category_fk FOREIGN KEY (category_id) REFERENCES dsh.catalog_categories(id) ON DELETE RESTRICT
);
CREATE INDEX catalog_product_categories_category_idx ON dsh.catalog_product_categories(category_id, product_id);

CREATE TABLE dsh.catalog_product_attribute_values (
    product_id text NOT NULL,
    attribute_id text NOT NULL,
    text_value text,
    integer_value bigint,
    decimal_value numeric(24, 6),
    boolean_value boolean,
    unit text,
    PRIMARY KEY (product_id, attribute_id),
    CONSTRAINT catalog_product_attribute_values_product_fk FOREIGN KEY (product_id) REFERENCES dsh.catalog_products(id) ON DELETE RESTRICT,
    CONSTRAINT catalog_product_attribute_values_attribute_fk FOREIGN KEY (attribute_id) REFERENCES dsh.catalog_attribute_definitions(id) ON DELETE RESTRICT,
    CONSTRAINT catalog_product_attribute_values_one_value_chk CHECK (((text_value IS NOT NULL)::integer + (integer_value IS NOT NULL)::integer + (decimal_value IS NOT NULL)::integer + (boolean_value IS NOT NULL)::integer) = 1)
);

CREATE TABLE dsh.catalog_media (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    product_id text NOT NULL,
    uri text NOT NULL,
    media_role text NOT NULL DEFAULT 'primary',
    ordinal integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT catalog_media_uri_chk CHECK (uri ~ '^https?://'),
    CONSTRAINT catalog_media_role_chk CHECK (media_role IN ('primary', 'gallery')),
    CONSTRAINT catalog_media_ordinal_chk CHECK (ordinal BETWEEN 0 AND 20),
    CONSTRAINT catalog_media_product_fk FOREIGN KEY (product_id) REFERENCES dsh.catalog_products(id) ON DELETE RESTRICT,
    CONSTRAINT catalog_media_product_ordinal_uq UNIQUE (product_id, ordinal)
);

CREATE TABLE dsh.catalog_store_offers (
    id text PRIMARY KEY,
    store_id text NOT NULL,
    variant_id text NOT NULL,
    price_minor bigint NOT NULL,
    currency text NOT NULL DEFAULT 'YER',
    quantity_policy text NOT NULL,
    pricing_basis text NOT NULL,
    inventory_policy text NOT NULL DEFAULT 'AVAILABILITY_ONLY',
    availability boolean NOT NULL DEFAULT true,
    publication_state text NOT NULL DEFAULT 'draft',
    version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT catalog_store_offers_store_fk FOREIGN KEY (store_id) REFERENCES dsh.stores(id) ON DELETE RESTRICT,
    CONSTRAINT catalog_store_offers_variant_fk FOREIGN KEY (variant_id) REFERENCES dsh.catalog_product_variants(id) ON DELETE RESTRICT,
    CONSTRAINT catalog_store_offers_price_chk CHECK (price_minor > 0),
    CONSTRAINT catalog_store_offers_currency_chk CHECK (currency = 'YER'),
    CONSTRAINT catalog_store_offers_quantity_policy_chk CHECK (quantity_policy IN ('DISCRETE', 'MEASURED')),
    CONSTRAINT catalog_store_offers_pricing_basis_chk CHECK (pricing_basis IN ('PER_UNIT', 'PER_KILOGRAM')),
    CONSTRAINT catalog_store_offers_inventory_policy_chk CHECK (inventory_policy = 'AVAILABILITY_ONLY'),
    CONSTRAINT catalog_store_offers_state_chk CHECK (publication_state IN ('draft', 'published', 'hidden')),
    CONSTRAINT catalog_store_offers_version_chk CHECK (version > 0),
    CONSTRAINT catalog_store_offers_store_variant_uq UNIQUE (store_id, variant_id)
);
CREATE INDEX catalog_store_offers_store_idx ON dsh.catalog_store_offers(store_id, created_at ASC, id);
CREATE INDEX catalog_store_offers_public_idx ON dsh.catalog_store_offers(store_id, publication_state, availability, variant_id);

CREATE TABLE dsh.catalog_store_offer_mutation_idempotency (
    idempotency_key text PRIMARY KEY,
    request_hash text NOT NULL,
    offer_id text NOT NULL,
    operation text NOT NULL,
    result_version integer NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT catalog_store_offer_idempotency_operation_chk CHECK (operation IN ('create', 'update', 'migrated')),
    CONSTRAINT catalog_store_offer_idempotency_version_chk CHECK (result_version > 0),
    CONSTRAINT catalog_store_offer_idempotency_offer_fk FOREIGN KEY (offer_id) REFERENCES dsh.catalog_store_offers(id) ON DELETE RESTRICT
);
CREATE INDEX catalog_store_offer_idempotency_offer_idx ON dsh.catalog_store_offer_mutation_idempotency(offer_id, created_at DESC);

CREATE TABLE dsh.catalog_product_mutation_idempotency (
    idempotency_key text PRIMARY KEY,
    request_hash text NOT NULL,
    product_id text NOT NULL,
    operation text NOT NULL,
    result_version integer NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT catalog_product_idempotency_operation_chk CHECK (operation IN ('create', 'update', 'migrated')),
    CONSTRAINT catalog_product_idempotency_version_chk CHECK (result_version > 0),
    CONSTRAINT catalog_product_idempotency_product_fk FOREIGN KEY (product_id) REFERENCES dsh.catalog_products(id) ON DELETE RESTRICT
);
CREATE INDEX catalog_product_idempotency_product_idx ON dsh.catalog_product_mutation_idempotency(product_id, created_at DESC);

CREATE TABLE dsh.catalog_product_audit (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_type text NOT NULL,
    idempotency_key text NOT NULL,
    correlation_id text NOT NULL,
    acting_actor_id text NOT NULL,
    product_id text NOT NULL,
    from_version integer,
    result_version integer NOT NULL,
    request_hash text NOT NULL,
    canonical_name text NOT NULL,
    brand text,
    vertical_id text,
    scope text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT catalog_product_audit_event_type_chk CHECK (event_type IN ('catalog_product_created', 'catalog_product_updated', 'catalog_product_migrated')),
    CONSTRAINT catalog_product_audit_event_idempotency_uq UNIQUE (event_type, idempotency_key),
    CONSTRAINT catalog_product_audit_product_fk FOREIGN KEY (product_id) REFERENCES dsh.catalog_products(id) ON DELETE RESTRICT,
    CONSTRAINT catalog_product_audit_version_chk CHECK (result_version > 0),
    CONSTRAINT catalog_product_audit_scope_chk CHECK (scope IN ('SHARED', 'STORE_SCOPED'))
);
CREATE INDEX catalog_product_audit_product_idx ON dsh.catalog_product_audit(product_id, created_at DESC);

CREATE TABLE dsh.catalog_store_offer_audit (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_type text NOT NULL,
    idempotency_key text NOT NULL,
    correlation_id text NOT NULL,
    acting_actor_id text NOT NULL,
    offer_id text NOT NULL,
    from_state text,
    to_state text NOT NULL,
    expected_version integer,
    result_version integer NOT NULL,
    request_hash text NOT NULL,
    store_id text NOT NULL,
    variant_id text NOT NULL,
    price_minor bigint NOT NULL,
    currency text NOT NULL,
    availability boolean NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT catalog_store_offer_audit_event_type_chk CHECK (event_type IN ('catalog_store_offer_created', 'catalog_store_offer_updated', 'catalog_store_offer_migrated')),
    CONSTRAINT catalog_store_offer_audit_event_idempotency_uq UNIQUE (event_type, idempotency_key),
    CONSTRAINT catalog_store_offer_audit_offer_fk FOREIGN KEY (offer_id) REFERENCES dsh.catalog_store_offers(id) ON DELETE RESTRICT,
    CONSTRAINT catalog_store_offer_audit_store_fk FOREIGN KEY (store_id) REFERENCES dsh.stores(id) ON DELETE RESTRICT,
    CONSTRAINT catalog_store_offer_audit_variant_fk FOREIGN KEY (variant_id) REFERENCES dsh.catalog_product_variants(id) ON DELETE RESTRICT,
    CONSTRAINT catalog_store_offer_audit_price_chk CHECK (price_minor > 0),
    CONSTRAINT catalog_store_offer_audit_currency_chk CHECK (currency = 'YER'),
    CONSTRAINT catalog_store_offer_audit_version_chk CHECK (result_version > 0)
);
CREATE INDEX catalog_store_offer_audit_store_idx ON dsh.catalog_store_offer_audit(store_id, created_at DESC);

CREATE TABLE dsh.catalog_product_proposals (
    id text PRIMARY KEY,
    partner_actor_id text NOT NULL,
    vertical_id text NOT NULL,
    category_id text NOT NULL,
    proposed_name text NOT NULL,
    proposed_brand text,
    proposed_sell_unit text NOT NULL,
    proposed_identifier_type text,
    proposed_identifier_value text,
    proposed_image_uri text,
    state text NOT NULL DEFAULT 'draft',
    correction_reason text,
    reviewed_by text,
    version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT catalog_product_proposals_name_chk CHECK (char_length(btrim(proposed_name)) BETWEEN 1 AND 160),
    CONSTRAINT catalog_product_proposals_sell_unit_chk CHECK (proposed_sell_unit IN ('piece', 'kg')),
    CONSTRAINT catalog_product_proposals_identifier_type_chk CHECK (proposed_identifier_type IS NULL OR proposed_identifier_type IN ('GTIN', 'EAN', 'UPC', 'SKU')),
    CONSTRAINT catalog_product_proposals_state_chk CHECK (state IN ('draft', 'submitted', 'needs_correction', 'approved', 'rejected')),
    CONSTRAINT catalog_product_proposals_version_chk CHECK (version > 0),
    CONSTRAINT catalog_product_proposals_vertical_fk FOREIGN KEY (vertical_id) REFERENCES dsh.commerce_verticals(id) ON DELETE RESTRICT,
    CONSTRAINT catalog_product_proposals_category_fk FOREIGN KEY (category_id) REFERENCES dsh.catalog_categories(id) ON DELETE RESTRICT
);
CREATE INDEX catalog_product_proposals_partner_idx ON dsh.catalog_product_proposals(partner_actor_id, state, created_at DESC);
CREATE INDEX catalog_product_proposals_review_idx ON dsh.catalog_product_proposals(state, created_at ASC, id);

CREATE TABLE dsh.catalog_import_runs (
    id text PRIMARY KEY,
    acting_actor_id text NOT NULL,
    source_sha256 text NOT NULL,
    mode text NOT NULL,
    state text NOT NULL,
    accepted_count integer NOT NULL DEFAULT 0,
    conflict_count integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT catalog_import_runs_mode_chk CHECK (mode IN ('preview', 'commit')),
    CONSTRAINT catalog_import_runs_state_chk CHECK (state IN ('previewed', 'committed', 'rejected')),
    CONSTRAINT catalog_import_runs_count_chk CHECK (accepted_count >= 0 AND conflict_count >= 0)
);
CREATE UNIQUE INDEX catalog_import_runs_source_mode_uq ON dsh.catalog_import_runs(source_sha256, mode);

CREATE TABLE dsh.catalog_registry_mutation_idempotency (
    idempotency_key text PRIMARY KEY,
    request_hash text NOT NULL,
    entity_type text NOT NULL,
    entity_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT catalog_registry_mutation_entity_chk CHECK (entity_type IN ('vertical', 'category')),
    CONSTRAINT catalog_registry_mutation_entity_key_uq UNIQUE (idempotency_key, request_hash, entity_type, entity_id)
);
CREATE INDEX catalog_registry_mutation_entity_idx ON dsh.catalog_registry_mutation_idempotency(entity_type, entity_id, created_at DESC);

ALTER TABLE dsh.stores
    ADD COLUMN primary_vertical_id text,
    ADD CONSTRAINT stores_primary_vertical_fk FOREIGN KEY (primary_vertical_id) REFERENCES dsh.commerce_verticals(id) ON DELETE RESTRICT;
CREATE INDEX stores_primary_vertical_idx ON dsh.stores(primary_vertical_id, publication_state, id);

ALTER TABLE dsh.joining_cases
    ADD COLUMN first_store_vertical_id text,
    ADD CONSTRAINT joining_cases_first_store_vertical_fk FOREIGN KEY (first_store_vertical_id) REFERENCES dsh.commerce_verticals(id) ON DELETE RESTRICT;
CREATE INDEX joining_cases_first_store_vertical_idx ON dsh.joining_cases(first_store_vertical_id, state, id);

INSERT INTO dsh.catalog_products(id, vertical_id, scope, canonical_name, brand, active, version, created_at, updated_at)
SELECT id, NULL, 'SHARED', canonical_name, brand, active, version, created_at, updated_at
FROM dsh.central_products;

INSERT INTO dsh.catalog_product_variants(id, product_id, title, sell_unit, active, version, created_at, updated_at)
SELECT 'variant_default_' || id, id, 'الافتراضي', sell_unit, active, version, created_at, updated_at
FROM dsh.central_products;

INSERT INTO dsh.catalog_variant_identifiers(variant_id, identifier_type, identifier_value, created_at)
SELECT 'variant_default_' || id, 'LEGACY_BARCODE', barcode, updated_at
FROM dsh.central_products
WHERE barcode IS NOT NULL;

INSERT INTO dsh.catalog_media(product_id, uri, media_role, ordinal, created_at)
SELECT id, canonical_image_url, 'primary', 0, updated_at
FROM dsh.central_products
WHERE canonical_image_url IS NOT NULL;

INSERT INTO dsh.catalog_store_offers(id, store_id, variant_id, price_minor, currency, quantity_policy, pricing_basis, inventory_policy, availability, publication_state, version, created_at, updated_at)
SELECT 'offer_legacy_' || a.store_id || '_' || a.product_id,
       a.store_id,
       'variant_default_' || a.product_id,
       a.price_minor,
       a.currency,
       CASE WHEN p.sell_unit = 'kg' THEN 'MEASURED' ELSE 'DISCRETE' END,
       CASE WHEN p.sell_unit = 'kg' THEN 'PER_KILOGRAM' ELSE 'PER_UNIT' END,
       'AVAILABILITY_ONLY',
       a.availability,
       a.publication_state,
       a.version,
       a.created_at,
       a.updated_at
FROM dsh.store_assortments a
JOIN dsh.central_products p ON p.id = a.product_id;

INSERT INTO dsh.catalog_product_mutation_idempotency(idempotency_key, request_hash, product_id, operation, result_version, created_at)
SELECT idempotency_key, request_hash, product_id, 'migrated', result_version, created_at
FROM dsh.central_product_mutation_idempotency;

INSERT INTO dsh.catalog_product_audit(event_type, idempotency_key, correlation_id, acting_actor_id, product_id, from_version, result_version, request_hash, canonical_name, brand, vertical_id, scope, created_at)
SELECT 'catalog_product_migrated', idempotency_key || ':legacy:' || id::text, correlation_id, acting_actor_id, product_id, from_version, result_version, request_hash, canonical_name, brand, NULL, 'SHARED', created_at
FROM dsh.central_product_audit;

INSERT INTO dsh.catalog_store_offer_mutation_idempotency(idempotency_key, request_hash, offer_id, operation, result_version, created_at)
SELECT i.idempotency_key, i.request_hash, 'offer_legacy_' || i.store_id || '_' || i.product_id, 'migrated', i.result_version, i.created_at
FROM dsh.store_assortment_mutation_idempotency i;

INSERT INTO dsh.catalog_store_offer_audit(event_type, idempotency_key, correlation_id, acting_actor_id, offer_id, from_state, to_state, expected_version, result_version, request_hash, store_id, variant_id, price_minor, currency, availability, created_at)
SELECT 'catalog_store_offer_migrated', idempotency_key || ':legacy:' || id::text, correlation_id, acting_actor_id,
       'offer_legacy_' || store_id || '_' || product_id, from_state, to_state, expected_version, result_version, request_hash,
       store_id, 'variant_default_' || product_id, price_minor, currency, availability, created_at
FROM dsh.store_assortment_audit;

DROP TABLE dsh.store_assortment_audit;
DROP TABLE dsh.store_assortment_mutation_idempotency;
DROP TABLE dsh.store_assortments;
DROP TABLE dsh.central_product_audit;
DROP TABLE dsh.central_product_mutation_idempotency;
DROP TABLE dsh.central_products;
