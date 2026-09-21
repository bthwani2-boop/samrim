CREATE TABLE wlt.ledger_transactions (
    id text PRIMARY KEY,
    transaction_type text NOT NULL,
    source_type text NOT NULL,
    source_id text NOT NULL,
    currency text NOT NULL DEFAULT 'YER',
    idempotency_key text NOT NULL,
    request_hash text NOT NULL,
    correlation_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT ledger_transactions_currency_chk CHECK (currency = 'YER'),
    CONSTRAINT ledger_transactions_source_chk CHECK (length(btrim(source_type)) BETWEEN 1 AND 64 AND length(btrim(source_id)) BETWEEN 1 AND 128),
    CONSTRAINT ledger_transactions_idempotency_uq UNIQUE (idempotency_key),
    CONSTRAINT ledger_transactions_source_uq UNIQUE (source_type, source_id)
);

CREATE TABLE wlt.ledger_entries (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    transaction_id text NOT NULL,
    line_sequence integer NOT NULL,
    account_class text NOT NULL,
    account_code text NOT NULL,
    actor_type text,
    actor_id text,
    direction text NOT NULL,
    amount_minor bigint NOT NULL,
    currency text NOT NULL DEFAULT 'YER',
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT ledger_entries_transaction_fk FOREIGN KEY (transaction_id) REFERENCES wlt.ledger_transactions(id) ON DELETE RESTRICT,
    CONSTRAINT ledger_entries_sequence_uq UNIQUE (transaction_id, line_sequence),
    CONSTRAINT ledger_entries_class_chk CHECK (account_class IN ('asset', 'liability', 'income', 'expense')),
    CONSTRAINT ledger_entries_code_chk CHECK (account_code IN ('CAPTAIN_CASH_RECEIVABLE', 'CUSTOMER_PAYMENT_CLEARING', 'PARTNER_WALLET', 'CAPTAIN_WALLET', 'PLATFORM_COMMISSION_INCOME')),
    CONSTRAINT ledger_entries_direction_chk CHECK (direction IN ('DEBIT', 'CREDIT')),
    CONSTRAINT ledger_entries_amount_chk CHECK (amount_minor > 0),
    CONSTRAINT ledger_entries_currency_chk CHECK (currency = 'YER'),
    CONSTRAINT ledger_entries_actor_chk CHECK ((account_code IN ('PARTNER_WALLET', 'CAPTAIN_WALLET') AND actor_type IS NOT NULL AND actor_id IS NOT NULL) OR (account_code NOT IN ('PARTNER_WALLET', 'CAPTAIN_WALLET') AND actor_type IS NULL AND actor_id IS NULL))
);

CREATE INDEX ledger_entries_actor_idx ON wlt.ledger_entries(account_code, actor_id, direction, created_at DESC);
CREATE INDEX ledger_entries_transaction_idx ON wlt.ledger_entries(transaction_id, line_sequence);

CREATE TABLE wlt.partner_order_earnings (
    order_id text PRIMARY KEY,
    payment_intent_id text NOT NULL,
    partner_actor_id text NOT NULL,
    captain_actor_id text NOT NULL,
    currency text NOT NULL DEFAULT 'YER',
    gross_product_minor bigint NOT NULL,
    delivery_fee_minor bigint NOT NULL,
    commission_minor bigint NOT NULL,
    partner_net_minor bigint NOT NULL,
    profile_id text NOT NULL,
    profile_version integer NOT NULL,
    policy_version text NOT NULL,
    ledger_transaction_id text NOT NULL UNIQUE,
    idempotency_key text NOT NULL UNIQUE,
    request_hash text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT partner_order_earnings_ledger_fk FOREIGN KEY (ledger_transaction_id) REFERENCES wlt.ledger_transactions(id) ON DELETE RESTRICT,
    CONSTRAINT partner_order_earnings_currency_chk CHECK (currency = 'YER'),
    CONSTRAINT partner_order_earnings_amounts_chk CHECK (gross_product_minor >= 0 AND delivery_fee_minor >= 0 AND commission_minor >= 0 AND partner_net_minor >= 0),
    CONSTRAINT partner_order_earnings_profile_version_chk CHECK (profile_version > 0),
    CONSTRAINT partner_order_earnings_policy_chk CHECK (length(btrim(policy_version)) BETWEEN 1 AND 128)
);

CREATE INDEX partner_order_earnings_partner_idx ON wlt.partner_order_earnings(partner_actor_id, created_at DESC, order_id);
CREATE INDEX partner_order_earnings_payment_idx ON wlt.partner_order_earnings(payment_intent_id);
