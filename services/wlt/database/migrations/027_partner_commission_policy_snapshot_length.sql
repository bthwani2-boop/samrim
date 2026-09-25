ALTER TABLE wlt.partner_order_earnings
    DROP CONSTRAINT partner_order_earnings_policy_chk,
    ADD CONSTRAINT partner_order_earnings_policy_chk
        CHECK (length(btrim(policy_version)) BETWEEN 1 AND 512);

ALTER TABLE wlt.partner_store_cash_commissions
    DROP CONSTRAINT partner_store_cash_commissions_policy_chk,
    ADD CONSTRAINT partner_store_cash_commissions_policy_chk
        CHECK (length(btrim(policy_version)) BETWEEN 1 AND 512);
