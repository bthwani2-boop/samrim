-- Legacy collected COD without a pre-collection hold is a Finance exception,
-- never permission for a retroactive automatic debit. Two distinct Finance
-- operators must record and approve documentary evidence before WLT restores
-- an actual funded hold for the original collecting Captain.
ALTER TABLE wlt.finance_evidence_documents
  DROP CONSTRAINT finance_evidence_documents_purpose_chk,
  ADD CONSTRAINT finance_evidence_documents_purpose_chk CHECK (
    purpose IN ('TRANSFER_RECEIPT','SETTLEMENT_STATEMENT',
      'CUSTOMER_WITHDRAWAL_REQUEST','SETTLEMENT_BATCH_EXPORT',
      'CAPTAIN_COD_LEGACY_RECOVERY')
  );

CREATE TABLE wlt.captain_cod_legacy_recovery_reviews (
  id text PRIMARY KEY,
  payment_intent_id text NOT NULL UNIQUE REFERENCES wlt.payment_intents(id) ON DELETE RESTRICT,
  order_id text NOT NULL UNIQUE,
  captain_actor_id text NOT NULL,
  amount_minor bigint NOT NULL,
  evidence_document_id text NOT NULL UNIQUE REFERENCES wlt.finance_evidence_documents(id) ON DELETE RESTRICT,
  submitted_by text NOT NULL,
  submitted_idempotency_key text NOT NULL UNIQUE,
  submitted_request_hash text NOT NULL,
  submitted_correlation_id text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING',
  approved_by text,
  approved_at timestamptz,
  approval_idempotency_key text UNIQUE,
  approval_correlation_id text,
  reservation_id text UNIQUE REFERENCES wlt.captain_cod_reservations(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT captain_cod_legacy_recovery_actor_chk CHECK (
    length(btrim(order_id)) BETWEEN 1 AND 128
    AND length(btrim(captain_actor_id)) BETWEEN 1 AND 128
    AND length(btrim(submitted_by)) BETWEEN 1 AND 128
    AND amount_minor > 0
  ),
  CONSTRAINT captain_cod_legacy_recovery_mutation_chk CHECK (
    length(btrim(submitted_idempotency_key)) BETWEEN 8 AND 128
    AND length(btrim(submitted_correlation_id)) BETWEEN 8 AND 128
    AND length(btrim(submitted_request_hash)) > 0
  ),
  CONSTRAINT captain_cod_legacy_recovery_status_chk CHECK (
    (status='PENDING' AND approved_by IS NULL AND approved_at IS NULL
      AND approval_idempotency_key IS NULL AND approval_correlation_id IS NULL
      AND reservation_id IS NULL)
    OR (status='APPROVED' AND approved_by IS NOT NULL AND approved_at IS NOT NULL
      AND approval_idempotency_key IS NOT NULL AND approval_correlation_id IS NOT NULL
      AND reservation_id IS NOT NULL AND approved_by <> submitted_by)
  )
);

ALTER TABLE wlt.captain_cod_reservation_events
  DROP CONSTRAINT captain_cod_reservation_events_type_chk,
  ADD CONSTRAINT captain_cod_reservation_events_type_chk CHECK (event_type IN (
    'CAPTAIN_COD_RESERVED', 'CAPTAIN_COD_RELEASED', 'CAPTAIN_COD_FINALIZED',
    'CAPTAIN_COD_REMITTED', 'CAPTAIN_COD_REMITTANCE_REOPENED',
    'CAPTAIN_COD_DEBITED', 'CAPTAIN_COD_LEGACY_RECOVERED'
  ));
