CREATE SCHEMA IF NOT EXISTS wlt;

CREATE TABLE wlt.payment_intents (
    id text PRIMARY KEY,
    external_reference text NOT NULL,
    payer_actor_id text NOT NULL,
    amount_minor bigint NOT NULL,
    currency text NOT NULL DEFAULT 'YER',
    method text NOT NULL DEFAULT 'CASH_ON_DELIVERY',
    state text NOT NULL DEFAULT 'REQUIRES_COLLECTION',
    version integer NOT NULL DEFAULT 1,
    idempotency_key text NOT NULL,
    request_hash text NOT NULL,
    collected_amount_minor bigint,
    collected_by_actor_id text,
    collection_reference text,
    collected_at timestamptz,
    cancellation_reason text,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT payment_intents_external_method_uq UNIQUE (external_reference, method),
    CONSTRAINT payment_intents_idempotency_uq UNIQUE (idempotency_key),
    CONSTRAINT payment_intents_amount_chk CHECK (amount_minor > 0),
    CONSTRAINT payment_intents_currency_chk CHECK (currency = 'YER'),
    CONSTRAINT payment_intents_method_chk CHECK (method = 'CASH_ON_DELIVERY'),
    CONSTRAINT payment_intents_state_chk CHECK (state IN ('REQUIRES_COLLECTION', 'COLLECTED', 'CANCELLED')),
    CONSTRAINT payment_intents_version_chk CHECK (version > 0),
    CONSTRAINT payment_intents_collection_chk CHECK (
        (state = 'COLLECTED' AND collected_amount_minor = amount_minor AND collected_by_actor_id IS NOT NULL AND collected_at IS NOT NULL)
        OR (state <> 'COLLECTED' AND collected_amount_minor IS NULL AND collected_by_actor_id IS NULL AND collected_at IS NULL)
    )
);

CREATE INDEX payment_intents_external_reference_idx ON wlt.payment_intents (external_reference);
CREATE INDEX payment_intents_state_idx ON wlt.payment_intents (state, updated_at DESC);

CREATE TABLE wlt.payment_intent_events (
    id text PRIMARY KEY,
    intent_id text NOT NULL,
    event_type text NOT NULL,
    idempotency_key text NOT NULL,
    request_hash text NOT NULL,
    actor_id text,
    correlation_id text NOT NULL,
    from_state text,
    to_state text NOT NULL,
    amount_minor bigint,
    reason text,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT payment_intent_events_intent_fk FOREIGN KEY (intent_id) REFERENCES wlt.payment_intents(id) ON DELETE RESTRICT,
    CONSTRAINT payment_intent_events_idempotency_uq UNIQUE (idempotency_key),
    CONSTRAINT payment_intent_events_type_chk CHECK (event_type IN ('PAYMENT_INTENT_CREATED', 'PAYMENT_INTENT_COLLECTED', 'PAYMENT_INTENT_CANCELLED')),
    CONSTRAINT payment_intent_events_to_state_chk CHECK (to_state IN ('REQUIRES_COLLECTION', 'COLLECTED', 'CANCELLED')),
    CONSTRAINT payment_intent_events_amount_chk CHECK (amount_minor IS NULL OR amount_minor > 0)
);

CREATE INDEX payment_intent_events_intent_idx ON wlt.payment_intent_events (intent_id, created_at, id);
