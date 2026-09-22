CREATE TABLE dsh.commerce_financial_handoff_outbox (
    id text PRIMARY KEY,
    effect_type text NOT NULL,
    source_ref text NOT NULL,
    order_id text NOT NULL,
    payment_intent_id text NOT NULL,
    captain_actor_id text,
    partner_actor_id text,
    amount_minor bigint NOT NULL DEFAULT 0,
    reason text,
    idempotency_key text NOT NULL,
    correlation_id text NOT NULL,
    state text NOT NULL DEFAULT 'PENDING',
    attempts integer NOT NULL DEFAULT 0,
    last_error text,
    next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT commerce_financial_handoff_outbox_source_uq UNIQUE (effect_type, order_id, source_ref),
    CONSTRAINT commerce_financial_handoff_outbox_idempotency_uq UNIQUE (effect_type, idempotency_key),
    CONSTRAINT commerce_financial_handoff_outbox_order_fk FOREIGN KEY (order_id) REFERENCES dsh.commerce_orders(id) ON DELETE RESTRICT,
    CONSTRAINT commerce_financial_handoff_outbox_effect_chk CHECK (effect_type IN ('DELIVERY_SETTLEMENT','CAPTAIN_COD_RELEASE','PAYMENT_CANCEL')),
    CONSTRAINT commerce_financial_handoff_outbox_source_chk CHECK (length(btrim(source_ref)) BETWEEN 1 AND 128),
    CONSTRAINT commerce_financial_handoff_outbox_payment_chk CHECK (length(btrim(payment_intent_id)) BETWEEN 1 AND 128),
    CONSTRAINT commerce_financial_handoff_outbox_idempotency_chk CHECK (length(btrim(idempotency_key)) BETWEEN 8 AND 128),
    CONSTRAINT commerce_financial_handoff_outbox_correlation_chk CHECK (length(btrim(correlation_id)) BETWEEN 8 AND 128),
    CONSTRAINT commerce_financial_handoff_outbox_state_chk CHECK (state IN ('PENDING','POSTED','FAILED')),
    CONSTRAINT commerce_financial_handoff_outbox_attempts_chk CHECK (attempts >= 0),
    CONSTRAINT commerce_financial_handoff_outbox_shape_chk CHECK (
        (effect_type='DELIVERY_SETTLEMENT' AND amount_minor>0 AND captain_actor_id IS NOT NULL AND partner_actor_id IS NOT NULL AND reason IS NULL)
        OR
        (effect_type='CAPTAIN_COD_RELEASE' AND amount_minor=0 AND captain_actor_id IS NOT NULL AND partner_actor_id IS NULL AND reason IS NULL)
        OR
        (effect_type='PAYMENT_CANCEL' AND amount_minor>0 AND captain_actor_id IS NULL AND partner_actor_id IS NULL AND length(btrim(reason))>0)
    )
);

CREATE INDEX commerce_financial_handoff_outbox_pending_idx
    ON dsh.commerce_financial_handoff_outbox(state,next_attempt_at ASC,created_at ASC,id ASC);
