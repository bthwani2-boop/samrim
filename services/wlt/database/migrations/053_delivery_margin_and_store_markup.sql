-- Frozen Store agreement markup and transaction-level delivery revenue split.
-- Historical rows keep zero margin and their original Captain entitlement.
ALTER TABLE wlt.store_commercial_agreement_rates
  ADD COLUMN delivery_markup_minor bigint NOT NULL DEFAULT 0,
  ADD CONSTRAINT store_commercial_agreement_rates_markup_chk
    CHECK (delivery_markup_minor BETWEEN 0 AND 10000
      AND (delivery_markup_minor = 0 OR
        (fulfillment_mode = 'BTHWANI_CAPTAIN' AND commission_rate_bps = 0)));

ALTER TABLE wlt.customer_payment_allocations
  ADD COLUMN delivery_margin_minor bigint NOT NULL DEFAULT 0,
  ADD CONSTRAINT customer_payment_allocations_margin_chk
    CHECK (delivery_margin_minor >= 0
      AND delivery_margin_minor <= delivery_fee_minor
      AND (delivery_margin_minor = 0 OR fulfillment_mode = 'BTHWANI_CAPTAIN'));

ALTER TABLE wlt.partner_order_earnings
  ADD COLUMN delivery_margin_minor bigint NOT NULL DEFAULT 0,
  ADD CONSTRAINT partner_order_earnings_margin_chk
    CHECK (delivery_margin_minor >= 0);

-- Platform margin is a distinct income account; it must never be misclassified
-- as Captain earnings or folded into platform product commission.
ALTER TABLE wlt.ledger_entries
  DROP CONSTRAINT ledger_entries_code_chk,
  ADD CONSTRAINT ledger_entries_code_chk CHECK (account_code IN (
    'CAPTAIN_CASH_RECEIVABLE','CUSTOMER_PAYMENT_CLEARING','PARTNER_WALLET',
    'CAPTAIN_WALLET','FIELD_WALLET','PLATFORM_COMMISSION_INCOME',
    'FIELD_ACQUISITION_REWARD_EXPENSE','EXTERNAL_SETTLEMENT_CASH',
    'PARTNER_COMMISSION_RECEIVABLE','CUSTOMER_WALLET',
    'BTHWANI_PROMOTION_EXPENSE','CUSTOMER_COMPENSATION_EXPENSE',
    'PLATFORM_DELIVERY_MARGIN_INCOME'
  ));
