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
    name text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 160),
    version integer NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS stores_partner_actor_idx
    ON dsh.stores(partner_actor_id, created_at ASC);

CREATE TABLE IF NOT EXISTS dsh.partner_bootstrap_idempotency (
    idempotency_key text PRIMARY KEY,
    request_hash text NOT NULL,
    partner_actor_id text NOT NULL,
    store_id text NOT NULL REFERENCES dsh.stores(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS dsh.partner_bootstrap_audit (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_type text NOT NULL CHECK (event_type = 'partner_bootstrap_created'),
    idempotency_key text NOT NULL REFERENCES dsh.partner_bootstrap_idempotency(idempotency_key) ON DELETE RESTRICT,
    correlation_id text NOT NULL,
    acting_actor_id text NOT NULL,
    partner_actor_id text NOT NULL,
    store_id text NOT NULL REFERENCES dsh.stores(id) ON DELETE RESTRICT,
    request_hash text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT partner_bootstrap_audit_idempotency_uq UNIQUE (event_type, idempotency_key)
);

CREATE INDEX IF NOT EXISTS partner_bootstrap_audit_partner_idx
    ON dsh.partner_bootstrap_audit(partner_actor_id, created_at DESC);
