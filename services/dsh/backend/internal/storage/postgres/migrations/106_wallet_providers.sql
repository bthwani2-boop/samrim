CREATE TABLE dsh.wallet_providers (
    key text PRIMARY KEY CHECK (key ~ '^wallet_provider_[a-z0-9_]{2,60}$'),
    display_name_ar text NOT NULL CHECK (length(btrim(display_name_ar)) BETWEEN 2 AND 80),
    active boolean NOT NULL DEFAULT true,
    version integer NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX wallet_providers_display_name_ar_uq ON dsh.wallet_providers (lower(btrim(display_name_ar)));
CREATE TABLE dsh.wallet_provider_mutation_idempotency (
    idempotency_key text PRIMARY KEY,
    request_hash text NOT NULL,
    provider_key text NOT NULL REFERENCES dsh.wallet_providers(key) ON DELETE RESTRICT,
    operation text NOT NULL CHECK (operation IN ('create','update')),
    expected_version integer,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE dsh.wallet_provider_audit (
    id bigserial PRIMARY KEY,
    event_type text NOT NULL,
    idempotency_key text NOT NULL UNIQUE,
    correlation_id text NOT NULL,
    acting_actor_id text NOT NULL,
    provider_key text NOT NULL REFERENCES dsh.wallet_providers(key) ON DELETE RESTRICT,
    from_version integer,
    result_version integer NOT NULL,
    from_active boolean,
    to_active boolean NOT NULL,
    request_hash text NOT NULL,
    display_name_ar text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
INSERT INTO dsh.wallet_providers(key,display_name_ar) VALUES
 ('wallet_provider_floosak','فلوسك'),
 ('wallet_provider_haseb','حاسب'),
 ('wallet_provider_jeeb','جيب');
