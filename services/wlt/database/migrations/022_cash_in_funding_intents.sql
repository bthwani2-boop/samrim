ALTER TABLE wlt.ledger_entries
    DROP CONSTRAINT ledger_entries_code_chk,
    ADD CONSTRAINT ledger_entries_code_chk CHECK (account_code IN (
        'CAPTAIN_CASH_RECEIVABLE',
        'CUSTOMER_PAYMENT_CLEARING',
        'PARTNER_WALLET',
        'CAPTAIN_WALLET',
        'FIELD_WALLET',
        'PLATFORM_COMMISSION_INCOME',
        'FIELD_COMMISSION_EXPENSE',
        'EXTERNAL_SETTLEMENT_CASH',
        'PARTNER_COMMISSION_RECEIVABLE',
        'CUSTOMER_WALLET'
    )),
    DROP CONSTRAINT ledger_entries_actor_chk,
    ADD CONSTRAINT ledger_entries_actor_chk CHECK (
        (account_code IN ('PARTNER_WALLET', 'CAPTAIN_WALLET', 'FIELD_WALLET') AND actor_type IN ('partner', 'captain', 'field') AND actor_id IS NOT NULL)
        OR (account_code = 'CUSTOMER_WALLET' AND actor_type = 'customer' AND actor_id IS NOT NULL)
        OR (account_code = 'PARTNER_COMMISSION_RECEIVABLE' AND actor_type = 'partner' AND actor_id IS NOT NULL)
        OR (account_code NOT IN ('PARTNER_WALLET', 'CAPTAIN_WALLET', 'FIELD_WALLET', 'CUSTOMER_WALLET', 'PARTNER_COMMISSION_RECEIVABLE') AND actor_type IS NULL AND actor_id IS NULL)
    );

CREATE TABLE wlt.cash_in_funding_intents (
    id text PRIMARY KEY,
    actor_type text NOT NULL,
    actor_id text NOT NULL,
    funding_purpose text NOT NULL,
    provider_key text NOT NULL,
    external_reference text NOT NULL,
    requested_amount_minor bigint NOT NULL,
    currency text NOT NULL DEFAULT 'YER',
    state text NOT NULL DEFAULT 'PENDING_PROVIDER',
    version integer NOT NULL DEFAULT 1,
    provider_reference text,
    provider_transaction_reference text,
    ledger_transaction_id text,
    idempotency_key text NOT NULL UNIQUE,
    request_hash text NOT NULL,
    correlation_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT cash_in_funding_intents_actor_chk CHECK ((actor_type='customer' AND funding_purpose='CUSTOMER_TOPUP') OR (actor_type='captain' AND funding_purpose='CAPTAIN_TOPUP')),
    CONSTRAINT cash_in_funding_intents_actor_id_chk CHECK (length(btrim(actor_id)) BETWEEN 1 AND 128),
    CONSTRAINT cash_in_funding_intents_provider_chk CHECK (length(btrim(provider_key)) BETWEEN 1 AND 64),
    CONSTRAINT cash_in_funding_intents_reference_chk CHECK (length(btrim(external_reference)) BETWEEN 1 AND 128),
    CONSTRAINT cash_in_funding_intents_amount_chk CHECK (requested_amount_minor > 0 AND currency='YER'),
    CONSTRAINT cash_in_funding_intents_state_chk CHECK (state IN ('PENDING_PROVIDER','UNKNOWN','FAILED','SETTLED')),
    CONSTRAINT cash_in_funding_intents_version_chk CHECK (version > 0),
    CONSTRAINT cash_in_funding_provider_reference_chk CHECK (provider_reference IS NULL OR length(btrim(provider_reference)) BETWEEN 1 AND 160),
    CONSTRAINT cash_in_funding_intents_settlement_chk CHECK ((state='SETTLED' AND provider_transaction_reference IS NOT NULL AND ledger_transaction_id IS NOT NULL) OR (state<>'SETTLED' AND ledger_transaction_id IS NULL)),
    CONSTRAINT cash_in_funding_intents_provider_ref_uq UNIQUE (provider_key, provider_transaction_reference),
    CONSTRAINT cash_in_funding_intents_ledger_fk FOREIGN KEY (ledger_transaction_id) REFERENCES wlt.ledger_transactions(id) ON DELETE RESTRICT,
    CONSTRAINT cash_in_funding_intents_request_hash_chk CHECK (length(btrim(request_hash))>0),
    CONSTRAINT cash_in_funding_intents_correlation_chk CHECK (length(btrim(correlation_id)) BETWEEN 1 AND 128),
    CONSTRAINT cash_in_funding_intents_reference_uq UNIQUE (provider_key, external_reference)
);

CREATE TABLE wlt.cash_in_funding_intent_events (
    id text PRIMARY KEY,
    funding_intent_id text NOT NULL,
    event_type text NOT NULL,
    provider_transaction_reference text,
    resulting_state text NOT NULL,
    request_hash text NOT NULL,
    idempotency_key text NOT NULL UNIQUE,
    correlation_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT cash_in_funding_intent_events_intent_fk FOREIGN KEY (funding_intent_id) REFERENCES wlt.cash_in_funding_intents(id) ON DELETE RESTRICT,
    CONSTRAINT cash_in_funding_intent_events_type_chk CHECK (event_type IN ('FUNDING_INTENT_CREATED','PROVIDER_RESULT_DELAYED','PROVIDER_RESULT_UNKNOWN','PROVIDER_RESULT_FAILED','PROVIDER_RESULT_CONFIRMED')),
    CONSTRAINT cash_in_funding_intent_events_state_chk CHECK (resulting_state IN ('PENDING_PROVIDER','UNKNOWN','FAILED','SETTLED')),
    CONSTRAINT cash_in_funding_intent_events_hash_chk CHECK (length(btrim(request_hash))>0),
    CONSTRAINT cash_in_funding_intent_events_correlation_chk CHECK (length(btrim(correlation_id)) BETWEEN 1 AND 128)
);

CREATE INDEX cash_in_funding_intents_actor_idx ON wlt.cash_in_funding_intents(actor_type,actor_id,created_at DESC,id DESC);
CREATE INDEX cash_in_funding_intents_state_idx ON wlt.cash_in_funding_intents(state,created_at DESC);
