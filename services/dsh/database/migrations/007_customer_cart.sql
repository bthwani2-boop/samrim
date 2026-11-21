-- DSH-owned Customer Cart drafts; isolated progressive-development migration.
-- The Cart is not an Order, quotation, inventory hold or WLT authorization.
-- Applied baseline files remain immutable; use this forward-only migration.
DO $guard$
BEGIN
    IF current_database() <> 'bthwani_refoundation' OR current_user NOT IN ('bthwani_ci', 'bthwani_agent02') THEN
        RAISE EXCEPTION 'DSH Customer Cart migration requires isolated owner';
    END IF;
END;
$guard$;

CREATE UNIQUE INDEX IF NOT EXISTS customer_cart_offer_store_reference
    ON __SCHEMA__.offers(id, store_id);

CREATE TABLE IF NOT EXISTS __SCHEMA__.customer_carts (
    actor_id text NOT NULL CHECK (char_length(actor_id) BETWEEN 1 AND 128 AND actor_id = trim(actor_id)),
    store_id text NOT NULL REFERENCES __SCHEMA__.stores(id),
    version bigint NOT NULL DEFAULT 0 CHECK (version >= 0),
    updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
    PRIMARY KEY (actor_id, store_id)
);

CREATE TABLE IF NOT EXISTS __SCHEMA__.customer_cart_lines (
    actor_id text NOT NULL,
    store_id text NOT NULL,
    offer_id text NOT NULL,
    quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 2147483647),
    PRIMARY KEY (actor_id, store_id, offer_id),
    FOREIGN KEY (actor_id, store_id)
        REFERENCES __SCHEMA__.customer_carts(actor_id, store_id) ON DELETE CASCADE,
    FOREIGN KEY (offer_id, store_id)
        REFERENCES __SCHEMA__.offers(id, store_id)
);

CREATE TABLE IF NOT EXISTS __SCHEMA__.customer_cart_commands (
    actor_id text NOT NULL,
    store_id text NOT NULL,
    operation_id text NOT NULL CHECK (operation_id ~ '^[A-Za-z0-9._-]{8,128}$'),
    payload_hash bytea NOT NULL CHECK (octet_length(payload_hash) = 32),
    version bigint NOT NULL CHECK (version >= 1),
    applied_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
    PRIMARY KEY (actor_id, store_id, operation_id),
    FOREIGN KEY (actor_id, store_id)
        REFERENCES __SCHEMA__.customer_carts(actor_id, store_id)
);
