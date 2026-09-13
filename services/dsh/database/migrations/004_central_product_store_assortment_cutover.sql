DO $$
BEGIN
    IF (SELECT count(*) FROM dsh.catalog_items) <> 0
       OR (SELECT count(*) FROM dsh.catalog_item_mutation_idempotency) <> 0
       OR (SELECT count(*) FROM dsh.catalog_item_audit) <> 0 THEN
        RAISE EXCEPTION 'legacy catalog evidence is non-empty; reconcile before central Product cutover';
    END IF;
END $$;

DROP TABLE dsh.catalog_item_audit;
DROP TABLE dsh.catalog_item_mutation_idempotency;
DROP TABLE dsh.catalog_items;

CREATE TABLE dsh.central_products (
    id text PRIMARY KEY,
    canonical_name text NOT NULL,
    brand text,
    barcode text,
    canonical_image_url text,
    sell_unit text NOT NULL,
    active boolean NOT NULL DEFAULT true,
    version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT central_products_name_chk CHECK (char_length(btrim(canonical_name)) BETWEEN 1 AND 160),
    CONSTRAINT central_products_sell_unit_chk CHECK (sell_unit IN ('piece', 'kg')),
    CONSTRAINT central_products_version_chk CHECK (version > 0)
);

CREATE UNIQUE INDEX central_products_barcode_uq
    ON dsh.central_products(barcode) WHERE barcode IS NOT NULL;
CREATE INDEX central_products_active_idx
    ON dsh.central_products(active, id);
CREATE INDEX central_products_name_prefix_idx
    ON dsh.central_products(lower(canonical_name) text_pattern_ops, id);

CREATE TABLE dsh.central_product_mutation_idempotency (
    idempotency_key text PRIMARY KEY,
    request_hash text NOT NULL,
    product_id text NOT NULL,
    operation text NOT NULL,
    result_version integer NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT central_product_idempotency_facts_uq UNIQUE (idempotency_key, request_hash, product_id, operation),
    CONSTRAINT central_product_idempotency_operation_chk CHECK (operation IN ('create', 'update')),
    CONSTRAINT central_product_idempotency_version_chk CHECK (result_version > 0),
    CONSTRAINT central_product_idempotency_product_fk FOREIGN KEY (product_id) REFERENCES dsh.central_products(id) ON DELETE RESTRICT
);
CREATE INDEX central_product_idempotency_product_idx ON dsh.central_product_mutation_idempotency(product_id, created_at DESC);

CREATE TABLE dsh.central_product_audit (
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
    barcode text,
    canonical_image_url text,
    sell_unit text NOT NULL,
    active boolean NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT central_product_audit_event_type_chk CHECK (event_type IN ('central_product_created', 'central_product_updated')),
    CONSTRAINT central_product_audit_event_idempotency_uq UNIQUE (event_type, idempotency_key),
    CONSTRAINT central_product_audit_product_fk FOREIGN KEY (product_id) REFERENCES dsh.central_products(id) ON DELETE RESTRICT,
    CONSTRAINT central_product_audit_version_chk CHECK (result_version > 0)
);
CREATE INDEX central_product_audit_product_idx ON dsh.central_product_audit(product_id, created_at DESC);

CREATE TABLE dsh.store_assortments (
    store_id text NOT NULL,
    product_id text NOT NULL,
    price_minor bigint NOT NULL,
    currency text NOT NULL DEFAULT 'YER',
    availability boolean NOT NULL DEFAULT true,
    publication_state text NOT NULL DEFAULT 'draft',
    version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (store_id, product_id),
    CONSTRAINT store_assortments_store_fk FOREIGN KEY (store_id) REFERENCES dsh.stores(id) ON DELETE RESTRICT,
    CONSTRAINT store_assortments_product_fk FOREIGN KEY (product_id) REFERENCES dsh.central_products(id) ON DELETE RESTRICT,
    CONSTRAINT store_assortments_price_chk CHECK (price_minor > 0),
    CONSTRAINT store_assortments_currency_chk CHECK (currency = 'YER'),
    CONSTRAINT store_assortments_state_chk CHECK (publication_state IN ('draft', 'published', 'hidden')),
    CONSTRAINT store_assortments_version_chk CHECK (version > 0)
);
CREATE INDEX store_assortments_store_idx ON dsh.store_assortments(store_id, created_at ASC, product_id ASC);
CREATE INDEX store_assortments_public_idx ON dsh.store_assortments(store_id, publication_state, availability, product_id);

CREATE TABLE dsh.store_assortment_mutation_idempotency (
    idempotency_key text PRIMARY KEY,
    request_hash text NOT NULL,
    store_id text NOT NULL,
    product_id text NOT NULL,
    operation text NOT NULL,
    result_version integer NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT store_assortment_idempotency_facts_uq UNIQUE (idempotency_key, request_hash, store_id, product_id, operation),
    CONSTRAINT store_assortment_idempotency_operation_chk CHECK (operation IN ('create', 'update')),
    CONSTRAINT store_assortment_idempotency_version_chk CHECK (result_version > 0),
    CONSTRAINT store_assortment_idempotency_store_fk FOREIGN KEY (store_id) REFERENCES dsh.stores(id) ON DELETE RESTRICT,
    CONSTRAINT store_assortment_idempotency_product_fk FOREIGN KEY (product_id) REFERENCES dsh.central_products(id) ON DELETE RESTRICT
);
CREATE INDEX store_assortment_idempotency_store_idx ON dsh.store_assortment_mutation_idempotency(store_id, created_at DESC);

CREATE TABLE dsh.store_assortment_audit (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_type text NOT NULL,
    idempotency_key text NOT NULL,
    correlation_id text NOT NULL,
    acting_actor_id text NOT NULL,
    store_id text NOT NULL,
    product_id text NOT NULL,
    from_state text,
    to_state text NOT NULL,
    expected_version integer,
    result_version integer NOT NULL,
    request_hash text NOT NULL,
    price_minor bigint NOT NULL,
    currency text NOT NULL,
    availability boolean NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT store_assortment_audit_event_type_chk CHECK (event_type IN ('store_assortment_created', 'store_assortment_updated')),
    CONSTRAINT store_assortment_audit_event_idempotency_uq UNIQUE (event_type, idempotency_key),
    CONSTRAINT store_assortment_audit_store_fk FOREIGN KEY (store_id) REFERENCES dsh.stores(id) ON DELETE RESTRICT,
    CONSTRAINT store_assortment_audit_product_fk FOREIGN KEY (product_id) REFERENCES dsh.central_products(id) ON DELETE RESTRICT,
    CONSTRAINT store_assortment_audit_price_chk CHECK (price_minor > 0),
    CONSTRAINT store_assortment_audit_currency_chk CHECK (currency = 'YER'),
    CONSTRAINT store_assortment_audit_version_chk CHECK (result_version > 0)
);
CREATE INDEX store_assortment_audit_store_idx ON dsh.store_assortment_audit(store_id, created_at DESC);
