ALTER TABLE wlt.finance_evidence_documents
    DROP CONSTRAINT finance_evidence_documents_purpose_chk,
    ADD CONSTRAINT finance_evidence_documents_purpose_chk CHECK (purpose IN ('TRANSFER_RECEIPT','SETTLEMENT_STATEMENT','SETTLEMENT_BATCH_EXPORT','CUSTOMER_WITHDRAWAL_REQUEST'));

CREATE TABLE wlt.settlement_batch_exports (
    id text PRIMARY KEY,
    batch_id text NOT NULL,
    evidence_document_id text NOT NULL UNIQUE,
    generated_by text NOT NULL,
    row_count integer NOT NULL,
    total_amount_minor bigint NOT NULL,
    currency text NOT NULL DEFAULT 'YER',
    file_sha256 text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    idempotency_key text NOT NULL UNIQUE,
    request_hash text NOT NULL,
    correlation_id text NOT NULL,
    CONSTRAINT settlement_batch_exports_batch_fk FOREIGN KEY (batch_id) REFERENCES wlt.settlement_batches(id) ON DELETE RESTRICT,
    CONSTRAINT settlement_batch_exports_document_fk FOREIGN KEY (evidence_document_id) REFERENCES wlt.finance_evidence_documents(id) ON DELETE RESTRICT,
    CONSTRAINT settlement_batch_exports_actor_chk CHECK (length(btrim(generated_by)) BETWEEN 1 AND 128),
    CONSTRAINT settlement_batch_exports_totals_chk CHECK (row_count > 0 AND total_amount_minor > 0 AND currency = 'YER'),
    CONSTRAINT settlement_batch_exports_sha_chk CHECK (file_sha256 ~ '^[0-9a-f]{64}$'),
    CONSTRAINT settlement_batch_exports_hash_chk CHECK (length(btrim(request_hash)) > 0),
    CONSTRAINT settlement_batch_exports_correlation_chk CHECK (length(btrim(correlation_id)) BETWEEN 1 AND 128)
);

CREATE INDEX settlement_batch_exports_batch_idx ON wlt.settlement_batch_exports(batch_id, created_at DESC);

ALTER TABLE wlt.payout_audit_events
    DROP CONSTRAINT payout_audit_events_event_chk,
    ADD CONSTRAINT payout_audit_events_event_chk CHECK (event_type IN ('PAYOUT_PREPARED', 'PAYOUT_APPROVED', 'PAYOUT_CANCELLED', 'BATCH_CREATED', 'BATCH_APPROVED', 'BATCH_FROZEN', 'TRANSFER_EXECUTED', 'TRANSFER_VERIFIED', 'TRANSFER_RECONCILED', 'PAYOUT_COMPLETED', 'FINANCE_EVIDENCE_UPLOADED', 'SETTLEMENT_STATEMENT_REGISTERED', 'SETTLEMENT_STATEMENT_ROW_RECORDED', 'SETTLEMENT_BATCH_EXPORTED'));
