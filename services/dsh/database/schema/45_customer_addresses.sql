-- Fresh disposable DSH schema; addresses remain private to the purchasing actor.
CREATE TABLE IF NOT EXISTS __SCHEMA__.customer_addresses (
    actor_id text NOT NULL CHECK (char_length(actor_id) BETWEEN 1 AND 128 AND actor_id = trim(actor_id)),
    id text NOT NULL CHECK (id ~ '^addr-[a-f0-9]{32}$'),
    city_id text NOT NULL REFERENCES __SCHEMA__.service_cities(id),
    label text NOT NULL CHECK (char_length(trim(label)) BETWEEN 1 AND 80),
    details text NOT NULL CHECK (char_length(trim(details)) BETWEEN 1 AND 300),
    latitude double precision NOT NULL CHECK (latitude BETWEEN -90 AND 90),
    longitude double precision NOT NULL CHECK (longitude BETWEEN -180 AND 180),
    version bigint NOT NULL CHECK (version BETWEEN 1 AND 9007199254740991),
    updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
    PRIMARY KEY (actor_id,id)
);
