-- A Captain's reference is a submission, not proof that WLT received the cash.
-- Reopen prior self-attested remittances until Finance attaches receipt evidence
-- and records the independent reconciliation.

ALTER TABLE wlt.cash_remittances
    ADD COLUMN reconciled_by text,
    ADD COLUMN reconciled_at timestamptz,
    ADD COLUMN receipt_document_id text;

ALTER TABLE wlt.cash_remittances
    DROP CONSTRAINT cash_remittances_state_chk;

UPDATE wlt.cash_remittances
SET state='SUBMITTED'
WHERE state='REMITTED';

ALTER TABLE wlt.cash_remittances
    ALTER COLUMN state SET DEFAULT 'SUBMITTED',
    ADD CONSTRAINT cash_remittances_state_chk CHECK (state IN ('SUBMITTED','REMITTED')),
    ADD CONSTRAINT cash_remittances_reconciliation_chk CHECK (
        (state='SUBMITTED' AND reconciled_by IS NULL AND reconciled_at IS NULL AND receipt_document_id IS NULL)
        OR (state='REMITTED' AND reconciled_by IS NOT NULL AND length(btrim(reconciled_by)) BETWEEN 1 AND 128 AND reconciled_at IS NOT NULL AND receipt_document_id IS NOT NULL)
    ),
    ADD CONSTRAINT cash_remittances_receipt_document_fk FOREIGN KEY (receipt_document_id) REFERENCES wlt.finance_evidence_documents(id) ON DELETE RESTRICT;

ALTER TABLE wlt.cash_remittance_events
    ADD COLUMN remittance_reference text NOT NULL DEFAULT '',
    ADD COLUMN finance_actor_id text,
    ADD COLUMN evidence_document_id text;

UPDATE wlt.cash_remittance_events e
SET remittance_reference=r.remittance_reference
FROM wlt.cash_remittances r
WHERE r.id=e.remittance_id;

ALTER TABLE wlt.cash_remittance_events
    ALTER COLUMN remittance_reference DROP DEFAULT,
    DROP CONSTRAINT cash_remittance_events_type_chk,
    ADD CONSTRAINT cash_remittance_events_type_chk CHECK (event_type IN (
        'CASH_REMITTED',
        'CASH_REMITTANCE_SUBMITTED',
        'CASH_REMITTANCE_REFERENCE_UPDATED',
        'CASH_REMITTANCE_REOPENED',
        'CASH_REMITTANCE_RECONCILED'
    )),
    ADD CONSTRAINT cash_remittance_events_reference_chk CHECK (char_length(remittance_reference) BETWEEN 1 AND 128),
    ADD CONSTRAINT cash_remittance_events_finance_actor_chk CHECK (finance_actor_id IS NULL OR length(btrim(finance_actor_id)) BETWEEN 1 AND 128),
    ADD CONSTRAINT cash_remittance_events_evidence_fk FOREIGN KEY (evidence_document_id) REFERENCES wlt.finance_evidence_documents(id) ON DELETE RESTRICT,
    ADD CONSTRAINT cash_remittance_events_reconciliation_chk CHECK (
        (event_type='CASH_REMITTANCE_RECONCILED' AND finance_actor_id IS NOT NULL AND finance_actor_id<>captain_actor_id AND evidence_document_id IS NOT NULL)
        OR (event_type<>'CASH_REMITTANCE_RECONCILED' AND finance_actor_id IS NULL AND evidence_document_id IS NULL)
    );

ALTER TABLE wlt.captain_cod_reservation_events
    DROP CONSTRAINT captain_cod_reservation_events_type_chk,
    ADD CONSTRAINT captain_cod_reservation_events_type_chk CHECK (event_type IN (
        'CAPTAIN_COD_RESERVED',
        'CAPTAIN_COD_RELEASED',
        'CAPTAIN_COD_FINALIZED',
        'CAPTAIN_COD_REMITTED',
        'CAPTAIN_COD_REMITTANCE_REOPENED'
    ));

-- Reverse only ledger receipts that were previously posted from a Captain claim.
-- The original transactions remain immutable and the counter-entry restores the
-- open receivable until the supporting evidence is reconciled.
INSERT INTO wlt.ledger_transactions(id,transaction_type,source_type,source_id,currency,idempotency_key,request_hash,correlation_id)
SELECT
    'cash-remit-reopen-' || md5(r.id),
    'CAPTAIN_CASH_REMITTANCE_REOPENED',
    'CASH_REMITTANCE_REOPENING',
    r.id,
    r.currency,
    'cash-remit-reopen-ledger:' || md5(r.id),
    md5(r.request_hash || ':reopened'),
    r.correlation_id
FROM wlt.cash_remittances r
JOIN wlt.ledger_transactions original ON original.source_type='CASH_REMITTANCE' AND original.source_id=r.id
ON CONFLICT (source_type,source_id) DO NOTHING;

INSERT INTO wlt.ledger_entries(transaction_id,line_sequence,account_class,account_code,actor_type,actor_id,direction,amount_minor,currency)
SELECT reopening.id,1,'asset','CAPTAIN_CASH_RECEIVABLE',NULL,NULL,'DEBIT',r.amount_minor,r.currency
FROM wlt.cash_remittances r
JOIN wlt.ledger_transactions reopening ON reopening.source_type='CASH_REMITTANCE_REOPENING' AND reopening.source_id=r.id
WHERE NOT EXISTS (SELECT 1 FROM wlt.ledger_entries e WHERE e.transaction_id=reopening.id AND e.line_sequence=1);

INSERT INTO wlt.ledger_entries(transaction_id,line_sequence,account_class,account_code,actor_type,actor_id,direction,amount_minor,currency)
SELECT reopening.id,2,'asset','EXTERNAL_SETTLEMENT_CASH',NULL,NULL,'CREDIT',r.amount_minor,r.currency
FROM wlt.cash_remittances r
JOIN wlt.ledger_transactions reopening ON reopening.source_type='CASH_REMITTANCE_REOPENING' AND reopening.source_id=r.id
WHERE NOT EXISTS (SELECT 1 FROM wlt.ledger_entries e WHERE e.transaction_id=reopening.id AND e.line_sequence=2);

INSERT INTO wlt.cash_remittance_events(remittance_id,payment_intent_id,event_type,idempotency_key,request_hash,correlation_id,captain_actor_id,amount_minor,remittance_reference)
SELECT r.id,r.payment_intent_id,'CASH_REMITTANCE_REOPENED','cash-remit-reopen:' || md5(r.id),md5(r.request_hash || ':reopened'),r.correlation_id,r.captain_actor_id,r.amount_minor,r.remittance_reference
FROM wlt.cash_remittances r
ON CONFLICT (idempotency_key) DO NOTHING;

WITH reopened AS (
    UPDATE wlt.captain_cod_reservations cr
    SET state='FINALIZED',remitted_at=NULL,updated_at=clock_timestamp()
    FROM wlt.cash_remittances r
    WHERE cr.payment_intent_id=r.payment_intent_id
      AND cr.captain_actor_id=r.captain_actor_id
      AND cr.state='REMITTED'
    RETURNING cr.id AS reservation_id,r.id AS remittance_id,r.request_hash,r.correlation_id
)
INSERT INTO wlt.captain_cod_reservation_events(id,reservation_id,event_type,idempotency_key,request_hash,correlation_id)
SELECT 'captain-cod-reopen-' || md5(reservation_id),reservation_id,'CAPTAIN_COD_REMITTANCE_REOPENED','captain-cod-reopen:' || md5(remittance_id),md5(request_hash || ':reopened'),correlation_id
FROM reopened
ON CONFLICT (idempotency_key) DO NOTHING;

CREATE INDEX cash_remittances_unreconciled_idx
    ON wlt.cash_remittances(captain_actor_id,created_at DESC,id DESC)
    WHERE state='SUBMITTED';
