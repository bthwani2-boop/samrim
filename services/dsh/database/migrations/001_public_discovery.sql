-- Development-owned DSH public discovery baseline. Use only in an isolated empty DSH schema.
-- __SCHEMA__ is replaced only after strict SQL-identifier validation by the DSH migration runner.
CREATE SCHEMA IF NOT EXISTS __SCHEMA__;
CREATE TABLE IF NOT EXISTS __SCHEMA__.public_revision (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0)
);
INSERT INTO __SCHEMA__.public_revision(singleton,revision) VALUES (true,0) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS __SCHEMA__.service_cities (
    id text PRIMARY KEY CHECK (id ~ '^[a-z0-9-]{1,64}$'),
    active boolean NOT NULL
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
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_stores_marketplace ON __SCHEMA__.stores (city_id,lower(name),id)
    WHERE published AND relation='MARKETPLACE';
CREATE TABLE IF NOT EXISTS __SCHEMA__.products (
    id text PRIMARY KEY,
    store_id text NOT NULL REFERENCES __SCHEMA__.stores(id),
    name text NOT NULL CHECK (char_length(trim(name)) BETWEEN 1 AND 160),
    active boolean NOT NULL DEFAULT false,
    UNIQUE (id,store_id)
);
CREATE TABLE IF NOT EXISTS __SCHEMA__.variants (
    id text PRIMARY KEY,
    product_id text NOT NULL REFERENCES __SCHEMA__.products(id),
    sellable boolean NOT NULL DEFAULT false,
    required_attributes_valid boolean NOT NULL DEFAULT false,
    UNIQUE (id,product_id)
);
CREATE TABLE IF NOT EXISTS __SCHEMA__.offers (
    id text PRIMARY KEY,
    store_id text NOT NULL,
    product_id text NOT NULL,
    variant_id text NOT NULL,
    published boolean NOT NULL DEFAULT false,
    available boolean NOT NULL DEFAULT false,
    price_yer bigint NOT NULL CHECK (price_yer >= 0),
    stock_units integer NOT NULL CHECK (stock_units >= 0),
    FOREIGN KEY (product_id,store_id) REFERENCES __SCHEMA__.products(id,store_id),
    FOREIGN KEY (variant_id,product_id) REFERENCES __SCHEMA__.variants(id,product_id)
);
CREATE INDEX IF NOT EXISTS idx_public_offers ON __SCHEMA__.offers(store_id,id) WHERE published AND available;
