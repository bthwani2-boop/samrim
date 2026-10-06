ALTER TABLE dsh.stores
    ADD COLUMN delivery_origin_latitude numeric(9,6),
    ADD COLUMN delivery_origin_longitude numeric(10,6),
    ADD CONSTRAINT stores_delivery_origin_pair_chk
        CHECK ((delivery_origin_latitude IS NULL AND delivery_origin_longitude IS NULL)
            OR (delivery_origin_latitude IS NOT NULL AND delivery_origin_longitude IS NOT NULL)),
    ADD CONSTRAINT stores_delivery_origin_latitude_chk
        CHECK (delivery_origin_latitude IS NULL OR delivery_origin_latitude BETWEEN -90 AND 90),
    ADD CONSTRAINT stores_delivery_origin_longitude_chk
        CHECK (delivery_origin_longitude IS NULL OR delivery_origin_longitude BETWEEN -180 AND 180);

CREATE TABLE dsh.delivery_addresses (
    id text PRIMARY KEY,
    client_actor_id text NOT NULL,
    address_text text NOT NULL,
    latitude numeric(9,6) NOT NULL,
    longitude numeric(10,6) NOT NULL,
    version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT delivery_addresses_text_chk CHECK (char_length(btrim(address_text)) BETWEEN 3 AND 500),
    CONSTRAINT delivery_addresses_latitude_chk CHECK (latitude BETWEEN -90 AND 90),
    CONSTRAINT delivery_addresses_longitude_chk CHECK (longitude BETWEEN -180 AND 180),
    CONSTRAINT delivery_addresses_version_chk CHECK (version > 0)
);

CREATE INDEX delivery_addresses_client_idx
    ON dsh.delivery_addresses(client_actor_id, created_at DESC, id DESC);

CREATE TABLE dsh.delivery_address_mutation_idempotency (
    idempotency_key text PRIMARY KEY,
    request_hash text NOT NULL,
    address_id text NOT NULL,
    client_actor_id text NOT NULL,
    operation text NOT NULL,
    expected_version integer,
    result_version integer NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT delivery_address_idempotency_facts_uq
        UNIQUE (idempotency_key, request_hash, address_id, client_actor_id, operation),
    CONSTRAINT delivery_address_idempotency_operation_chk
        CHECK (operation IN ('create', 'update')),
    CONSTRAINT delivery_address_idempotency_expected_version_chk
        CHECK (expected_version IS NULL OR expected_version > 0),
    CONSTRAINT delivery_address_idempotency_result_version_chk CHECK (result_version > 0),
    CONSTRAINT delivery_address_idempotency_address_fk
        FOREIGN KEY (address_id) REFERENCES dsh.delivery_addresses(id) ON DELETE RESTRICT
);

CREATE INDEX delivery_address_idempotency_client_idx
    ON dsh.delivery_address_mutation_idempotency(client_actor_id, created_at DESC);

CREATE TABLE dsh.delivery_address_audit (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_type text NOT NULL,
    idempotency_key text NOT NULL,
    correlation_id text NOT NULL,
    acting_actor_id text NOT NULL,
    client_actor_id text NOT NULL,
    address_id text NOT NULL,
    expected_version integer,
    result_version integer NOT NULL,
    request_hash text NOT NULL,
    address_text text NOT NULL,
    latitude numeric(9,6) NOT NULL,
    longitude numeric(10,6) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT delivery_address_audit_event_type_chk
        CHECK (event_type IN ('delivery_address_created', 'delivery_address_updated')),
    CONSTRAINT delivery_address_audit_event_idempotency_uq
        UNIQUE (event_type, idempotency_key),
    CONSTRAINT delivery_address_audit_address_fk
        FOREIGN KEY (address_id) REFERENCES dsh.delivery_addresses(id) ON DELETE RESTRICT,
    CONSTRAINT delivery_address_audit_expected_version_chk
        CHECK (expected_version IS NULL OR expected_version > 0),
    CONSTRAINT delivery_address_audit_result_version_chk CHECK (result_version > 0),
    CONSTRAINT delivery_address_audit_text_chk CHECK (char_length(btrim(address_text)) BETWEEN 3 AND 500),
    CONSTRAINT delivery_address_audit_latitude_chk CHECK (latitude BETWEEN -90 AND 90),
    CONSTRAINT delivery_address_audit_longitude_chk CHECK (longitude BETWEEN -180 AND 180)
);

CREATE INDEX delivery_address_audit_client_idx
    ON dsh.delivery_address_audit(client_actor_id, created_at DESC);

CREATE TABLE dsh.store_origin_mutation_idempotency (
    idempotency_key text PRIMARY KEY,
    request_hash text NOT NULL,
    store_id text NOT NULL,
    partner_actor_id text NOT NULL,
    expected_version integer NOT NULL,
    result_version integer NOT NULL,
    result_latitude numeric(9,6) NOT NULL,
    result_longitude numeric(10,6) NOT NULL,
    result_updated_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT store_origin_idempotency_facts_uq
        UNIQUE (idempotency_key, request_hash, store_id, partner_actor_id, expected_version),
    CONSTRAINT store_origin_idempotency_expected_version_chk CHECK (expected_version > 0),
    CONSTRAINT store_origin_idempotency_result_version_chk CHECK (result_version > 0),
    CONSTRAINT store_origin_idempotency_latitude_chk CHECK (result_latitude BETWEEN -90 AND 90),
    CONSTRAINT store_origin_idempotency_longitude_chk CHECK (result_longitude BETWEEN -180 AND 180),
    CONSTRAINT store_origin_idempotency_store_partner_fk
        FOREIGN KEY (store_id, partner_actor_id)
        REFERENCES dsh.stores(id, partner_actor_id) ON DELETE RESTRICT
);

CREATE INDEX store_origin_idempotency_partner_idx
    ON dsh.store_origin_mutation_idempotency(partner_actor_id, created_at DESC);

CREATE TABLE dsh.store_origin_audit (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_type text NOT NULL,
    idempotency_key text NOT NULL,
    correlation_id text NOT NULL,
    acting_actor_id text NOT NULL,
    partner_actor_id text NOT NULL,
    store_id text NOT NULL,
    expected_version integer NOT NULL,
    result_version integer NOT NULL,
    request_hash text NOT NULL,
    latitude numeric(9,6) NOT NULL,
    longitude numeric(10,6) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT store_origin_audit_event_type_chk CHECK (event_type = 'store_delivery_origin_set'),
    CONSTRAINT store_origin_audit_event_idempotency_uq UNIQUE (event_type, idempotency_key),
    CONSTRAINT store_origin_audit_store_partner_fk
        FOREIGN KEY (store_id, partner_actor_id)
        REFERENCES dsh.stores(id, partner_actor_id) ON DELETE RESTRICT,
    CONSTRAINT store_origin_audit_expected_version_chk CHECK (expected_version > 0),
    CONSTRAINT store_origin_audit_result_version_chk CHECK (result_version > 0),
    CONSTRAINT store_origin_audit_latitude_chk CHECK (latitude BETWEEN -90 AND 90),
    CONSTRAINT store_origin_audit_longitude_chk CHECK (longitude BETWEEN -180 AND 180)
);

CREATE INDEX store_origin_audit_partner_idx
    ON dsh.store_origin_audit(partner_actor_id, created_at DESC);
