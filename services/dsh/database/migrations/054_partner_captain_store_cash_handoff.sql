CREATE TABLE dsh.commerce_order_store_cash_handoffs (
    order_id text PRIMARY KEY,
    assignment_id text NOT NULL UNIQUE,
    store_id text NOT NULL,
    captain_actor_id text NOT NULL,
    partner_actor_id text NOT NULL,
    amount_minor bigint NOT NULL,
    state text NOT NULL DEFAULT 'AWAITING_STORE_HANDOFF',
    completion_idempotency_key text NOT NULL UNIQUE,
    confirmation_idempotency_key text UNIQUE,
    confirmation_request_hash text,
    store_confirmed_by text,
    store_confirmed_at timestamptz,
    settled_at timestamptz,
    version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT commerce_order_store_cash_handoffs_order_fk FOREIGN KEY (order_id) REFERENCES dsh.commerce_orders(id) ON DELETE RESTRICT,
    CONSTRAINT commerce_order_store_cash_handoffs_assignment_fk FOREIGN KEY (assignment_id) REFERENCES dsh.captain_assignments(id) ON DELETE RESTRICT,
    CONSTRAINT commerce_order_store_cash_handoffs_store_fk FOREIGN KEY (store_id) REFERENCES dsh.stores(id) ON DELETE RESTRICT,
    CONSTRAINT commerce_order_store_cash_handoffs_amount_chk CHECK (amount_minor > 0),
    CONSTRAINT commerce_order_store_cash_handoffs_state_chk CHECK (state IN ('AWAITING_STORE_HANDOFF','STORE_CONFIRMED','SETTLED')),
    CONSTRAINT commerce_order_store_cash_handoffs_actor_chk CHECK (length(btrim(captain_actor_id)) BETWEEN 1 AND 128 AND length(btrim(partner_actor_id)) BETWEEN 1 AND 128),
    CONSTRAINT commerce_order_store_cash_handoffs_version_chk CHECK (version > 0),
    CONSTRAINT commerce_order_store_cash_handoffs_completion_key_chk CHECK (length(btrim(completion_idempotency_key)) BETWEEN 8 AND 128),
    CONSTRAINT commerce_order_store_cash_handoffs_confirmation_chk CHECK (
        (state='AWAITING_STORE_HANDOFF' AND confirmation_idempotency_key IS NULL AND confirmation_request_hash IS NULL AND store_confirmed_by IS NULL AND store_confirmed_at IS NULL AND settled_at IS NULL)
        OR
        (state='STORE_CONFIRMED' AND confirmation_idempotency_key IS NOT NULL AND confirmation_request_hash IS NOT NULL AND store_confirmed_by=partner_actor_id AND store_confirmed_at IS NOT NULL AND settled_at IS NULL)
        OR
        (state='SETTLED' AND confirmation_idempotency_key IS NOT NULL AND confirmation_request_hash IS NOT NULL AND store_confirmed_by=partner_actor_id AND store_confirmed_at IS NOT NULL AND settled_at IS NOT NULL)
    )
);

CREATE INDEX commerce_order_store_cash_handoffs_partner_pending_idx
    ON dsh.commerce_order_store_cash_handoffs(partner_actor_id,created_at DESC)
    WHERE state='AWAITING_STORE_HANDOFF';

ALTER TABLE dsh.commerce_financial_handoff_outbox
    DROP CONSTRAINT commerce_financial_handoff_outbox_effect_chk,
    ADD CONSTRAINT commerce_financial_handoff_outbox_effect_chk CHECK (effect_type IN ('DELIVERY_SETTLEMENT','STORE_PICKUP_COLLECTION','PARTNER_CAPTAIN_STORE_CASH_COLLECTION','CAPTAIN_COD_RELEASE','PAYMENT_CANCEL')),
    DROP CONSTRAINT commerce_financial_handoff_outbox_shape_chk,
    ADD CONSTRAINT commerce_financial_handoff_outbox_shape_chk CHECK (
        (effect_type='DELIVERY_SETTLEMENT' AND amount_minor>0 AND captain_actor_id IS NOT NULL AND partner_actor_id IS NOT NULL AND reason IS NULL)
        OR
        (effect_type='STORE_PICKUP_COLLECTION' AND amount_minor>0 AND captain_actor_id IS NULL AND partner_actor_id IS NOT NULL AND reason IS NULL)
        OR
        (effect_type='PARTNER_CAPTAIN_STORE_CASH_COLLECTION' AND amount_minor>0 AND captain_actor_id IS NOT NULL AND partner_actor_id IS NOT NULL AND reason IS NULL)
        OR
        (effect_type='CAPTAIN_COD_RELEASE' AND amount_minor=0 AND captain_actor_id IS NOT NULL AND partner_actor_id IS NULL AND reason IS NULL)
        OR
        (effect_type='PAYMENT_CANCEL' AND amount_minor>0 AND captain_actor_id IS NULL AND partner_actor_id IS NULL AND length(btrim(reason))>0)
    );
