CREATE TABLE dsh.catalog_media_mutation_idempotency (
    idempotency_key text PRIMARY KEY,
    request_hash text NOT NULL,
    product_id text NOT NULL,
    expected_version integer NOT NULL,
    result_version integer NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT catalog_media_idempotency_expected_version_chk CHECK (expected_version > 0),
    CONSTRAINT catalog_media_idempotency_result_version_chk CHECK (result_version > 0),
    CONSTRAINT catalog_media_idempotency_product_fk FOREIGN KEY (product_id) REFERENCES dsh.catalog_products(id) ON DELETE RESTRICT
);

CREATE INDEX catalog_media_idempotency_product_idx
    ON dsh.catalog_media_mutation_idempotency(product_id, created_at DESC);

CREATE TABLE dsh.catalog_media_audit (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_type text NOT NULL,
    idempotency_key text NOT NULL,
    correlation_id text NOT NULL,
    acting_actor_id text NOT NULL,
    product_id text NOT NULL,
    from_version integer NOT NULL,
    result_version integer NOT NULL,
    media_count integer NOT NULL,
    request_hash text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT catalog_media_audit_event_chk CHECK (event_type = 'catalog_media_replaced'),
    CONSTRAINT catalog_media_audit_event_idempotency_uq UNIQUE (event_type, idempotency_key),
    CONSTRAINT catalog_media_audit_product_fk FOREIGN KEY (product_id) REFERENCES dsh.catalog_products(id) ON DELETE RESTRICT,
    CONSTRAINT catalog_media_audit_from_version_chk CHECK (from_version > 0),
    CONSTRAINT catalog_media_audit_result_version_chk CHECK (result_version > from_version),
    CONSTRAINT catalog_media_audit_media_count_chk CHECK (media_count BETWEEN 0 AND 21)
);

CREATE INDEX catalog_media_audit_product_idx
    ON dsh.catalog_media_audit(product_id, created_at DESC, id DESC);
