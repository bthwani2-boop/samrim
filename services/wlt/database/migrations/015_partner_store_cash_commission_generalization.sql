ALTER TABLE wlt.partner_store_pickup_commissions
    RENAME TO partner_store_cash_commissions;

ALTER TABLE wlt.partner_store_cash_commissions
    RENAME CONSTRAINT partner_store_pickup_commissions_pkey TO partner_store_cash_commissions_pkey;
ALTER TABLE wlt.partner_store_cash_commissions
    RENAME CONSTRAINT partner_store_pickup_commissions_payment_intent_id_key TO partner_store_cash_commissions_payment_intent_id_key;
ALTER TABLE wlt.partner_store_cash_commissions
    RENAME CONSTRAINT partner_store_pickup_commissions_idempotency_key_key TO partner_store_cash_commissions_idempotency_key_key;
ALTER TABLE wlt.partner_store_cash_commissions
    RENAME CONSTRAINT partner_store_pickup_commissions_ledger_transaction_id_key TO partner_store_cash_commissions_ledger_transaction_id_key;
ALTER TABLE wlt.partner_store_cash_commissions
    RENAME CONSTRAINT partner_store_pickup_commissions_payment_fk TO partner_store_cash_commissions_payment_fk;
ALTER TABLE wlt.partner_store_cash_commissions
    RENAME CONSTRAINT partner_store_pickup_commissions_ledger_fk TO partner_store_cash_commissions_ledger_fk;
ALTER TABLE wlt.partner_store_cash_commissions
    RENAME CONSTRAINT partner_store_pickup_commissions_currency_chk TO partner_store_cash_commissions_currency_chk;
ALTER TABLE wlt.partner_store_cash_commissions
    RENAME CONSTRAINT partner_store_pickup_commissions_amounts_chk TO partner_store_cash_commissions_amounts_chk;
ALTER TABLE wlt.partner_store_cash_commissions
    RENAME CONSTRAINT partner_store_pickup_commissions_profile_version_chk TO partner_store_cash_commissions_profile_version_chk;
ALTER TABLE wlt.partner_store_cash_commissions
    RENAME CONSTRAINT partner_store_pickup_commissions_policy_chk TO partner_store_cash_commissions_policy_chk;
ALTER TABLE wlt.partner_store_cash_commissions
    RENAME CONSTRAINT partner_store_pickup_commissions_idempotency_chk TO partner_store_cash_commissions_idempotency_chk;

ALTER INDEX wlt.partner_store_pickup_commissions_partner_idx
    RENAME TO partner_store_cash_commissions_partner_idx;

ALTER TABLE wlt.partner_store_cash_commissions
    ADD COLUMN fulfillment_mode text;

UPDATE wlt.partner_store_cash_commissions
SET fulfillment_mode='CUSTOMER_PICKUP';

ALTER TABLE wlt.partner_store_cash_commissions
    ALTER COLUMN fulfillment_mode SET NOT NULL,
    ADD CONSTRAINT partner_store_cash_commissions_fulfillment_mode_chk
        CHECK (fulfillment_mode IN ('CUSTOMER_PICKUP','PARTNER_CAPTAIN'));
