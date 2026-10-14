-- Finance-reviewed customer compensation is funded by the platform; it does not silently reverse an already-settled Store earning.
ALTER TABLE wlt.ledger_entries DROP CONSTRAINT ledger_entries_code_chk,
  ADD CONSTRAINT ledger_entries_code_chk CHECK (account_code IN (
    'CAPTAIN_CASH_RECEIVABLE','CUSTOMER_PAYMENT_CLEARING','PARTNER_WALLET',
    'CAPTAIN_WALLET','FIELD_WALLET','PLATFORM_COMMISSION_INCOME',
    'FIELD_ACQUISITION_REWARD_EXPENSE','EXTERNAL_SETTLEMENT_CASH',
    'PARTNER_COMMISSION_RECEIVABLE','CUSTOMER_WALLET','BTHWANI_PROMOTION_EXPENSE',
    'CUSTOMER_COMPENSATION_EXPENSE'
  ));
CREATE TABLE wlt.customer_wallet_compensations (
  case_id text PRIMARY KEY REFERENCES wlt.order_adjustment_reconciliation_cases(id) ON DELETE RESTRICT,
  order_id text NOT NULL,
  customer_actor_id text NOT NULL,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  approved_by_actor_id text NOT NULL,
  evidence_reference text NOT NULL,
  ledger_transaction_id text NOT NULL UNIQUE REFERENCES wlt.ledger_transactions(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL UNIQUE,
  request_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT customer_wallet_compensation_approver_chk CHECK (length(btrim(approved_by_actor_id)) BETWEEN 1 AND 128),
  CONSTRAINT customer_wallet_compensation_evidence_chk CHECK (length(btrim(evidence_reference)) BETWEEN 8 AND 128)
);
CREATE INDEX customer_wallet_compensations_order_idx ON wlt.customer_wallet_compensations(order_id);
