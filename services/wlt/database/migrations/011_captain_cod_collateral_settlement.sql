-- Correct Captain COD collateral semantics without mutating already-applied migrations.
-- Opening funding is an asset received by BThwani, COD finalization preserves the risk hold,
-- and remittance closes the Captain cash receivable before releasing that hold.

ALTER TABLE wlt.captain_cod_reservations
    ADD COLUMN remitted_at timestamptz;

ALTER TABLE wlt.captain_cod_reservations
    DROP CONSTRAINT captain_cod_reservations_state_chk,
    DROP CONSTRAINT captain_cod_reservations_terminal_time_chk;

ALTER TABLE wlt.captain_cod_reservation_events
    DROP CONSTRAINT captain_cod_reservation_events_type_chk,
    ADD CONSTRAINT captain_cod_reservation_events_type_chk CHECK (event_type IN ('CAPTAIN_COD_RESERVED', 'CAPTAIN_COD_RELEASED', 'CAPTAIN_COD_FINALIZED', 'CAPTAIN_COD_REMITTED'));

-- Historical opening-funding debits represented real cash received by BThwani,
-- not a receivable from the Captain.
UPDATE wlt.ledger_entries e
SET account_code='EXTERNAL_SETTLEMENT_CASH'
FROM wlt.ledger_transactions t
WHERE e.transaction_id=t.id
  AND t.source_type='CAPTAIN_OPENING_FUNDING'
  AND e.direction='DEBIT'
  AND e.account_code='CAPTAIN_CASH_RECEIVABLE';

-- Remove the old delivery-time collateral consumption entries.
DELETE FROM wlt.ledger_entries e
USING wlt.captain_cod_reservations r
WHERE r.ledger_transaction_id IS NOT NULL
  AND e.transaction_id=r.ledger_transaction_id;

UPDATE wlt.captain_cod_reservations
SET ledger_transaction_id=NULL
WHERE ledger_transaction_id IS NOT NULL;

DELETE FROM wlt.ledger_transactions
WHERE source_type='CAPTAIN_COD_RESERVATION';

-- Backfill ledger truth for cash already remitted under the previous model.
INSERT INTO wlt.ledger_transactions(id,transaction_type,source_type,source_id,currency,idempotency_key,request_hash,correlation_id)
SELECT
    'cash-remit-ledger-' || md5(r.id),
    'CAPTAIN_CASH_REMITTED',
    'CASH_REMITTANCE',
    r.id,
    r.currency,
    'cash-remit-ledger-' || md5(r.id),
    r.request_hash,
    r.correlation_id
FROM wlt.cash_remittances r
ON CONFLICT (source_type,source_id) DO NOTHING;

INSERT INTO wlt.ledger_entries(transaction_id,line_sequence,account_class,account_code,actor_type,actor_id,direction,amount_minor,currency)
SELECT t.id,1,'asset','EXTERNAL_SETTLEMENT_CASH',NULL,NULL,'DEBIT',r.amount_minor,r.currency
FROM wlt.cash_remittances r
JOIN wlt.ledger_transactions t ON t.source_type='CASH_REMITTANCE' AND t.source_id=r.id
WHERE NOT EXISTS (
    SELECT 1 FROM wlt.ledger_entries e WHERE e.transaction_id=t.id AND e.line_sequence=1
);

INSERT INTO wlt.ledger_entries(transaction_id,line_sequence,account_class,account_code,actor_type,actor_id,direction,amount_minor,currency)
SELECT t.id,2,'asset','CAPTAIN_CASH_RECEIVABLE',NULL,NULL,'CREDIT',r.amount_minor,r.currency
FROM wlt.cash_remittances r
JOIN wlt.ledger_transactions t ON t.source_type='CASH_REMITTANCE' AND t.source_id=r.id
WHERE NOT EXISTS (
    SELECT 1 FROM wlt.ledger_entries e WHERE e.transaction_id=t.id AND e.line_sequence=2
);

UPDATE wlt.captain_cod_reservations cr
SET state='REMITTED',
    remitted_at=r.created_at,
    updated_at=GREATEST(cr.updated_at,r.created_at)
FROM wlt.cash_remittances r
WHERE cr.payment_intent_id=r.payment_intent_id
  AND cr.captain_actor_id=r.captain_actor_id
  AND cr.state='FINALIZED';

INSERT INTO wlt.captain_cod_reservation_events(id,reservation_id,event_type,idempotency_key,request_hash,correlation_id,created_at)
SELECT
    'captain-cod-remit-' || md5(cr.id),
    cr.id,
    'CAPTAIN_COD_REMITTED',
    'captain-cod-remit-' || md5(cr.id),
    r.request_hash,
    r.correlation_id,
    r.created_at
FROM wlt.captain_cod_reservations cr
JOIN wlt.cash_remittances r ON r.payment_intent_id=cr.payment_intent_id AND r.captain_actor_id=cr.captain_actor_id
WHERE cr.state='REMITTED'
  AND NOT EXISTS (
    SELECT 1 FROM wlt.captain_cod_reservation_events e
    WHERE e.reservation_id=cr.id AND e.event_type='CAPTAIN_COD_REMITTED'
  );

ALTER TABLE wlt.captain_cod_reservations
    DROP CONSTRAINT captain_cod_reservations_ledger_fk,
    DROP COLUMN ledger_transaction_id,
    ADD CONSTRAINT captain_cod_reservations_state_chk CHECK (state IN ('ACTIVE', 'RELEASED', 'FINALIZED', 'REMITTED')),
    ADD CONSTRAINT captain_cod_reservations_terminal_time_chk CHECK (
        (state='ACTIVE' AND released_at IS NULL AND finalized_at IS NULL AND remitted_at IS NULL)
        OR (state='RELEASED' AND released_at IS NOT NULL AND finalized_at IS NULL AND remitted_at IS NULL)
        OR (state='FINALIZED' AND released_at IS NULL AND finalized_at IS NOT NULL AND remitted_at IS NULL)
        OR (state='REMITTED' AND released_at IS NULL AND finalized_at IS NOT NULL AND remitted_at IS NOT NULL)
    );

CREATE INDEX captain_cod_reservations_unremitted_idx
    ON wlt.captain_cod_reservations(captain_actor_id, state, created_at DESC)
    WHERE state IN ('ACTIVE','FINALIZED');
