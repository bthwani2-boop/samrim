-- Operations contact confirmation for the first three proven successful orders.
-- A contact is not an order approval: preparation is never blocked by this migration.
CREATE TABLE dsh.customer_order_contact_reviews (
    order_id text PRIMARY KEY REFERENCES dsh.commerce_orders(id) ON DELETE RESTRICT,
    client_actor_id text NOT NULL,
    state text NOT NULL CHECK (state IN ('NO_ANSWER','CONFIRMED','DENIED','WRONG_NUMBER')),
    attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 100),
    version integer NOT NULL DEFAULT 1 CHECK (version >= 0),
    last_actor_id text NOT NULL,
    last_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    confirmed_at timestamptz,
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT customer_contact_confirmation_chk CHECK ((state='CONFIRMED') = (confirmed_at IS NOT NULL))
);
CREATE INDEX customer_order_contact_client_idx ON dsh.customer_order_contact_reviews(client_actor_id, state);

CREATE TABLE dsh.customer_order_contact_events (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_id text NOT NULL REFERENCES dsh.commerce_orders(id) ON DELETE RESTRICT,
    client_actor_id text NOT NULL,
    decision text NOT NULL CHECK (decision IN ('NO_ANSWER','CONFIRMED','DENIED','WRONG_NUMBER')),
    operator_actor_id text NOT NULL,
    idempotency_key text NOT NULL UNIQUE,
    request_hash text NOT NULL,
    correlation_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX customer_order_contact_events_order_idx ON dsh.customer_order_contact_events(order_id, created_at DESC);
