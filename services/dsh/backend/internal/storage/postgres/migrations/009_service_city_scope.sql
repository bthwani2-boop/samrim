-- City Scope V1 is a forward-only DSH cutover. Legacy rows remain readable
-- with nullable city references, but new scoped journeys must supply a
-- canonical active Service City.
CREATE TABLE dsh.service_cities (
    id text PRIMARY KEY,
    display_name_ar text NOT NULL,
    active boolean NOT NULL DEFAULT true,
    version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT service_cities_id_chk CHECK (id ~ '^[a-z0-9][a-z0-9_-]{1,127}$'),
    CONSTRAINT service_cities_display_name_ar_chk CHECK (char_length(btrim(display_name_ar)) BETWEEN 2 AND 160),
    CONSTRAINT service_cities_version_chk CHECK (version > 0)
);

CREATE UNIQUE INDEX service_cities_display_name_ar_uq
    ON dsh.service_cities(lower(btrim(display_name_ar)));
CREATE INDEX service_cities_active_idx
    ON dsh.service_cities(active, lower(display_name_ar), id);

CREATE TABLE dsh.service_city_mutation_idempotency (
    idempotency_key text PRIMARY KEY,
    request_hash text NOT NULL,
    city_id text NOT NULL,
    operation text NOT NULL,
    expected_version integer,
    result_version integer NOT NULL,
    result_display_name_ar text NOT NULL,
    result_active boolean NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT service_city_idempotency_facts_uq UNIQUE (idempotency_key, request_hash, city_id, operation, expected_version),
    CONSTRAINT service_city_idempotency_operation_chk CHECK (operation IN ('create', 'update')),
    CONSTRAINT service_city_idempotency_expected_version_chk CHECK (expected_version IS NULL OR expected_version > 0),
    CONSTRAINT service_city_idempotency_result_version_chk CHECK (result_version > 0),
    CONSTRAINT service_city_idempotency_city_fk FOREIGN KEY (city_id) REFERENCES dsh.service_cities(id) ON DELETE RESTRICT
);
CREATE INDEX service_city_idempotency_city_idx
    ON dsh.service_city_mutation_idempotency(city_id, created_at DESC);

CREATE TABLE dsh.service_city_audit (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_type text NOT NULL,
    idempotency_key text NOT NULL,
    correlation_id text NOT NULL,
    acting_actor_id text NOT NULL,
    city_id text NOT NULL,
    from_version integer,
    result_version integer NOT NULL,
    from_active boolean,
    to_active boolean NOT NULL,
    request_hash text NOT NULL,
    display_name_ar text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT service_city_audit_event_type_chk CHECK (event_type IN ('service_city_created', 'service_city_updated')),
    CONSTRAINT service_city_audit_event_idempotency_uq UNIQUE (event_type, idempotency_key),
    CONSTRAINT service_city_audit_city_fk FOREIGN KEY (city_id) REFERENCES dsh.service_cities(id) ON DELETE RESTRICT,
    CONSTRAINT service_city_audit_from_version_chk CHECK (from_version IS NULL OR from_version > 0),
    CONSTRAINT service_city_audit_result_version_chk CHECK (result_version > 0),
    CONSTRAINT service_city_audit_display_name_ar_chk CHECK (char_length(btrim(display_name_ar)) BETWEEN 2 AND 160)
);
CREATE INDEX service_city_audit_city_idx
    ON dsh.service_city_audit(city_id, created_at DESC);

ALTER TABLE dsh.stores
    ADD COLUMN service_city_id text,
    ADD CONSTRAINT stores_service_city_fk FOREIGN KEY (service_city_id) REFERENCES dsh.service_cities(id) ON DELETE RESTRICT;
CREATE INDEX stores_service_city_idx
    ON dsh.stores(service_city_id, publication_state, id);

ALTER TABLE dsh.joining_cases
    ADD COLUMN first_store_service_city_id text,
    ADD CONSTRAINT joining_cases_service_city_fk FOREIGN KEY (first_store_service_city_id) REFERENCES dsh.service_cities(id) ON DELETE RESTRICT;
CREATE INDEX joining_cases_service_city_idx
    ON dsh.joining_cases(first_store_service_city_id, state, id);

ALTER TABLE dsh.delivery_addresses
    ADD COLUMN service_city_id text,
    ADD CONSTRAINT delivery_addresses_service_city_fk FOREIGN KEY (service_city_id) REFERENCES dsh.service_cities(id) ON DELETE RESTRICT;
CREATE INDEX delivery_addresses_service_city_idx
    ON dsh.delivery_addresses(client_actor_id, service_city_id, created_at DESC, id DESC);
