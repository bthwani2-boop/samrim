-- An accepted DSH order adjustment may require financial treatment that is not
-- yet covered by a versioned refund/additional-collection policy. Record the
-- WLT-owned unresolved case without inventing an amount or moving ledger value.
CREATE TABLE wlt.order_adjustment_reconciliation_cases (
    id text PRIMARY KEY,
    order_id text NOT NULL,
    adjustment_id text NOT NULL,
    payment_intent_id text NOT NULL REFERENCES wlt.payment_intents(id) ON DELETE RESTRICT,
    adjustment_kind text NOT NULL,
    requested_by_actor_id text NOT NULL,
    customer_actor_id text NOT NULL,
    state text NOT NULL DEFAULT 'RECONCILIATION_REQUIRED',
    reason_code text NOT NULL DEFAULT 'ORDER_ADJUSTMENT_FINANCIAL_POLICY_REQUIRED',
    idempotency_key text NOT NULL UNIQUE,
    request_hash text NOT NULL,
    correlation_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT order_adjustment_reconciliation_case_order_adjustment_uq UNIQUE (order_id, adjustment_id),
    CONSTRAINT order_adjustment_reconciliation_case_id_chk CHECK (length(btrim(id)) BETWEEN 1 AND 128),
    CONSTRAINT order_adjustment_reconciliation_case_order_chk CHECK (length(btrim(order_id)) BETWEEN 1 AND 128),
    CONSTRAINT order_adjustment_reconciliation_case_adjustment_chk CHECK (length(btrim(adjustment_id)) BETWEEN 1 AND 128),
    CONSTRAINT order_adjustment_reconciliation_case_kind_chk CHECK (adjustment_kind IN ('REMOVE_ITEM','SUBSTITUTE_ITEM','SET_ACTUAL_QUANTITY')),
    CONSTRAINT order_adjustment_reconciliation_case_requester_chk CHECK (length(btrim(requested_by_actor_id)) BETWEEN 1 AND 128),
    CONSTRAINT order_adjustment_reconciliation_case_customer_chk CHECK (length(btrim(customer_actor_id)) BETWEEN 1 AND 128),
    CONSTRAINT order_adjustment_reconciliation_case_state_chk CHECK (state = 'RECONCILIATION_REQUIRED'),
    CONSTRAINT order_adjustment_reconciliation_case_reason_chk CHECK (reason_code = 'ORDER_ADJUSTMENT_FINANCIAL_POLICY_REQUIRED'),
    CONSTRAINT order_adjustment_reconciliation_case_idempotency_chk CHECK (length(btrim(idempotency_key)) BETWEEN 8 AND 128),
    CONSTRAINT order_adjustment_reconciliation_case_hash_chk CHECK (request_hash ~ '^[a-f0-9]{64}$'),
    CONSTRAINT order_adjustment_reconciliation_case_correlation_chk CHECK (length(btrim(correlation_id)) BETWEEN 8 AND 128)
);

CREATE INDEX order_adjustment_reconciliation_case_order_idx
    ON wlt.order_adjustment_reconciliation_cases(order_id, created_at ASC, id);
