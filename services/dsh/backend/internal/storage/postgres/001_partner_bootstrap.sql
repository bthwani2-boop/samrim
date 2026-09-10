CREATE SCHEMA IF NOT EXISTS dsh;

CREATE TABLE IF NOT EXISTS dsh.schema_migrations (
    version integer PRIMARY KEY,
    name text NOT NULL,
    sha256 text NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS dsh.partner_organizations (
    id text PRIMARY KEY,
    owner_actor_id text NOT NULL,
    version integer NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT partner_organizations_owner_uq UNIQUE (owner_actor_id)
);

CREATE TABLE IF NOT EXISTS dsh.stores (
    id text PRIMARY KEY,
    partner_organization_id text NOT NULL REFERENCES dsh.partner_organizations(id) ON DELETE RESTRICT,
    name text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 160),
    version integer NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS dsh.partner_bootstrap_idempotency (
    idempotency_key text PRIMARY KEY,
    request_hash text NOT NULL,
    owner_actor_id text NOT NULL,
    partner_organization_id text NOT NULL REFERENCES dsh.partner_organizations(id) ON DELETE RESTRICT,
    store_id text NOT NULL REFERENCES dsh.stores(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS dsh.partner_bootstrap_audit (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_type text NOT NULL CHECK (event_type = 'partner_bootstrap_created'),
    idempotency_key text NOT NULL REFERENCES dsh.partner_bootstrap_idempotency(idempotency_key) ON DELETE RESTRICT,
    correlation_id text NOT NULL,
    acting_actor_id text NOT NULL,
    owner_actor_id text NOT NULL,
    partner_organization_id text NOT NULL REFERENCES dsh.partner_organizations(id) ON DELETE RESTRICT,
    store_id text NOT NULL REFERENCES dsh.stores(id) ON DELETE RESTRICT,
    request_hash text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT partner_bootstrap_audit_idempotency_uq UNIQUE (event_type, idempotency_key)
);

CREATE INDEX IF NOT EXISTS partner_bootstrap_audit_owner_idx ON dsh.partner_bootstrap_audit(owner_actor_id, created_at DESC);
