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
    updated_at timestamptz NOT NULL DEFAULT transaction_timestamp()
);
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
    published boolean NOT NULL DEFAULT false,
    updated_at timestamptz NOT NULL DEFAULT now(),
    latitude double precision CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
    longitude double precision CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180)
);
CREATE INDEX IF NOT EXISTS idx_stores_marketplace ON __SCHEMA__.stores (city_id,lower(name),id)
    WHERE published AND relation='MARKETPLACE';
