-- A Finance-reviewed customer compensation is a terminal resolution of its
-- corresponding order-adjustment financial case. Keep the original cause and
-- immutable customer compensation ledger entry; only the case state advances.
ALTER TABLE wlt.order_adjustment_reconciliation_cases
  DROP CONSTRAINT order_adjustment_reconciliation_case_state_chk,
  ADD CONSTRAINT order_adjustment_reconciliation_case_state_chk
    CHECK (state IN ('RECONCILIATION_REQUIRED', 'COMPENSATED'));

-- Existing proven compensation records close their own prior review cases.
-- No wallet balance or ledger entry is rewritten by this migration.
UPDATE wlt.order_adjustment_reconciliation_cases c
SET state='COMPENSATED'
WHERE c.state='RECONCILIATION_REQUIRED'
  AND EXISTS (SELECT 1 FROM wlt.customer_wallet_compensations w WHERE w.case_id=c.id);
