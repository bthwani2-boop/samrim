CREATE TABLE wlt.finance_evidence_documents (
    id text PRIMARY KEY,
    purpose text NOT NULL,
    original_filename text NOT NULL,
    content_type text NOT NULL,
    content_sha256 text NOT NULL,
    content_ciphertext bytea NOT NULL,
    content_size_bytes bigint NOT NULL,
    uploaded_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    idempotency_key text NOT NULL UNIQUE,
    request_hash text NOT NULL,
    correlation_id text NOT NULL,
    CONSTRAINT finance_evidence_documents_purpose_chk CHECK (purpose IN ('TRANSFER_RECEIPT','SETTLEMENT_STATEMENT','CUSTOMER_WITHDRAWAL_REQUEST')),
    CONSTRAINT finance_evidence_documents_name_chk CHECK (length(btrim(original_filename)) BETWEEN 1 AND 255),
    CONSTRAINT finance_evidence_documents_type_chk CHECK (content_type IN ('application/pdf','image/jpeg','image/png','text/csv','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')),
    CONSTRAINT finance_evidence_documents_digest_chk CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
    CONSTRAINT finance_evidence_documents_content_chk CHECK (octet_length(content_ciphertext) > 28 AND content_size_bytes BETWEEN 1 AND 10485760),
    CONSTRAINT finance_evidence_documents_actor_chk CHECK (length(btrim(uploaded_by)) BETWEEN 1 AND 128),
    CONSTRAINT finance_evidence_documents_request_hash_chk CHECK (length(btrim(request_hash)) > 0),
    CONSTRAINT finance_evidence_documents_correlation_chk CHECK (length(btrim(correlation_id)) BETWEEN 1 AND 128)
);

CREATE INDEX finance_evidence_documents_digest_idx ON wlt.finance_evidence_documents(content_sha256, purpose);

ALTER TABLE wlt.manual_transfer_executions
    RENAME COLUMN evidence_reference TO legacy_evidence_reference;

ALTER TABLE wlt.manual_transfer_executions
    RENAME COLUMN statement_reference TO legacy_statement_reference;

ALTER TABLE wlt.manual_transfer_executions
    ADD COLUMN receipt_document_id text,
    ADD COLUMN statement_row_id text,
    ADD CONSTRAINT manual_transfer_receipt_document_fk FOREIGN KEY (receipt_document_id) REFERENCES wlt.finance_evidence_documents(id) ON DELETE RESTRICT,
    ADD CONSTRAINT manual_transfer_receipt_document_uq UNIQUE (receipt_document_id),
    ADD CONSTRAINT manual_transfer_receipt_required_chk CHECK (receipt_document_id IS NOT NULL) NOT VALID,
    ALTER COLUMN legacy_evidence_reference DROP NOT NULL,
    DROP CONSTRAINT manual_transfer_executions_values_chk,
    ADD CONSTRAINT manual_transfer_executions_values_chk CHECK (length(btrim(approved_snapshot_hash)) > 0 AND length(btrim(executed_by)) BETWEEN 1 AND 128 AND length(btrim(provider_key)) BETWEEN 1 AND 64 AND length(btrim(external_transfer_reference)) BETWEEN 1 AND 160 AND amount_minor > 0 AND currency = 'YER' AND destination_version > 0 AND length(btrim(legacy_evidence_reference)) BETWEEN 0 AND 512);

ALTER TABLE wlt.manual_transfer_executions
    DROP CONSTRAINT manual_transfer_executions_reconciliation_chk,
    ADD CONSTRAINT manual_transfer_executions_reconciliation_chk CHECK ((reconciled_by IS NULL AND reconciled_at IS NULL AND statement_row_id IS NULL) OR (reconciled_by IS NOT NULL AND reconciled_at IS NOT NULL AND statement_row_id IS NOT NULL)) NOT VALID;

CREATE TABLE wlt.settlement_statements (
    id text PRIMARY KEY,
    batch_id text,
    provider_key text NOT NULL,
    currency text NOT NULL DEFAULT 'YER',
    period_start date NOT NULL,
    period_end date NOT NULL,
    evidence_document_id text NOT NULL,
    uploaded_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    idempotency_key text NOT NULL UNIQUE,
    request_hash text NOT NULL,
    correlation_id text NOT NULL,
    CONSTRAINT settlement_statements_batch_fk FOREIGN KEY (batch_id) REFERENCES wlt.settlement_batches(id) ON DELETE RESTRICT,
    CONSTRAINT settlement_statements_evidence_fk FOREIGN KEY (evidence_document_id) REFERENCES wlt.finance_evidence_documents(id) ON DELETE RESTRICT,
    CONSTRAINT settlement_statements_provider_chk CHECK (length(btrim(provider_key)) BETWEEN 1 AND 64),
    CONSTRAINT settlement_statements_currency_chk CHECK (currency = 'YER'),
    CONSTRAINT settlement_statements_period_chk CHECK (period_end >= period_start),
    CONSTRAINT settlement_statements_actor_chk CHECK (length(btrim(uploaded_by)) BETWEEN 1 AND 128),
    CONSTRAINT settlement_statements_hash_chk CHECK (length(btrim(request_hash)) > 0),
    CONSTRAINT settlement_statements_correlation_chk CHECK (length(btrim(correlation_id)) BETWEEN 1 AND 128),
    CONSTRAINT settlement_statements_evidence_document_uq UNIQUE (evidence_document_id)
);

CREATE INDEX settlement_statements_period_idx ON wlt.settlement_statements(provider_key, period_start, period_end, created_at DESC);

CREATE TABLE wlt.settlement_statement_rows (
    id text PRIMARY KEY,
    statement_id text NOT NULL,
    row_sequence integer NOT NULL,
    external_transfer_reference text NOT NULL,
    destination_identifier_ciphertext text NOT NULL,
    amount_minor bigint NOT NULL,
    currency text NOT NULL DEFAULT 'YER',
    transaction_at timestamptz NOT NULL,
    row_hash text NOT NULL,
    recorded_by text NOT NULL,
    matched_transfer_id text,
    matched_by text,
    matched_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    idempotency_key text NOT NULL UNIQUE,
    request_hash text NOT NULL,
    correlation_id text NOT NULL,
    CONSTRAINT settlement_statement_rows_statement_fk FOREIGN KEY (statement_id) REFERENCES wlt.settlement_statements(id) ON DELETE RESTRICT,
    CONSTRAINT settlement_statement_rows_transfer_fk FOREIGN KEY (matched_transfer_id) REFERENCES wlt.manual_transfer_executions(id) ON DELETE RESTRICT,
    CONSTRAINT settlement_statement_rows_sequence_chk CHECK (row_sequence > 0),
    CONSTRAINT settlement_statement_rows_reference_chk CHECK (length(btrim(external_transfer_reference)) BETWEEN 1 AND 160),
    CONSTRAINT settlement_statement_rows_destination_chk CHECK (length(btrim(destination_identifier_ciphertext)) > 0),
    CONSTRAINT settlement_statement_rows_amount_chk CHECK (amount_minor > 0 AND currency = 'YER'),
    CONSTRAINT settlement_statement_rows_hash_chk CHECK (length(btrim(row_hash)) = 64),
    CONSTRAINT settlement_statement_rows_recorded_by_chk CHECK (length(btrim(recorded_by)) BETWEEN 1 AND 128),
    CONSTRAINT settlement_statement_rows_request_hash_chk CHECK (length(btrim(request_hash)) > 0),
    CONSTRAINT settlement_statement_rows_correlation_chk CHECK (length(btrim(correlation_id)) BETWEEN 1 AND 128),
    CONSTRAINT settlement_statement_rows_match_chk CHECK ((matched_transfer_id IS NULL AND matched_by IS NULL AND matched_at IS NULL) OR (matched_transfer_id IS NOT NULL AND matched_by IS NOT NULL AND matched_at IS NOT NULL)),
    CONSTRAINT settlement_statement_rows_statement_sequence_uq UNIQUE (statement_id, row_sequence),
    CONSTRAINT settlement_statement_rows_transfer_uq UNIQUE (matched_transfer_id)
);

CREATE INDEX settlement_statement_rows_unmatched_idx ON wlt.settlement_statement_rows(statement_id, row_sequence) WHERE matched_transfer_id IS NULL;
CREATE INDEX settlement_statement_rows_reference_idx ON wlt.settlement_statement_rows(external_transfer_reference);


ALTER TABLE wlt.manual_transfer_executions
    ADD CONSTRAINT manual_transfer_executions_statement_row_fk FOREIGN KEY (statement_row_id) REFERENCES wlt.settlement_statement_rows(id) ON DELETE RESTRICT,
    ADD CONSTRAINT manual_transfer_executions_statement_row_uq UNIQUE (statement_row_id);

ALTER TABLE wlt.payout_audit_events
    DROP CONSTRAINT payout_audit_events_event_chk,
    ADD CONSTRAINT payout_audit_events_event_chk CHECK (event_type IN ('PAYOUT_PREPARED', 'PAYOUT_APPROVED', 'PAYOUT_CANCELLED', 'BATCH_CREATED', 'BATCH_APPROVED', 'BATCH_FROZEN', 'TRANSFER_EXECUTED', 'TRANSFER_VERIFIED', 'TRANSFER_RECONCILED', 'PAYOUT_COMPLETED', 'FINANCE_EVIDENCE_UPLOADED', 'SETTLEMENT_STATEMENT_REGISTERED', 'SETTLEMENT_STATEMENT_ROW_RECORDED'));
