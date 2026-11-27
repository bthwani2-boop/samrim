-- Fresh, disposable DSH schema. Owner: cities, verticals, Stores.
-- __SCHEMA__ requires a validated isolated test schema; never overlay retained data.
CREATE SCHEMA IF NOT EXISTS __SCHEMA__;
CREATE TABLE IF NOT EXISTS __SCHEMA__.public_revision (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0)
);
INSERT INTO __SCHEMA__.public_revision(singleton,revision) VALUES (true,0) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS __SCHEMA__.service_cities (
    id text PRIMARY KEY CHECK (id ~ '^[a-z0-9-]{1,64}$'),
    active boolean NOT NULL,
    timezone_name text CONSTRAINT service_cities_timezone_name_valid CHECK (
        timezone_name IS NULL OR (char_length(timezone_name) BETWEEN 3 AND 64 AND timezone_name ~ '^[A-Za-z0-9_+/-]+$')
    )
);
-- A missing effective policy is deliberately unavailable; no implicit radius.
-- Versioned policy admission is separate from an address or Store registration.
CREATE TABLE IF NOT EXISTS __SCHEMA__.service_city_delivery_policies (
    city_id text PRIMARY KEY REFERENCES __SCHEMA__.service_cities(id) ON DELETE RESTRICT,
    version bigint NOT NULL CHECK (version BETWEEN 1 AND 9007199254740991),
    radius_metres integer NOT NULL CHECK (radius_metres > 0),
    -- Nullable until a city tariff is approved. Same version as the geographic policy.
    distance_bands jsonb CHECK (distance_bands IS NULL OR (jsonb_typeof(distance_bands) = 'array' AND jsonb_array_length(distance_bands) BETWEEN 1 AND 30)),
    updated_at timestamptz NOT NULL DEFAULT transaction_timestamp()
);

-- Versioned command snapshots for the existing city delivery policy. No initial
-- business values are seeded; the command and current row commit together.
CREATE TABLE IF NOT EXISTS __SCHEMA__.service_city_delivery_policy_commands (
    city_id text NOT NULL REFERENCES __SCHEMA__.service_cities(id) ON DELETE RESTRICT,
    operation_id text NOT NULL CHECK (operation_id ~ '^[A-Za-z0-9._-]{8,128}$'),
    request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
    acting_actor_id text NOT NULL CHECK (char_length(acting_actor_id) BETWEEN 1 AND 128 AND acting_actor_id = trim(acting_actor_id)),
    reason text NOT NULL CHECK (char_length(trim(reason)) BETWEEN 1 AND 300),
    resulting_version bigint NOT NULL CHECK (resulting_version BETWEEN 1 AND 9007199254740991),
    radius_metres integer NOT NULL CHECK (radius_metres > 0),
    distance_bands jsonb NOT NULL CHECK (jsonb_typeof(distance_bands) = 'array' AND jsonb_array_length(distance_bands) BETWEEN 1 AND 30),
    changed_at timestamptz NOT NULL,
    PRIMARY KEY(city_id, operation_id),
    UNIQUE(city_id, resulting_version)
);
CREATE OR REPLACE FUNCTION __SCHEMA__.reject_delivery_policy_command_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'delivery policy command records are immutable';
END;
$$;
DROP TRIGGER IF EXISTS trg_delivery_policy_commands_immutable ON __SCHEMA__.service_city_delivery_policy_commands;
CREATE TRIGGER trg_delivery_policy_commands_immutable
BEFORE UPDATE OR DELETE ON __SCHEMA__.service_city_delivery_policy_commands
FOR EACH ROW EXECUTE FUNCTION __SCHEMA__.reject_delivery_policy_command_change();
CREATE TABLE IF NOT EXISTS __SCHEMA__.verticals (
    id text PRIMARY KEY CHECK (id ~ '^[a-z0-9-]{1,64}$'),
    active boolean NOT NULL
);
CREATE TABLE IF NOT EXISTS __SCHEMA__.stores (
    id text PRIMARY KEY CHECK (id ~ '^[a-z0-9-]{1,64}$'),
    owner_actor_id text NOT NULL,
    city_id text NOT NULL REFERENCES __SCHEMA__.service_cities(id),
    vertical_id text NOT NULL REFERENCES __SCHEMA__.verticals(id),
    relation text NOT NULL CHECK (relation IN ('MARKETPLACE','DIRECT')),
    name text NOT NULL CHECK (char_length(trim(name)) BETWEEN 1 AND 120),
    description text NOT NULL DEFAULT '',
    profile_version bigint NOT NULL DEFAULT 1 CHECK (profile_version BETWEEN 1 AND 9007199254740991),
    published boolean NOT NULL DEFAULT false,
    updated_at timestamptz NOT NULL DEFAULT now(),
    latitude double precision CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
    longitude double precision CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180)
);
CREATE INDEX IF NOT EXISTS idx_stores_marketplace ON __SCHEMA__.stores (city_id,lower(name),id)
    WHERE published AND relation='MARKETPLACE';

-- Private Customer preferences, owned by DSH and never a publication grant.
CREATE TABLE IF NOT EXISTS __SCHEMA__.customer_favorite_stores (
    actor_id text NOT NULL CHECK (char_length(actor_id) BETWEEN 1 AND 128 AND actor_id = trim(actor_id)),
    store_id text NOT NULL REFERENCES __SCHEMA__.stores(id) ON DELETE RESTRICT,
    PRIMARY KEY (actor_id,store_id)
);
-- Immutable draft metadata edits: a Store remains the sole current record.
CREATE TABLE IF NOT EXISTS __SCHEMA__.store_profile_commands (
    actor_id text NOT NULL CHECK (char_length(actor_id) BETWEEN 1 AND 128),
    operation_id text NOT NULL CHECK (operation_id ~ '^[A-Za-z0-9._-]{8,128}$'),
    store_id text NOT NULL REFERENCES __SCHEMA__.stores(id) ON DELETE RESTRICT,
    expected_version bigint NOT NULL CHECK (expected_version BETWEEN 1 AND 9007199254740990),
    result_version bigint NOT NULL CHECK (result_version = expected_version + 1),
    old_name text NOT NULL,
    old_description text NOT NULL,
    result_name text NOT NULL CHECK (char_length(result_name) BETWEEN 1 AND 120),
    result_description text NOT NULL CHECK (char_length(result_description) <= 1000),
    changed_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
    PRIMARY KEY (actor_id,operation_id),
    UNIQUE (store_id,result_version)
);
CREATE OR REPLACE FUNCTION __SCHEMA__.reject_store_profile_command_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'Store profile command records are immutable';
END;
$$;
CREATE TRIGGER trg_store_profile_commands_immutable
BEFORE UPDATE OR DELETE ON __SCHEMA__.store_profile_commands
FOR EACH ROW EXECUTE FUNCTION __SCHEMA__.reject_store_profile_command_change();
