-- Variant lifecycle is a canonical mutation surface, so its replay and audit
-- records are separate from Product family mutations.
CREATE TABLE dsh.catalog_variant_mutation_idempotency (
    idempotency_key text PRIMARY KEY,
    request_hash text NOT NULL,
    variant_id text NOT NULL,
    operation text NOT NULL,
    result_version integer NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT catalog_variant_idempotency_operation_chk CHECK (operation IN ('create', 'update')),
    CONSTRAINT catalog_variant_idempotency_version_chk CHECK (result_version > 0),
    CONSTRAINT catalog_variant_idempotency_variant_fk FOREIGN KEY (variant_id) REFERENCES dsh.catalog_product_variants(id) ON DELETE RESTRICT
);
CREATE INDEX catalog_variant_idempotency_variant_idx ON dsh.catalog_variant_mutation_idempotency(variant_id, created_at DESC);

CREATE TABLE dsh.catalog_variant_audit (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_type text NOT NULL,
    idempotency_key text NOT NULL,
    correlation_id text NOT NULL,
    acting_actor_id text NOT NULL,
    variant_id text NOT NULL,
    product_id text NOT NULL,
    from_version integer,
    result_version integer NOT NULL,
    request_hash text NOT NULL,
    title text NOT NULL,
    measurement_kind text NOT NULL,
    base_unit text NOT NULL,
    active boolean NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT catalog_variant_audit_event_type_chk CHECK (event_type IN ('catalog_variant_created', 'catalog_variant_updated')),
    CONSTRAINT catalog_variant_audit_event_idempotency_uq UNIQUE (event_type, idempotency_key),
    CONSTRAINT catalog_variant_audit_variant_fk FOREIGN KEY (variant_id) REFERENCES dsh.catalog_product_variants(id) ON DELETE RESTRICT,
    CONSTRAINT catalog_variant_audit_product_fk FOREIGN KEY (product_id) REFERENCES dsh.catalog_products(id) ON DELETE RESTRICT,
    CONSTRAINT catalog_variant_audit_version_chk CHECK (result_version > 0),
    CONSTRAINT catalog_variant_audit_measurement_kind_chk CHECK (measurement_kind IN ('DISCRETE', 'MEASURED', 'VARIABLE_MEASURE')),
    CONSTRAINT catalog_variant_audit_base_unit_chk CHECK (base_unit IN ('COUNT', 'GRAM', 'MILLILITER')),
    CONSTRAINT catalog_variant_audit_measurement_identity_chk CHECK ((measurement_kind = 'DISCRETE' AND base_unit = 'COUNT') OR (measurement_kind IN ('MEASURED', 'VARIABLE_MEASURE') AND base_unit <> 'COUNT'))
);
CREATE INDEX catalog_variant_audit_variant_idx ON dsh.catalog_variant_audit(variant_id, created_at DESC);

CREATE TABLE dsh.catalog_attribute_mutation_idempotency (
    idempotency_key text PRIMARY KEY,
    request_hash text NOT NULL,
    attribute_id text NOT NULL,
    operation text NOT NULL,
    result_version integer NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT catalog_attribute_idempotency_operation_chk CHECK (operation IN ('create', 'update')),
    CONSTRAINT catalog_attribute_idempotency_version_chk CHECK (result_version > 0),
    CONSTRAINT catalog_attribute_idempotency_attribute_fk FOREIGN KEY (attribute_id) REFERENCES dsh.catalog_attribute_definitions(id) ON DELETE RESTRICT
);
CREATE INDEX catalog_attribute_idempotency_attribute_idx ON dsh.catalog_attribute_mutation_idempotency(attribute_id, created_at DESC);
