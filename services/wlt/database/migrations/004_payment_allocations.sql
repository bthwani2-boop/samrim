CREATE TABLE wlt.payment_allocations (
    id text PRIMARY KEY,
    order_id text NOT NULL,
    payment_intent_id text NOT NULL,
    currency text NOT NULL DEFAULT 'YER',
    subtotal_minor bigint NOT NULL,
    delivery_fee_minor bigint NOT NULL DEFAULT 0,
    discount_minor bigint NOT NULL DEFAULT 0,
    platform_subsidy_minor bigint NOT NULL DEFAULT 0,
    internal_wallet_amount_minor bigint NOT NULL DEFAULT 0,
    external_official_wallet_amount_minor bigint NOT NULL DEFAULT 0,
    cash_amount_minor bigint NOT NULL DEFAULT 0,
    cod_product_amount_minor bigint NOT NULL DEFAULT 0,
    cod_delivery_amount_minor bigint NOT NULL DEFAULT 0,
    total_minor bigint NOT NULL,
    policy_version text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT payment_allocations_order_uq UNIQUE (order_id),
    CONSTRAINT payment_allocations_payment_intent_uq UNIQUE (payment_intent_id),
    CONSTRAINT payment_allocations_payment_intent_fk FOREIGN KEY (payment_intent_id) REFERENCES wlt.payment_intents(id) ON DELETE RESTRICT,
    CONSTRAINT payment_allocations_currency_chk CHECK (currency = 'YER'),
    CONSTRAINT payment_allocations_nonnegative_chk CHECK (
        subtotal_minor >= 0 AND delivery_fee_minor >= 0 AND discount_minor >= 0 AND platform_subsidy_minor >= 0
        AND internal_wallet_amount_minor >= 0 AND external_official_wallet_amount_minor >= 0 AND cash_amount_minor >= 0
        AND cod_product_amount_minor >= 0 AND cod_delivery_amount_minor >= 0 AND total_minor > 0
    ),
    CONSTRAINT payment_allocations_total_chk CHECK (total_minor = subtotal_minor + delivery_fee_minor - discount_minor),
    CONSTRAINT payment_allocations_conservation_chk CHECK (
        internal_wallet_amount_minor + external_official_wallet_amount_minor + cash_amount_minor + platform_subsidy_minor = total_minor
    ),
    CONSTRAINT payment_allocations_cod_split_chk CHECK (cod_product_amount_minor + cod_delivery_amount_minor = cash_amount_minor),
    CONSTRAINT payment_allocations_policy_chk CHECK (length(btrim(policy_version)) BETWEEN 1 AND 128)
);

CREATE TABLE wlt.payment_allocation_events (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    allocation_id text NOT NULL,
    event_type text NOT NULL,
    order_id text NOT NULL,
    payment_intent_id text NOT NULL,
    request_hash text NOT NULL,
    idempotency_key text NOT NULL,
    correlation_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT payment_allocation_events_allocation_fk FOREIGN KEY (allocation_id) REFERENCES wlt.payment_allocations(id) ON DELETE RESTRICT,
    CONSTRAINT payment_allocation_events_type_chk CHECK (event_type = 'PAYMENT_ALLOCATION_CREATED'),
    CONSTRAINT payment_allocation_events_idempotency_uq UNIQUE (idempotency_key)
);

CREATE INDEX payment_allocations_policy_idx ON wlt.payment_allocations(policy_version, created_at DESC, id DESC);
CREATE INDEX payment_allocation_events_allocation_idx ON wlt.payment_allocation_events(allocation_id, created_at, id);
