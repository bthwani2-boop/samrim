CREATE TABLE wlt.cash_remittances (
    id text PRIMARY KEY,
    payment_intent_id text NOT NULL,
    captain_actor_id text NOT NULL,
    amount_minor bigint NOT NULL,
    currency text NOT NULL DEFAULT 'YER',
    remittance_reference text NOT NULL,
    idempotency_key text NOT NULL,
    request_hash text NOT NULL,
    correlation_id text NOT NULL,
    state text NOT NULL DEFAULT 'REMITTED',
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT cash_remittances_payment_uq UNIQUE (payment_intent_id),
    CONSTRAINT cash_remittances_idempotency_uq UNIQUE (idempotency_key),
    CONSTRAINT cash_remittances_amount_chk CHECK (amount_minor > 0),
    CONSTRAINT cash_remittances_currency_chk CHECK (currency = 'YER'),
    CONSTRAINT cash_remittances_reference_chk CHECK (char_length(remittance_reference) BETWEEN 1 AND 128),
    CONSTRAINT cash_remittances_state_chk CHECK (state = 'REMITTED'),
    CONSTRAINT cash_remittances_payment_fk FOREIGN KEY (payment_intent_id) REFERENCES wlt.payment_intents(id) ON DELETE RESTRICT
);
CREATE INDEX cash_remittances_captain_idx
    ON wlt.cash_remittances(captain_actor_id, created_at DESC, id DESC);

CREATE TABLE wlt.cash_remittance_events (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    remittance_id text NOT NULL,
    payment_intent_id text NOT NULL,
    event_type text NOT NULL,
    idempotency_key text NOT NULL,
    request_hash text NOT NULL,
    correlation_id text NOT NULL,
    captain_actor_id text NOT NULL,
    amount_minor bigint NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT cash_remittance_events_type_chk CHECK (event_type = 'CASH_REMITTED'),
    CONSTRAINT cash_remittance_events_idempotency_uq UNIQUE (idempotency_key),
    CONSTRAINT cash_remittance_events_amount_chk CHECK (amount_minor > 0),
    CONSTRAINT cash_remittance_events_remittance_fk FOREIGN KEY (remittance_id) REFERENCES wlt.cash_remittances(id) ON DELETE RESTRICT,
    CONSTRAINT cash_remittance_events_payment_fk FOREIGN KEY (payment_intent_id) REFERENCES wlt.payment_intents(id) ON DELETE RESTRICT
);
CREATE INDEX cash_remittance_events_payment_idx
    ON wlt.cash_remittance_events(payment_intent_id, created_at, id);
