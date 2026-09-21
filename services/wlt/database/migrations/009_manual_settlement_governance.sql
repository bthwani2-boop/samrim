ALTER TABLE wlt.ledger_entries
    DROP CONSTRAINT ledger_entries_code_chk,
    ADD CONSTRAINT ledger_entries_code_chk CHECK (account_code IN ('CAPTAIN_CASH_RECEIVABLE', 'CUSTOMER_PAYMENT_CLEARING', 'PARTNER_WALLET', 'CAPTAIN_WALLET', 'FIELD_WALLET', 'PLATFORM_COMMISSION_INCOME', 'FIELD_COMMISSION_EXPENSE', 'EXTERNAL_SETTLEMENT_CASH')),
    DROP CONSTRAINT ledger_entries_actor_chk,
    ADD CONSTRAINT ledger_entries_actor_chk CHECK ((account_code IN ('PARTNER_WALLET', 'CAPTAIN_WALLET', 'FIELD_WALLET') AND actor_type IS NOT NULL AND actor_id IS NOT NULL) OR (account_code NOT IN ('PARTNER_WALLET', 'CAPTAIN_WALLET', 'FIELD_WALLET') AND actor_type IS NULL AND actor_id IS NULL));

ALTER TABLE wlt.payout_requests
    ADD COLUMN ledger_transaction_id text,
    ADD CONSTRAINT payout_requests_ledger_transaction_fk FOREIGN KEY (ledger_transaction_id) REFERENCES wlt.ledger_transactions(id) ON DELETE RESTRICT,
    ADD CONSTRAINT payout_requests_ledger_transaction_uq UNIQUE (ledger_transaction_id);

CREATE TABLE wlt.approved_payout_snapshots (
    payout_id text PRIMARY KEY,
    actor_type text NOT NULL,
    actor_id text NOT NULL,
    beneficiary_name text NOT NULL,
    provider_key text NOT NULL,
    masked_destination text NOT NULL,
    destination_id text NOT NULL,
    destination_version integer NOT NULL,
    amount_mode text NOT NULL,
    resolved_amount_minor bigint NOT NULL,
    currency text NOT NULL DEFAULT 'YER',
    policy_version text NOT NULL,
    snapshot_hash text NOT NULL,
    prepared_by text NOT NULL,
    prepared_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    approved_by text,
    approved_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT approved_payout_snapshots_payout_fk FOREIGN KEY (payout_id) REFERENCES wlt.payout_requests(id) ON DELETE RESTRICT,
    CONSTRAINT approved_payout_snapshots_destination_fk FOREIGN KEY (destination_id) REFERENCES wlt.official_wallet_destinations(id) ON DELETE RESTRICT,
    CONSTRAINT approved_payout_snapshots_actor_chk CHECK (actor_type IN ('partner', 'captain', 'field') AND length(btrim(actor_id)) BETWEEN 1 AND 128),
    CONSTRAINT approved_payout_snapshots_beneficiary_chk CHECK (length(btrim(beneficiary_name)) BETWEEN 1 AND 160),
    CONSTRAINT approved_payout_snapshots_provider_chk CHECK (length(btrim(provider_key)) BETWEEN 1 AND 64),
    CONSTRAINT approved_payout_snapshots_destination_chk CHECK (length(btrim(masked_destination)) BETWEEN 4 AND 128 AND destination_version > 0),
    CONSTRAINT approved_payout_snapshots_amount_mode_chk CHECK (amount_mode IN ('FULL_AVAILABLE', 'SPECIFIED') AND resolved_amount_minor > 0),
    CONSTRAINT approved_payout_snapshots_currency_chk CHECK (currency = 'YER'),
    CONSTRAINT approved_payout_snapshots_hash_chk CHECK (length(btrim(snapshot_hash)) > 0),
    CONSTRAINT approved_payout_snapshots_prepared_by_chk CHECK (length(btrim(prepared_by)) BETWEEN 1 AND 128),
    CONSTRAINT approved_payout_snapshots_approval_chk CHECK ((approved_by IS NULL AND approved_at IS NULL) OR (approved_by IS NOT NULL AND approved_at IS NOT NULL))
);

CREATE TABLE wlt.settlement_batches (
    id text PRIMARY KEY,
    provider_key text NOT NULL,
    currency text NOT NULL DEFAULT 'YER',
    status text NOT NULL DEFAULT 'PREPARED',
    row_count integer NOT NULL,
    total_amount_minor bigint NOT NULL,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    approved_by text,
    approved_at timestamptz,
    frozen_by text,
    frozen_at timestamptz,
    batch_hash text,
    idempotency_key text NOT NULL,
    request_hash text NOT NULL,
    correlation_id text NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT settlement_batches_provider_chk CHECK (length(btrim(provider_key)) BETWEEN 1 AND 64),
    CONSTRAINT settlement_batches_currency_chk CHECK (currency = 'YER'),
    CONSTRAINT settlement_batches_status_chk CHECK (status IN ('DRAFT', 'PREPARED', 'APPROVED', 'FROZEN', 'EXECUTION_IN_PROGRESS', 'AWAITING_VERIFICATION', 'AWAITING_RECONCILIATION', 'COMPLETED', 'CANCELLED', 'EXCEPTION')),
    CONSTRAINT settlement_batches_totals_chk CHECK (row_count > 0 AND total_amount_minor > 0),
    CONSTRAINT settlement_batches_created_by_chk CHECK (length(btrim(created_by)) BETWEEN 1 AND 128),
    CONSTRAINT settlement_batches_approval_chk CHECK ((approved_by IS NULL AND approved_at IS NULL) OR (approved_by IS NOT NULL AND approved_at IS NOT NULL)),
    CONSTRAINT settlement_batches_freeze_chk CHECK ((frozen_by IS NULL AND frozen_at IS NULL) OR (frozen_by IS NOT NULL AND frozen_at IS NOT NULL)),
    CONSTRAINT settlement_batches_hash_chk CHECK (batch_hash IS NULL OR length(btrim(batch_hash)) > 0),
    CONSTRAINT settlement_batches_idempotency_uq UNIQUE (idempotency_key)
);

CREATE TABLE wlt.settlement_batch_items (
    batch_id text NOT NULL,
    payout_id text NOT NULL,
    row_sequence integer NOT NULL,
    snapshot_hash text NOT NULL,
    amount_minor bigint NOT NULL,
    currency text NOT NULL DEFAULT 'YER',
    destination_id text NOT NULL,
    destination_version integer NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (batch_id, payout_id),
    CONSTRAINT settlement_batch_items_batch_fk FOREIGN KEY (batch_id) REFERENCES wlt.settlement_batches(id) ON DELETE RESTRICT,
    CONSTRAINT settlement_batch_items_payout_fk FOREIGN KEY (payout_id) REFERENCES wlt.payout_requests(id) ON DELETE RESTRICT,
    CONSTRAINT settlement_batch_items_snapshot_fk FOREIGN KEY (payout_id) REFERENCES wlt.approved_payout_snapshots(payout_id) ON DELETE RESTRICT,
    CONSTRAINT settlement_batch_items_amount_chk CHECK (row_sequence > 0 AND amount_minor > 0 AND currency = 'YER' AND destination_version > 0 AND length(btrim(snapshot_hash)) > 0),
    CONSTRAINT settlement_batch_items_sequence_uq UNIQUE (batch_id, row_sequence)
);

CREATE TABLE wlt.manual_transfer_executions (
    id text PRIMARY KEY,
    batch_id text NOT NULL,
    payout_id text NOT NULL UNIQUE,
    approved_snapshot_hash text NOT NULL,
    executed_by text NOT NULL,
    executed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    provider_key text NOT NULL,
    external_transfer_reference text NOT NULL,
    amount_minor bigint NOT NULL,
    currency text NOT NULL DEFAULT 'YER',
    destination_id text NOT NULL,
    destination_version integer NOT NULL,
    evidence_reference text NOT NULL,
    execution_status text NOT NULL DEFAULT 'EXECUTED',
    verified_by text,
    verified_at timestamptz,
    statement_reference text,
    reconciled_by text,
    reconciled_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT manual_transfer_executions_batch_fk FOREIGN KEY (batch_id) REFERENCES wlt.settlement_batches(id) ON DELETE RESTRICT,
    CONSTRAINT manual_transfer_executions_payout_fk FOREIGN KEY (payout_id) REFERENCES wlt.payout_requests(id) ON DELETE RESTRICT,
    CONSTRAINT manual_transfer_executions_snapshot_fk FOREIGN KEY (payout_id) REFERENCES wlt.approved_payout_snapshots(payout_id) ON DELETE RESTRICT,
    CONSTRAINT manual_transfer_executions_destination_fk FOREIGN KEY (destination_id) REFERENCES wlt.official_wallet_destinations(id) ON DELETE RESTRICT,
    CONSTRAINT manual_transfer_executions_values_chk CHECK (length(btrim(approved_snapshot_hash)) > 0 AND length(btrim(executed_by)) BETWEEN 1 AND 128 AND length(btrim(provider_key)) BETWEEN 1 AND 64 AND length(btrim(external_transfer_reference)) BETWEEN 1 AND 160 AND amount_minor > 0 AND currency = 'YER' AND destination_version > 0 AND length(btrim(evidence_reference)) BETWEEN 1 AND 512),
    CONSTRAINT manual_transfer_executions_status_chk CHECK (execution_status IN ('EXECUTED', 'VERIFIED', 'RECONCILED')),
    CONSTRAINT manual_transfer_executions_verification_chk CHECK ((verified_by IS NULL AND verified_at IS NULL) OR (verified_by IS NOT NULL AND verified_at IS NOT NULL)),
    CONSTRAINT manual_transfer_executions_reconciliation_chk CHECK ((reconciled_by IS NULL AND reconciled_at IS NULL AND statement_reference IS NULL) OR (reconciled_by IS NOT NULL AND reconciled_at IS NOT NULL AND statement_reference IS NOT NULL)),
    CONSTRAINT manual_transfer_executions_reference_uq UNIQUE (provider_key, external_transfer_reference)
);

CREATE TABLE wlt.payout_audit_events (
    id text PRIMARY KEY,
    event_type text NOT NULL,
    payout_id text,
    batch_id text,
    actor_id text NOT NULL,
    reason text NOT NULL DEFAULT '',
    evidence_reference text NOT NULL DEFAULT '',
    idempotency_key text NOT NULL,
    request_hash text NOT NULL,
    correlation_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT payout_audit_events_payout_fk FOREIGN KEY (payout_id) REFERENCES wlt.payout_requests(id) ON DELETE RESTRICT,
    CONSTRAINT payout_audit_events_batch_fk FOREIGN KEY (batch_id) REFERENCES wlt.settlement_batches(id) ON DELETE RESTRICT,
    CONSTRAINT payout_audit_events_actor_chk CHECK (length(btrim(actor_id)) BETWEEN 1 AND 128),
    CONSTRAINT payout_audit_events_event_chk CHECK (event_type IN ('PAYOUT_PREPARED', 'PAYOUT_APPROVED', 'PAYOUT_CANCELLED', 'BATCH_CREATED', 'BATCH_APPROVED', 'BATCH_FROZEN', 'TRANSFER_EXECUTED', 'TRANSFER_VERIFIED', 'TRANSFER_RECONCILED', 'PAYOUT_COMPLETED')),
    CONSTRAINT payout_audit_events_idempotency_uq UNIQUE (idempotency_key),
    CONSTRAINT payout_audit_events_hash_chk CHECK (length(btrim(request_hash)) > 0),
    CONSTRAINT payout_audit_events_correlation_chk CHECK (length(btrim(correlation_id)) BETWEEN 1 AND 128)
);

CREATE INDEX approved_payout_snapshots_actor_idx ON wlt.approved_payout_snapshots(actor_type, actor_id, created_at DESC);
CREATE INDEX settlement_batches_status_idx ON wlt.settlement_batches(status, created_at DESC);
CREATE INDEX settlement_batch_items_payout_idx ON wlt.settlement_batch_items(payout_id);
CREATE INDEX manual_transfer_executions_batch_idx ON wlt.manual_transfer_executions(batch_id, execution_status, created_at DESC);
CREATE INDEX payout_audit_events_payout_idx ON wlt.payout_audit_events(payout_id, created_at DESC);
CREATE INDEX payout_audit_events_batch_idx ON wlt.payout_audit_events(batch_id, created_at DESC);
