ALTER TABLE wlt.payment_intents
    DROP CONSTRAINT payment_intents_method_chk,
    ADD CONSTRAINT payment_intents_method_chk CHECK (method IN ('CASH_ON_DELIVERY', 'CASH_AT_STORE'));

ALTER TABLE wlt.ledger_entries
    DROP CONSTRAINT ledger_entries_code_chk,
    ADD CONSTRAINT ledger_entries_code_chk CHECK (account_code IN ('CAPTAIN_CASH_RECEIVABLE', 'CUSTOMER_PAYMENT_CLEARING', 'PARTNER_WALLET', 'CAPTAIN_WALLET', 'FIELD_WALLET', 'PLATFORM_COMMISSION_INCOME', 'FIELD_COMMISSION_EXPENSE', 'EXTERNAL_SETTLEMENT_CASH', 'PARTNER_COMMISSION_RECEIVABLE')),
    DROP CONSTRAINT ledger_entries_actor_chk,
    ADD CONSTRAINT ledger_entries_actor_chk CHECK (
        (account_code IN ('PARTNER_WALLET', 'CAPTAIN_WALLET', 'FIELD_WALLET') AND actor_type IS NOT NULL AND actor_id IS NOT NULL)
        OR (account_code = 'PARTNER_COMMISSION_RECEIVABLE' AND actor_type = 'partner' AND actor_id IS NOT NULL)
        OR (account_code NOT IN ('PARTNER_WALLET', 'CAPTAIN_WALLET', 'FIELD_WALLET', 'PARTNER_COMMISSION_RECEIVABLE') AND actor_type IS NULL AND actor_id IS NULL)
    );

ALTER TABLE wlt.partner_order_earnings
    ADD COLUMN commission_receivable_offset_minor bigint NOT NULL DEFAULT 0,
    ADD CONSTRAINT partner_order_earnings_receivable_offset_chk CHECK (commission_receivable_offset_minor >= 0 AND commission_receivable_offset_minor <= partner_net_minor);

CREATE TABLE wlt.partner_store_pickup_commissions (
    order_id text PRIMARY KEY,
    payment_intent_id text NOT NULL UNIQUE,
    partner_actor_id text NOT NULL,
    currency text NOT NULL DEFAULT 'YER',
    gross_product_minor bigint NOT NULL,
    commission_minor bigint NOT NULL,
    profile_id text NOT NULL,
    profile_version integer NOT NULL,
    policy_version text NOT NULL,
    ledger_transaction_id text UNIQUE,
    idempotency_key text NOT NULL UNIQUE,
    request_hash text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT partner_store_pickup_commissions_payment_fk FOREIGN KEY (payment_intent_id) REFERENCES wlt.payment_intents(id) ON DELETE RESTRICT,
    CONSTRAINT partner_store_pickup_commissions_ledger_fk FOREIGN KEY (ledger_transaction_id) REFERENCES wlt.ledger_transactions(id) ON DELETE RESTRICT,
    CONSTRAINT partner_store_pickup_commissions_currency_chk CHECK (currency = 'YER'),
    CONSTRAINT partner_store_pickup_commissions_amounts_chk CHECK (gross_product_minor >= 0 AND commission_minor >= 0 AND commission_minor <= gross_product_minor),
    CONSTRAINT partner_store_pickup_commissions_profile_version_chk CHECK (profile_version > 0),
    CONSTRAINT partner_store_pickup_commissions_policy_chk CHECK (length(btrim(policy_version)) BETWEEN 1 AND 128),
    CONSTRAINT partner_store_pickup_commissions_idempotency_chk CHECK (length(btrim(idempotency_key)) BETWEEN 8 AND 128)
);

CREATE INDEX partner_store_pickup_commissions_partner_idx ON wlt.partner_store_pickup_commissions(partner_actor_id, created_at DESC, order_id);

CREATE TABLE wlt.partner_commission_remittances (
    id text PRIMARY KEY,
    partner_actor_id text NOT NULL,
    amount_minor bigint NOT NULL,
    currency text NOT NULL DEFAULT 'YER',
    remittance_reference text NOT NULL,
    evidence_reference text NOT NULL,
    verified_by text NOT NULL,
    verified_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    ledger_transaction_id text NOT NULL UNIQUE,
    idempotency_key text NOT NULL UNIQUE,
    request_hash text NOT NULL,
    correlation_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT partner_commission_remittances_ledger_fk FOREIGN KEY (ledger_transaction_id) REFERENCES wlt.ledger_transactions(id) ON DELETE RESTRICT,
    CONSTRAINT partner_commission_remittances_amount_chk CHECK (amount_minor > 0),
    CONSTRAINT partner_commission_remittances_currency_chk CHECK (currency = 'YER'),
    CONSTRAINT partner_commission_remittances_reference_chk CHECK (length(btrim(remittance_reference)) BETWEEN 1 AND 128 AND length(btrim(evidence_reference)) BETWEEN 1 AND 512),
    CONSTRAINT partner_commission_remittances_verifier_chk CHECK (length(btrim(verified_by)) BETWEEN 1 AND 128),
    CONSTRAINT partner_commission_remittances_idempotency_chk CHECK (length(btrim(idempotency_key)) BETWEEN 8 AND 128),
    CONSTRAINT partner_commission_remittances_correlation_chk CHECK (length(btrim(correlation_id)) BETWEEN 8 AND 128)
);

CREATE INDEX partner_commission_remittances_partner_idx ON wlt.partner_commission_remittances(partner_actor_id, created_at DESC, id);
