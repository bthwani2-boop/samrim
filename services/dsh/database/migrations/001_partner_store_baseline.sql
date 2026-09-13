CREATE SCHEMA IF NOT EXISTS dsh;

CREATE TABLE IF NOT EXISTS dsh.schema_migrations (
    version integer PRIMARY KEY,
    name text NOT NULL,
    sha256 text NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS dsh.stores (
    id text PRIMARY KEY,
    partner_actor_id text NOT NULL,
    name text NOT NULL,
    version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT stores_id_partner_actor_uq UNIQUE (id, partner_actor_id),
    CONSTRAINT stores_name_length_chk CHECK (char_length(name) BETWEEN 2 AND 160),
    CONSTRAINT stores_version_positive_chk CHECK (version > 0)
);

CREATE INDEX IF NOT EXISTS stores_partner_actor_idx
    ON dsh.stores(partner_actor_id, created_at ASC);

CREATE TABLE IF NOT EXISTS dsh.partner_bootstrap_idempotency (
    idempotency_key text PRIMARY KEY,
    request_hash text NOT NULL,
    partner_actor_id text NOT NULL,
    store_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT partner_bootstrap_idempotency_facts_uq
        UNIQUE (idempotency_key, partner_actor_id, store_id, request_hash),
    CONSTRAINT partner_bootstrap_idempotency_store_partner_fk
        FOREIGN KEY (store_id, partner_actor_id)
        REFERENCES dsh.stores(id, partner_actor_id)
        ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS partner_bootstrap_idempotency_partner_idx
    ON dsh.partner_bootstrap_idempotency(partner_actor_id, created_at DESC);

CREATE TABLE IF NOT EXISTS dsh.partner_bootstrap_audit (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_type text NOT NULL,
    idempotency_key text NOT NULL,
    correlation_id text NOT NULL,
    acting_actor_id text NOT NULL,
    partner_actor_id text NOT NULL,
    store_id text NOT NULL,
    request_hash text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT partner_bootstrap_audit_event_type_chk
        CHECK (event_type = 'partner_bootstrap_created'),
    CONSTRAINT partner_bootstrap_audit_event_idempotency_uq
        UNIQUE (event_type, idempotency_key),
    CONSTRAINT partner_bootstrap_audit_idempotency_facts_fk
        FOREIGN KEY (idempotency_key, partner_actor_id, store_id, request_hash)
        REFERENCES dsh.partner_bootstrap_idempotency(idempotency_key, partner_actor_id, store_id, request_hash)
        ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS partner_bootstrap_audit_partner_idx
    ON dsh.partner_bootstrap_audit(partner_actor_id, created_at DESC);
