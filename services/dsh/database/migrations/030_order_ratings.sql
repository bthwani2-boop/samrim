-- A client may leave one durable rating/review only after the order is delivered.
-- The order remains the ownership boundary; this table is intentionally not public.
CREATE TABLE dsh.commerce_order_ratings (
    order_id text PRIMARY KEY,
    client_actor_id text NOT NULL,
    store_id text NOT NULL,
    rating smallint NOT NULL,
    review text NOT NULL DEFAULT '',
    idempotency_key text NOT NULL UNIQUE,
    request_hash text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT commerce_order_ratings_order_fk
        FOREIGN KEY (order_id) REFERENCES dsh.commerce_orders(id) ON DELETE CASCADE,
    CONSTRAINT commerce_order_ratings_store_fk
        FOREIGN KEY (store_id) REFERENCES dsh.stores(id) ON DELETE RESTRICT,
    CONSTRAINT commerce_order_ratings_actor_chk CHECK (length(btrim(client_actor_id)) > 0),
    CONSTRAINT commerce_order_ratings_rating_chk CHECK (rating BETWEEN 1 AND 5),
    CONSTRAINT commerce_order_ratings_review_chk CHECK (char_length(review) <= 1000),
    CONSTRAINT commerce_order_ratings_request_hash_chk CHECK (request_hash ~ '^[0-9a-f]{64}$')
);

CREATE INDEX commerce_order_ratings_client_idx
    ON dsh.commerce_order_ratings(client_actor_id, created_at DESC);
CREATE INDEX commerce_order_ratings_store_idx
    ON dsh.commerce_order_ratings(store_id, rating, created_at DESC);

CREATE TABLE dsh.commerce_order_rating_audit (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_type text NOT NULL,
    idempotency_key text NOT NULL,
    correlation_id text NOT NULL,
    acting_actor_id text NOT NULL,
    order_id text NOT NULL,
    client_actor_id text NOT NULL,
    store_id text NOT NULL,
    rating smallint NOT NULL,
    review text NOT NULL,
    request_hash text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT commerce_order_rating_audit_event_chk
        CHECK (event_type = 'order_rated'),
    CONSTRAINT commerce_order_rating_audit_event_idempotency_uq
        UNIQUE (event_type, idempotency_key),
    CONSTRAINT commerce_order_rating_audit_order_fk
        FOREIGN KEY (order_id) REFERENCES dsh.commerce_orders(id) ON DELETE RESTRICT,
    CONSTRAINT commerce_order_rating_audit_store_fk
        FOREIGN KEY (store_id) REFERENCES dsh.stores(id) ON DELETE RESTRICT,
    CONSTRAINT commerce_order_rating_audit_rating_chk CHECK (rating BETWEEN 1 AND 5),
    CONSTRAINT commerce_order_rating_audit_review_chk CHECK (char_length(review) <= 1000),
    CONSTRAINT commerce_order_rating_audit_request_hash_chk CHECK (request_hash ~ '^[0-9a-f]{64}$')
);

CREATE INDEX commerce_order_rating_audit_order_idx
    ON dsh.commerce_order_rating_audit(order_id, created_at DESC, id DESC);
