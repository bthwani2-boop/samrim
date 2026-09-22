-- DSH keeps a bounded payment snapshot for the Order while WLT owns the
-- payment-intent truth and immutable payment events.
ALTER TABLE dsh.commerce_orders
    ADD COLUMN payment_intent_id text,
    ADD COLUMN payment_method text NOT NULL DEFAULT 'CASH_ON_DELIVERY',
    ADD COLUMN payment_state text NOT NULL DEFAULT 'NOT_LINKED';

ALTER TABLE dsh.commerce_orders
    ADD CONSTRAINT commerce_orders_payment_method_chk
        CHECK (payment_method = 'CASH_ON_DELIVERY'),
    ADD CONSTRAINT commerce_orders_payment_state_chk
        CHECK (payment_state IN ('NOT_LINKED', 'REQUIRES_COLLECTION', 'COLLECTED', 'CANCELLED')),
    ADD CONSTRAINT commerce_orders_payment_binding_chk
        CHECK ((payment_state = 'NOT_LINKED' AND payment_intent_id IS NULL) OR (payment_state <> 'NOT_LINKED' AND payment_intent_id IS NOT NULL));

CREATE UNIQUE INDEX commerce_orders_payment_intent_uq
    ON dsh.commerce_orders(payment_intent_id)
    WHERE payment_intent_id IS NOT NULL;

CREATE INDEX commerce_orders_payment_state_idx
    ON dsh.commerce_orders(payment_state, updated_at DESC, id DESC);

CREATE TABLE dsh.commerce_order_payment_audit (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_type text NOT NULL,
    idempotency_key text NOT NULL,
    correlation_id text NOT NULL,
    acting_actor_id text NOT NULL,
    order_id text NOT NULL,
    payment_intent_id text NOT NULL,
    from_state text,
    to_state text NOT NULL,
    amount_minor bigint NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT commerce_order_payment_audit_event_chk CHECK (event_type IN ('payment_intent_linked', 'payment_collected', 'payment_cancelled')),
    CONSTRAINT commerce_order_payment_audit_idempotency_uq UNIQUE (event_type, idempotency_key),
    CONSTRAINT commerce_order_payment_audit_amount_chk CHECK (amount_minor > 0),
    CONSTRAINT commerce_order_payment_audit_order_fk FOREIGN KEY (order_id) REFERENCES dsh.commerce_orders(id) ON DELETE RESTRICT
);

CREATE INDEX commerce_order_payment_audit_order_idx
    ON dsh.commerce_order_payment_audit(order_id, created_at DESC, id DESC);
