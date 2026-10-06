ALTER TABLE dsh.catalog_product_proposal_idempotency
    DROP CONSTRAINT catalog_product_proposal_idempotency_operation_chk,
    ADD CONSTRAINT catalog_product_proposal_idempotency_operation_chk CHECK (operation IN ('create', 'update', 'submit', 'review'));

ALTER TABLE dsh.catalog_product_proposal_audit
    DROP CONSTRAINT catalog_product_proposal_audit_event_type_chk,
    ADD CONSTRAINT catalog_product_proposal_audit_event_type_chk CHECK (event_type IN ('proposal_created', 'proposal_updated', 'proposal_submitted', 'proposal_reviewed'));

CREATE TABLE dsh.catalog_import_mutation_idempotency (
    idempotency_key text PRIMARY KEY,
    request_hash text NOT NULL,
    run_id text NOT NULL,
    operation text NOT NULL,
    result_state text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT catalog_import_idempotency_operation_chk CHECK (operation IN ('preview', 'commit')),
    CONSTRAINT catalog_import_idempotency_state_chk CHECK (result_state IN ('previewed', 'committed', 'rejected')),
    CONSTRAINT catalog_import_idempotency_run_fk FOREIGN KEY (run_id) REFERENCES dsh.catalog_import_runs(id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX catalog_import_idempotency_facts_uq ON dsh.catalog_import_mutation_idempotency(run_id, operation);
CREATE INDEX catalog_import_idempotency_run_idx ON dsh.catalog_import_mutation_idempotency(run_id, created_at DESC);

CREATE TABLE dsh.catalog_import_run_items (
    run_id text NOT NULL,
    row_number integer NOT NULL,
    stable_key text NOT NULL,
    payload jsonb NOT NULL,
    classification text NOT NULL,
    product_id text,
    variant_id text,
    error_code text,
    error_message text,
    committed boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (run_id, row_number),
    CONSTRAINT catalog_import_run_items_run_fk FOREIGN KEY (run_id) REFERENCES dsh.catalog_import_runs(id) ON DELETE RESTRICT,
    CONSTRAINT catalog_import_run_items_product_fk FOREIGN KEY (product_id) REFERENCES dsh.catalog_products(id) ON DELETE RESTRICT,
    CONSTRAINT catalog_import_run_items_variant_fk FOREIGN KEY (variant_id) REFERENCES dsh.catalog_product_variants(id) ON DELETE RESTRICT,
    CONSTRAINT catalog_import_run_items_row_chk CHECK (row_number > 0),
    CONSTRAINT catalog_import_run_items_key_chk CHECK (char_length(btrim(stable_key)) BETWEEN 1 AND 512),
    CONSTRAINT catalog_import_run_items_classification_chk CHECK (classification IN ('READY', 'DUPLICATE_INPUT', 'DUPLICATE_EXISTING', 'CONFLICT_EXISTING', 'INVALID_INPUT', 'IMPORTED', 'REPLAYED', 'FAILED')),
    CONSTRAINT catalog_import_run_items_commit_chk CHECK ((committed AND classification IN ('IMPORTED', 'REPLAYED')) OR (NOT committed))
);
CREATE INDEX catalog_import_run_items_classification_idx ON dsh.catalog_import_run_items(run_id, classification, row_number);

CREATE TABLE dsh.catalog_import_audit (
    id bigserial PRIMARY KEY,
    event_type text NOT NULL,
    idempotency_key text NOT NULL,
    correlation_id text NOT NULL,
    acting_actor_id text NOT NULL,
    run_id text NOT NULL,
    source_sha256 text NOT NULL,
    from_state text,
    to_state text NOT NULL,
    accepted_count integer NOT NULL,
    conflict_count integer NOT NULL,
    request_hash text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT catalog_import_audit_event_type_chk CHECK (event_type IN ('import_previewed', 'import_committed', 'import_rejected')),
    CONSTRAINT catalog_import_audit_event_idempotency_uq UNIQUE (event_type, idempotency_key),
    CONSTRAINT catalog_import_audit_run_fk FOREIGN KEY (run_id) REFERENCES dsh.catalog_import_runs(id) ON DELETE RESTRICT,
    CONSTRAINT catalog_import_audit_count_chk CHECK (accepted_count >= 0 AND conflict_count >= 0),
    CONSTRAINT catalog_import_audit_sha_chk CHECK (source_sha256 ~ '^[a-f0-9]{64}$')
);
CREATE INDEX catalog_import_audit_run_idx ON dsh.catalog_import_audit(run_id, created_at DESC);
