CREATE TABLE wlt.captain_wallet_funding (
    id text PRIMARY KEY,
    captain_actor_id text NOT NULL,
    amount_minor bigint NOT NULL,
    currency text NOT NULL DEFAULT 'YER',
    funding_reason text NOT NULL,
    evidence_reference text NOT NULL,
    created_by text NOT NULL,
    ledger_transaction_id text NOT NULL UNIQUE,
    idempotency_key text NOT NULL UNIQUE,
    request_hash text NOT NULL,
    correlation_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT captain_wallet_funding_actor_chk CHECK (length(btrim(captain_actor_id)) BETWEEN 1 AND 128),
    CONSTRAINT captain_wallet_funding_amount_chk CHECK (amount_minor > 0 AND currency = 'YER'),
    CONSTRAINT captain_wallet_funding_reason_chk CHECK (length(btrim(funding_reason)) BETWEEN 1 AND 512),
    CONSTRAINT captain_wallet_funding_evidence_chk CHECK (length(btrim(evidence_reference)) BETWEEN 1 AND 512),
    CONSTRAINT captain_wallet_funding_created_by_chk CHECK (length(btrim(created_by)) BETWEEN 1 AND 128),
    CONSTRAINT captain_wallet_funding_hash_chk CHECK (length(btrim(request_hash)) > 0),
    CONSTRAINT captain_wallet_funding_correlation_chk CHECK (length(btrim(correlation_id)) BETWEEN 1 AND 128),
    CONSTRAINT captain_wallet_funding_ledger_fk FOREIGN KEY (ledger_transaction_id) REFERENCES wlt.ledger_transactions(id) ON DELETE RESTRICT
);

CREATE INDEX captain_wallet_funding_actor_idx ON wlt.captain_wallet_funding(captain_actor_id, created_at DESC);

CREATE TABLE wlt.captain_cod_reservations (
    id text PRIMARY KEY,
    order_id text NOT NULL UNIQUE,
    payment_intent_id text NOT NULL UNIQUE,
    captain_actor_id text NOT NULL,
    amount_minor bigint NOT NULL,
    currency text NOT NULL DEFAULT 'YER',
    state text NOT NULL DEFAULT 'ACTIVE',
    reserve_idempotency_key text NOT NULL UNIQUE,
    request_hash text NOT NULL,
    correlation_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    released_at timestamptz,
    finalized_at timestamptz,
    ledger_transaction_id text UNIQUE,
    CONSTRAINT captain_cod_reservations_actor_chk CHECK (length(btrim(captain_actor_id)) BETWEEN 1 AND 128),
    CONSTRAINT captain_cod_reservations_amount_chk CHECK (amount_minor > 0 AND currency = 'YER'),
    CONSTRAINT captain_cod_reservations_state_chk CHECK (state IN ('ACTIVE', 'RELEASED', 'FINALIZED')),
    CONSTRAINT captain_cod_reservations_hash_chk CHECK (length(btrim(request_hash)) > 0),
    CONSTRAINT captain_cod_reservations_correlation_chk CHECK (length(btrim(correlation_id)) BETWEEN 1 AND 128),
    CONSTRAINT captain_cod_reservations_ledger_fk FOREIGN KEY (ledger_transaction_id) REFERENCES wlt.ledger_transactions(id) ON DELETE RESTRICT,
    CONSTRAINT captain_cod_reservations_terminal_time_chk CHECK ((state = 'ACTIVE' AND released_at IS NULL AND finalized_at IS NULL) OR (state = 'RELEASED' AND released_at IS NOT NULL AND finalized_at IS NULL) OR (state = 'FINALIZED' AND released_at IS NULL AND finalized_at IS NOT NULL))
);

CREATE INDEX captain_cod_reservations_actor_state_idx ON wlt.captain_cod_reservations(captain_actor_id, state, created_at DESC);

CREATE TABLE wlt.captain_cod_reservation_events (
    id text PRIMARY KEY,
    reservation_id text NOT NULL,
    event_type text NOT NULL,
    idempotency_key text NOT NULL UNIQUE,
    request_hash text NOT NULL,
    correlation_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT captain_cod_reservation_events_reservation_fk FOREIGN KEY (reservation_id) REFERENCES wlt.captain_cod_reservations(id) ON DELETE RESTRICT,
    CONSTRAINT captain_cod_reservation_events_type_chk CHECK (event_type IN ('CAPTAIN_COD_RESERVED', 'CAPTAIN_COD_RELEASED', 'CAPTAIN_COD_FINALIZED')),
    CONSTRAINT captain_cod_reservation_events_hash_chk CHECK (length(btrim(request_hash)) > 0),
    CONSTRAINT captain_cod_reservation_events_correlation_chk CHECK (length(btrim(correlation_id)) BETWEEN 1 AND 128)
);

CREATE INDEX captain_cod_reservation_events_reservation_idx ON wlt.captain_cod_reservation_events(reservation_id, created_at DESC);
