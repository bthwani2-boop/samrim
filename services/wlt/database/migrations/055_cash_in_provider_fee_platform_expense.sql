-- Provider Cash-In charges belong to the platform, never to Customer or Captain.
-- Preserve historical cash-in as zero fee; no silent reinterpretation.
ALTER TABLE wlt.cash_in_funding_intents
  ADD COLUMN provider_fee_minor bigint NOT NULL DEFAULT 0,
  ADD CONSTRAINT cash_in_funding_intents_provider_fee_chk CHECK (
    provider_fee_minor >= 0 AND provider_fee_minor < requested_amount_minor
    AND (state='SETTLED' OR provider_fee_minor=0)
  );

ALTER TABLE wlt.ledger_entries
  DROP CONSTRAINT ledger_entries_code_chk,
  ADD CONSTRAINT ledger_entries_code_chk CHECK (account_code IN (
    'CAPTAIN_CASH_RECEIVABLE','CUSTOMER_PAYMENT_CLEARING','PARTNER_WALLET',
    'CAPTAIN_WALLET','FIELD_WALLET','PLATFORM_COMMISSION_INCOME',
    'FIELD_ACQUISITION_REWARD_EXPENSE','EXTERNAL_SETTLEMENT_CASH',
    'PARTNER_COMMISSION_RECEIVABLE','CUSTOMER_WALLET',
    'BTHWANI_PROMOTION_EXPENSE','CUSTOMER_COMPENSATION_EXPENSE',
    'PLATFORM_DELIVERY_MARGIN_INCOME','PLATFORM_CASH_IN_PROVIDER_FEE_EXPENSE'
  ));
