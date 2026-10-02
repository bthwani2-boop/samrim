ALTER TABLE wlt.field_commission_earnings
    ADD COLUMN joining_case_id text,
    ADD COLUMN partner_actor_id text,
    ADD CONSTRAINT field_commission_earnings_acquisition_pair_chk
        CHECK ((joining_case_id IS NULL AND partner_actor_id IS NULL) OR
               (length(btrim(joining_case_id)) BETWEEN 1 AND 128 AND length(btrim(partner_actor_id)) BETWEEN 1 AND 128));

CREATE UNIQUE INDEX field_commission_earnings_joining_case_uq
    ON wlt.field_commission_earnings(joining_case_id)
    WHERE joining_case_id IS NOT NULL;

CREATE INDEX field_commission_earnings_partner_idx
    ON wlt.field_commission_earnings(partner_actor_id, created_at DESC)
    WHERE partner_actor_id IS NOT NULL;

ALTER TABLE wlt.field_commission_policies RENAME TO field_acquisition_reward_policies;
ALTER TABLE wlt.field_commission_earnings RENAME TO field_acquisition_entitlements;

ALTER TABLE wlt.field_acquisition_reward_policies
    RENAME CONSTRAINT field_commission_policies_pkey TO field_acquisition_reward_policies_pkey;
ALTER TABLE wlt.field_acquisition_reward_policies
    RENAME CONSTRAINT field_commission_policies_scope_chk TO field_acquisition_reward_policies_scope_chk;
ALTER TABLE wlt.field_acquisition_reward_policies
    RENAME CONSTRAINT field_commission_policies_reward_chk TO field_acquisition_reward_policies_reward_chk;
ALTER TABLE wlt.field_acquisition_reward_policies
    RENAME CONSTRAINT field_commission_policies_rounding_chk TO field_acquisition_reward_policies_rounding_chk;
ALTER TABLE wlt.field_acquisition_reward_policies
    RENAME CONSTRAINT field_commission_policies_state_chk TO field_acquisition_reward_policies_state_chk;
ALTER TABLE wlt.field_acquisition_reward_policies
    RENAME CONSTRAINT field_commission_policies_version_chk TO field_acquisition_reward_policies_version_chk;
ALTER TABLE wlt.field_acquisition_reward_policies
    RENAME CONSTRAINT field_commission_policies_creator_chk TO field_acquisition_reward_policies_creator_chk;
ALTER TABLE wlt.field_acquisition_reward_policies
    RENAME CONSTRAINT field_commission_policies_idempotency_uq TO field_acquisition_reward_policies_idempotency_uq;
ALTER INDEX wlt.field_commission_policies_active_scope_uq RENAME TO field_acquisition_reward_policies_active_scope_uq;
ALTER INDEX wlt.field_commission_policies_scope_idx RENAME TO field_acquisition_reward_policies_scope_idx;

ALTER TABLE wlt.field_acquisition_entitlements
    RENAME CONSTRAINT field_commission_earnings_pkey TO field_acquisition_entitlements_pkey;
ALTER TABLE wlt.field_acquisition_entitlements
    RENAME CONSTRAINT field_commission_earnings_ledger_transaction_id_key TO field_acquisition_entitlements_ledger_transaction_id_key;
ALTER TABLE wlt.field_acquisition_entitlements
    RENAME CONSTRAINT field_commission_earnings_idempotency_key_key TO field_acquisition_entitlements_idempotency_key_key;
ALTER TABLE wlt.field_acquisition_entitlements
    RENAME CONSTRAINT field_commission_earnings_field_actor_chk TO field_acquisition_entitlements_field_actor_chk;
ALTER TABLE wlt.field_acquisition_entitlements
    RENAME CONSTRAINT field_commission_earnings_vertical_chk TO field_acquisition_entitlements_vertical_chk;
ALTER TABLE wlt.field_acquisition_entitlements
    RENAME CONSTRAINT field_commission_earnings_policy_fk TO field_acquisition_entitlements_policy_fk;
ALTER TABLE wlt.field_acquisition_entitlements
    RENAME CONSTRAINT field_commission_earnings_policy_version_chk TO field_acquisition_entitlements_policy_version_chk;
ALTER TABLE wlt.field_acquisition_entitlements
    RENAME CONSTRAINT field_commission_earnings_reward_chk TO field_acquisition_entitlements_reward_chk;
ALTER TABLE wlt.field_acquisition_entitlements
    RENAME CONSTRAINT field_commission_earnings_currency_chk TO field_acquisition_entitlements_currency_chk;
ALTER TABLE wlt.field_acquisition_entitlements
    RENAME CONSTRAINT field_commission_earnings_ledger_fk TO field_acquisition_entitlements_ledger_fk;
ALTER INDEX wlt.field_commission_earnings_actor_idx RENAME TO field_acquisition_entitlements_actor_idx;
ALTER TABLE wlt.field_acquisition_entitlements
    RENAME CONSTRAINT field_commission_earnings_acquisition_pair_chk TO field_acquisition_entitlements_acquisition_pair_chk;
ALTER INDEX wlt.field_commission_earnings_joining_case_uq RENAME TO field_acquisition_entitlements_joining_case_uq;
ALTER INDEX wlt.field_commission_earnings_partner_idx RENAME TO field_acquisition_entitlements_partner_idx;

ALTER TABLE wlt.field_acquisition_reward_policies
    RENAME CONSTRAINT field_commission_policies_active_vertical_chk TO field_acquisition_reward_policies_active_vertical_chk;
UPDATE wlt.ledger_entries SET account_code='FIELD_ACQUISITION_REWARD_EXPENSE' WHERE account_code='FIELD_COMMISSION_EXPENSE';
UPDATE wlt.ledger_transactions SET transaction_type='FIELD_ACQUISITION_ENTITLEMENT_POSTED' WHERE transaction_type='FIELD_COMMISSION_EARNING_POSTED';
UPDATE wlt.ledger_transactions SET source_type='PARTNER_STORE_CLIENT_VISIBLE' WHERE source_type='STORE_CLIENT_VISIBLE' AND transaction_type='FIELD_ACQUISITION_ENTITLEMENT_POSTED';

ALTER TABLE wlt.ledger_entries
    DROP CONSTRAINT ledger_entries_code_chk,
    ADD CONSTRAINT ledger_entries_code_chk CHECK (account_code IN ('CAPTAIN_CASH_RECEIVABLE', 'CUSTOMER_PAYMENT_CLEARING', 'PARTNER_WALLET', 'CAPTAIN_WALLET', 'FIELD_WALLET', 'PLATFORM_COMMISSION_INCOME', 'FIELD_ACQUISITION_REWARD_EXPENSE', 'EXTERNAL_SETTLEMENT_CASH', 'PARTNER_COMMISSION_RECEIVABLE', 'CUSTOMER_WALLET'));
