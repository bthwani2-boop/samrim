-- A multi-store checkout is an orchestration record. Each Store remains an
-- independent Order and payment allocation; the parent only reconciles them.
CREATE TABLE dsh.commerce_multi_store_checkouts (
    id text PRIMARY KEY,
    client_actor_id text NOT NULL,
    state text NOT NULL DEFAULT 'PROCESSING',
    version integer NOT NULL DEFAULT 1,
    child_count integer NOT NULL,
    successful_child_count integer NOT NULL DEFAULT 0,
    failed_child_count integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT commerce_multi_store_checkouts_state_chk CHECK (state IN ('PROCESSING', 'COMPLETE', 'PARTIAL_FAILURE', 'FAILED', 'CANCELLED')),
    CONSTRAINT commerce_multi_store_checkouts_version_chk CHECK (version > 0),
    CONSTRAINT commerce_multi_store_checkouts_child_count_chk CHECK (child_count >= 2),
    CONSTRAINT commerce_multi_store_checkouts_success_count_chk CHECK (successful_child_count >= 0 AND successful_child_count <= child_count),
    CONSTRAINT commerce_multi_store_checkouts_failed_count_chk CHECK (failed_child_count >= 0 AND failed_child_count <= child_count)
);
CREATE INDEX commerce_multi_store_checkouts_client_idx
    ON dsh.commerce_multi_store_checkouts(client_actor_id, created_at DESC, id DESC);

CREATE TABLE dsh.commerce_multi_store_checkout_children (
    id text PRIMARY KEY,
    checkout_id text NOT NULL,
    child_index integer NOT NULL,
    cart_id text NOT NULL,
    store_id text NOT NULL,
    address_id text NOT NULL,
    cart_version integer NOT NULL,
    fulfillment_mode text NOT NULL,
    promotion_code text,
    order_id text,
    state text NOT NULL DEFAULT 'PENDING',
    failure_code text,
    failure_message text,
    version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT commerce_multi_store_checkout_children_state_chk CHECK (state IN ('PENDING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'CANCEL_FAILED')),
    CONSTRAINT commerce_multi_store_checkout_children_index_chk CHECK (child_index >= 0),
    CONSTRAINT commerce_multi_store_checkout_children_cart_version_chk CHECK (cart_version > 0),
    CONSTRAINT commerce_multi_store_checkout_children_version_chk CHECK (version > 0),
    CONSTRAINT commerce_multi_store_checkout_children_order_state_chk CHECK ((state = 'SUCCEEDED' AND order_id IS NOT NULL) OR (state <> 'SUCCEEDED')),
    CONSTRAINT commerce_multi_store_checkout_children_checkout_fk FOREIGN KEY (checkout_id) REFERENCES dsh.commerce_multi_store_checkouts(id) ON DELETE RESTRICT,
    CONSTRAINT commerce_multi_store_checkout_children_cart_fk FOREIGN KEY (cart_id) REFERENCES dsh.commerce_carts(id) ON DELETE RESTRICT,
    CONSTRAINT commerce_multi_store_checkout_children_store_fk FOREIGN KEY (store_id) REFERENCES dsh.stores(id) ON DELETE RESTRICT,
    CONSTRAINT commerce_multi_store_checkout_children_order_fk FOREIGN KEY (order_id) REFERENCES dsh.commerce_orders(id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX commerce_multi_store_checkout_children_index_uq
    ON dsh.commerce_multi_store_checkout_children(checkout_id, child_index);
CREATE UNIQUE INDEX commerce_multi_store_checkout_children_cart_uq
    ON dsh.commerce_multi_store_checkout_children(checkout_id, cart_id);
CREATE UNIQUE INDEX commerce_multi_store_checkout_children_store_uq
    ON dsh.commerce_multi_store_checkout_children(checkout_id, store_id);
CREATE UNIQUE INDEX commerce_multi_store_checkout_children_order_uq
    ON dsh.commerce_multi_store_checkout_children(checkout_id, order_id) WHERE order_id IS NOT NULL;
CREATE INDEX commerce_multi_store_checkout_children_checkout_idx
    ON dsh.commerce_multi_store_checkout_children(checkout_id, child_index);

CREATE TABLE dsh.commerce_multi_store_checkout_idempotency (
    idempotency_key text PRIMARY KEY,
    request_hash text NOT NULL,
    checkout_id text NOT NULL,
    operation text NOT NULL,
    expected_version integer NOT NULL DEFAULT 0,
    result_version integer NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT commerce_multi_store_checkout_idempotency_operation_chk CHECK (operation IN ('CREATE', 'CANCEL')),
    CONSTRAINT commerce_multi_store_checkout_idempotency_expected_version_chk CHECK (expected_version >= 0),
    CONSTRAINT commerce_multi_store_checkout_idempotency_result_version_chk CHECK (result_version > 0),
    CONSTRAINT commerce_multi_store_checkout_idempotency_checkout_fk FOREIGN KEY (checkout_id) REFERENCES dsh.commerce_multi_store_checkouts(id) ON DELETE RESTRICT
);
CREATE INDEX commerce_multi_store_checkout_idempotency_checkout_idx
    ON dsh.commerce_multi_store_checkout_idempotency(checkout_id, created_at DESC);
