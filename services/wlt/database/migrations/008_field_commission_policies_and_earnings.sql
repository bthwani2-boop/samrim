ALTER TABLE wlt.ledger_entries
    DROP CONSTRAINT ledger_entries_code_chk,
    ADD CONSTRAINT ledger_entries_code_chk CHECK (account_code IN ('CAPTAIN_CASH_RECEIVABLE', 'CUSTOMER_PAYMENT_CLEARING', 'PARTNER_WALLET', 'CAPTAIN_WALLET', 'FIELD_WALLET', 'PLATFORM_COMMISSION_INCOME', 'FIELD_COMMISSION_EXPENSE'));

CREATE TABLE wlt.field_commission_policies (
    id text PRIMARY KEY,
    scope_type text NOT NULL,
    scope_id text,
    reward_minor bigint NOT NULL,
    rounding_unit_minor bigint NOT NULL DEFAULT 50,
    state text NOT NULL DEFAULT 'ACTIVE',
    version integer NOT NULL DEFAULT 1,
    created_by text NOT NULL,
    idempotency_key text NOT NULL,
    request_hash text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    retired_at timestamptz,
    CONSTRAINT field_commission_policies_scope_chk CHECK ((scope_type = 'DEFAULT' AND scope_id IS NULL) OR (scope_type IN ('VERTICAL', 'STORE') AND length(btrim(scope_id)) BETWEEN 1 AND 128)),
    CONSTRAINT field_commission_policies_reward_chk CHECK (reward_minor > 0),
    CONSTRAINT field_commission_policies_rounding_chk CHECK (rounding_unit_minor = 50),
    CONSTRAINT field_commission_policies_state_chk CHECK ((state = 'ACTIVE' AND retired_at IS NULL) OR (state = 'RETIRED' AND retired_at IS NOT NULL)),
    CONSTRAINT field_commission_policies_version_chk CHECK (version > 0),
    CONSTRAINT field_commission_policies_creator_chk CHECK (length(btrim(created_by)) BETWEEN 1 AND 128),
    CONSTRAINT field_commission_policies_idempotency_uq UNIQUE (idempotency_key)
);

CREATE UNIQUE INDEX field_commission_policies_active_scope_uq
    ON wlt.field_commission_policies(scope_type, COALESCE(scope_id, ''))
    WHERE state = 'ACTIVE';
CREATE INDEX field_commission_policies_scope_idx
    ON wlt.field_commission_policies(scope_type, scope_id, state, created_at DESC);

CREATE TABLE wlt.field_commission_earnings (
    store_id text PRIMARY KEY,
    field_actor_id text NOT NULL,
    vertical_id text NOT NULL,
    policy_id text NOT NULL,
    policy_version integer NOT NULL,
    reward_minor bigint NOT NULL,
    currency text NOT NULL DEFAULT 'YER',
    ledger_transaction_id text NOT NULL UNIQUE,
    idempotency_key text NOT NULL UNIQUE,
    request_hash text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT field_commission_earnings_field_actor_chk CHECK (length(btrim(field_actor_id)) BETWEEN 1 AND 128),
    CONSTRAINT field_commission_earnings_vertical_chk CHECK (length(btrim(vertical_id)) BETWEEN 1 AND 128),
    CONSTRAINT field_commission_earnings_policy_fk FOREIGN KEY (policy_id) REFERENCES wlt.field_commission_policies(id) ON DELETE RESTRICT,
    CONSTRAINT field_commission_earnings_policy_version_chk CHECK (policy_version > 0),
    CONSTRAINT field_commission_earnings_reward_chk CHECK (reward_minor > 0),
    CONSTRAINT field_commission_earnings_currency_chk CHECK (currency = 'YER'),
    CONSTRAINT field_commission_earnings_ledger_fk FOREIGN KEY (ledger_transaction_id) REFERENCES wlt.ledger_transactions(id) ON DELETE RESTRICT
);

CREATE INDEX field_commission_earnings_actor_idx
    ON wlt.field_commission_earnings(field_actor_id, created_at DESC, store_id);
