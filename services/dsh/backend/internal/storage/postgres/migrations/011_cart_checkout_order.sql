-- Cart, checkout and the pre-dispatch Order lifecycle are one DSH-owned
-- journey. Payment, dispatch and delivery remain outside this migration.
CREATE TABLE dsh.commerce_carts (
    id text PRIMARY KEY,
    client_actor_id text NOT NULL,
    store_id text NOT NULL,
    state text NOT NULL DEFAULT 'open',
    version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT commerce_carts_state_chk CHECK (state IN ('open', 'checked_out')),
    CONSTRAINT commerce_carts_version_chk CHECK (version > 0),
    CONSTRAINT commerce_carts_store_fk FOREIGN KEY (store_id) REFERENCES dsh.stores(id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX commerce_carts_client_store_open_uq
    ON dsh.commerce_carts(client_actor_id, store_id) WHERE state='open';
CREATE INDEX commerce_carts_client_idx
    ON dsh.commerce_carts(client_actor_id, updated_at DESC, id DESC);

CREATE TABLE dsh.commerce_cart_lines (
    id text PRIMARY KEY,
    cart_id text NOT NULL,
    store_offer_id text NOT NULL,
    variant_id text NOT NULL,
    quantity_base_units bigint NOT NULL,
    selected_modifier_option_ids text[] NOT NULL DEFAULT ARRAY[]::text[],
    removed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT commerce_cart_lines_quantity_chk CHECK (quantity_base_units > 0),
    CONSTRAINT commerce_cart_lines_modifiers_chk CHECK (cardinality(selected_modifier_option_ids) = 0),
    CONSTRAINT commerce_cart_lines_cart_fk FOREIGN KEY (cart_id) REFERENCES dsh.commerce_carts(id) ON DELETE RESTRICT,
    CONSTRAINT commerce_cart_lines_offer_fk FOREIGN KEY (store_offer_id) REFERENCES dsh.catalog_store_offers(id) ON DELETE RESTRICT,
    CONSTRAINT commerce_cart_lines_variant_fk FOREIGN KEY (variant_id) REFERENCES dsh.catalog_product_variants(id) ON DELETE RESTRICT
);
CREATE INDEX commerce_cart_lines_cart_idx
    ON dsh.commerce_cart_lines(cart_id, created_at, id);
CREATE UNIQUE INDEX commerce_cart_lines_cart_offer_uq
    ON dsh.commerce_cart_lines(cart_id, store_offer_id) WHERE removed_at IS NULL;

CREATE TABLE dsh.commerce_cart_mutation_idempotency (
    idempotency_key text PRIMARY KEY,
    request_hash text NOT NULL,
    cart_id text NOT NULL,
    line_id text,
    operation text NOT NULL,
    expected_cart_version integer NOT NULL,
    result_cart_version integer NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT commerce_cart_idempotency_operation_chk CHECK (operation IN ('line_upsert', 'line_remove')),
    CONSTRAINT commerce_cart_idempotency_expected_version_chk CHECK (expected_cart_version >= 0),
    CONSTRAINT commerce_cart_idempotency_result_version_chk CHECK (result_cart_version > 0),
    CONSTRAINT commerce_cart_idempotency_cart_fk FOREIGN KEY (cart_id) REFERENCES dsh.commerce_carts(id) ON DELETE RESTRICT,
    CONSTRAINT commerce_cart_idempotency_line_fk FOREIGN KEY (line_id) REFERENCES dsh.commerce_cart_lines(id) ON DELETE RESTRICT
);
CREATE INDEX commerce_cart_idempotency_cart_idx
    ON dsh.commerce_cart_mutation_idempotency(cart_id, created_at DESC);

CREATE TABLE dsh.commerce_cart_audit (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_type text NOT NULL,
    idempotency_key text NOT NULL,
    correlation_id text NOT NULL,
    acting_actor_id text NOT NULL,
    cart_id text NOT NULL,
    line_id text,
    store_offer_id text,
    from_version integer,
    result_version integer NOT NULL,
    request_hash text NOT NULL,
    quantity_base_units bigint,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT commerce_cart_audit_event_type_chk CHECK (event_type IN ('cart_line_added', 'cart_line_updated', 'cart_line_removed')),
    CONSTRAINT commerce_cart_audit_event_idempotency_uq UNIQUE (event_type, idempotency_key),
    CONSTRAINT commerce_cart_audit_cart_fk FOREIGN KEY (cart_id) REFERENCES dsh.commerce_carts(id) ON DELETE RESTRICT,
    CONSTRAINT commerce_cart_audit_line_fk FOREIGN KEY (line_id) REFERENCES dsh.commerce_cart_lines(id) ON DELETE RESTRICT,
    CONSTRAINT commerce_cart_audit_result_version_chk CHECK (result_version > 0)
);
CREATE INDEX commerce_cart_audit_cart_idx
    ON dsh.commerce_cart_audit(cart_id, created_at DESC);

CREATE TABLE dsh.commerce_orders (
    id text PRIMARY KEY,
    client_actor_id text NOT NULL,
    store_id text NOT NULL,
    cart_id text NOT NULL UNIQUE,
    address_id text NOT NULL,
    address_version integer NOT NULL,
    address_text text NOT NULL,
    address_latitude numeric NOT NULL,
    address_longitude numeric NOT NULL,
    service_city_id text NOT NULL,
    serviceability_policy_version text NOT NULL,
    serviceability_status text NOT NULL,
    serviceability_store_version integer NOT NULL,
    serviceability_address_version integer NOT NULL,
    state text NOT NULL DEFAULT 'CREATED',
    total_amount_minor bigint NOT NULL,
    currency text NOT NULL DEFAULT 'YER',
    version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT commerce_orders_address_version_chk CHECK (address_version > 0),
    CONSTRAINT commerce_orders_coordinates_chk CHECK (address_latitude BETWEEN -90 AND 90 AND address_longitude BETWEEN -180 AND 180),
    CONSTRAINT commerce_orders_serviceability_status_chk CHECK (serviceability_status = 'SERVICEABLE'),
    CONSTRAINT commerce_orders_state_chk CHECK (state IN ('CREATED', 'PARTNER_ACCEPTED', 'PREPARING', 'READY_FOR_DISPATCH', 'REJECTED')),
    CONSTRAINT commerce_orders_total_chk CHECK (total_amount_minor > 0),
    CONSTRAINT commerce_orders_currency_chk CHECK (currency = 'YER'),
    CONSTRAINT commerce_orders_version_chk CHECK (version > 0),
    CONSTRAINT commerce_orders_store_fk FOREIGN KEY (store_id) REFERENCES dsh.stores(id) ON DELETE RESTRICT,
    CONSTRAINT commerce_orders_cart_fk FOREIGN KEY (cart_id) REFERENCES dsh.commerce_carts(id) ON DELETE RESTRICT,
    CONSTRAINT commerce_orders_service_city_fk FOREIGN KEY (service_city_id) REFERENCES dsh.service_cities(id) ON DELETE RESTRICT
);
CREATE INDEX commerce_orders_client_idx
    ON dsh.commerce_orders(client_actor_id, created_at DESC, id DESC);
CREATE INDEX commerce_orders_store_state_idx
    ON dsh.commerce_orders(store_id, state, created_at ASC, id ASC);

CREATE TABLE dsh.commerce_order_lines (
    id text PRIMARY KEY,
    order_id text NOT NULL,
    store_offer_id text NOT NULL,
    variant_id text NOT NULL,
    product_id text NOT NULL,
    product_name text NOT NULL,
    variant_title text NOT NULL,
    sell_unit text NOT NULL,
    pricing_basis text NOT NULL,
    requested_quantity_base_units bigint NOT NULL,
    unit_price_minor bigint NOT NULL,
    line_amount_minor bigint NOT NULL,
    currency text NOT NULL DEFAULT 'YER',
    selected_modifier_option_ids text[] NOT NULL DEFAULT ARRAY[]::text[],
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT commerce_order_lines_quantity_chk CHECK (requested_quantity_base_units > 0),
    CONSTRAINT commerce_order_lines_price_chk CHECK (unit_price_minor > 0 AND line_amount_minor > 0),
    CONSTRAINT commerce_order_lines_unit_chk CHECK (sell_unit IN ('piece', 'kg')),
    CONSTRAINT commerce_order_lines_pricing_chk CHECK (pricing_basis IN ('PER_UNIT', 'PER_KILOGRAM')),
    CONSTRAINT commerce_order_lines_currency_chk CHECK (currency = 'YER'),
    CONSTRAINT commerce_order_lines_modifiers_chk CHECK (cardinality(selected_modifier_option_ids) = 0),
    CONSTRAINT commerce_order_lines_order_fk FOREIGN KEY (order_id) REFERENCES dsh.commerce_orders(id) ON DELETE RESTRICT,
    CONSTRAINT commerce_order_lines_order_offer_uq UNIQUE (order_id, store_offer_id)
);
CREATE INDEX commerce_order_lines_order_idx
    ON dsh.commerce_order_lines(order_id, created_at, id);

CREATE TABLE dsh.commerce_order_checkout_idempotency (
    idempotency_key text PRIMARY KEY,
    request_hash text NOT NULL,
    cart_id text NOT NULL,
    order_id text NOT NULL,
    result_version integer NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT commerce_order_checkout_idempotency_version_chk CHECK (result_version > 0),
    CONSTRAINT commerce_order_checkout_idempotency_cart_fk FOREIGN KEY (cart_id) REFERENCES dsh.commerce_carts(id) ON DELETE RESTRICT,
    CONSTRAINT commerce_order_checkout_idempotency_order_fk FOREIGN KEY (order_id) REFERENCES dsh.commerce_orders(id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX commerce_order_checkout_cart_uq
    ON dsh.commerce_order_checkout_idempotency(cart_id);

CREATE TABLE dsh.commerce_order_transition_idempotency (
    idempotency_key text PRIMARY KEY,
    request_hash text NOT NULL,
    order_id text NOT NULL,
    requested_state text NOT NULL,
    expected_version integer NOT NULL,
    result_version integer NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT commerce_order_transition_state_chk CHECK (requested_state IN ('PARTNER_ACCEPTED', 'PREPARING', 'READY_FOR_DISPATCH', 'REJECTED')),
    CONSTRAINT commerce_order_transition_expected_version_chk CHECK (expected_version > 0),
    CONSTRAINT commerce_order_transition_result_version_chk CHECK (result_version > 0),
    CONSTRAINT commerce_order_transition_order_fk FOREIGN KEY (order_id) REFERENCES dsh.commerce_orders(id) ON DELETE RESTRICT
);
CREATE INDEX commerce_order_transition_order_idx
    ON dsh.commerce_order_transition_idempotency(order_id, created_at DESC);

CREATE TABLE dsh.commerce_order_audit (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_type text NOT NULL,
    idempotency_key text NOT NULL,
    correlation_id text NOT NULL,
    acting_actor_id text NOT NULL,
    order_id text NOT NULL,
    from_state text,
    to_state text NOT NULL,
    from_version integer,
    result_version integer NOT NULL,
    request_hash text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT commerce_order_audit_event_type_chk CHECK (event_type IN ('order_created', 'order_partner_accepted', 'order_preparing', 'order_ready_for_dispatch', 'order_rejected')),
    CONSTRAINT commerce_order_audit_event_idempotency_uq UNIQUE (event_type, idempotency_key),
    CONSTRAINT commerce_order_audit_order_fk FOREIGN KEY (order_id) REFERENCES dsh.commerce_orders(id) ON DELETE RESTRICT,
    CONSTRAINT commerce_order_audit_result_version_chk CHECK (result_version > 0)
);
CREATE INDEX commerce_order_audit_order_idx
    ON dsh.commerce_order_audit(order_id, created_at DESC);
