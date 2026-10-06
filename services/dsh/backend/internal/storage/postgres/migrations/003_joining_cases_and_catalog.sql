DO $$
BEGIN
    IF (SELECT count(*) FROM dsh.partner_bootstrap_idempotency) <> 0
       OR (SELECT count(*) FROM dsh.partner_bootstrap_audit) <> 0 THEN
        RAISE EXCEPTION 'legacy partner bootstrap evidence is non-empty; reconcile before DSH joining cutover';
    END IF;
END $$;

DROP TABLE dsh.partner_bootstrap_audit;
DROP TABLE dsh.partner_bootstrap_idempotency;

CREATE TABLE dsh.joining_cases (
    id text PRIMARY KEY,
    contact_phone_e164 text NOT NULL,
    business_name text NOT NULL,
    first_store_name text NOT NULL,
    partner_actor_id text,
    state text NOT NULL DEFAULT 'draft',
    correction_reason text,
    reviewed_by text,
    store_id text,
    version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT joining_cases_phone_length_chk CHECK (char_length(contact_phone_e164) BETWEEN 8 AND 128),
    CONSTRAINT joining_cases_business_name_chk CHECK (char_length(business_name) BETWEEN 2 AND 160),
    CONSTRAINT joining_cases_store_name_chk CHECK (char_length(first_store_name) BETWEEN 2 AND 160),
    CONSTRAINT joining_cases_state_chk CHECK (state IN ('draft', 'submitted', 'needs_correction', 'approved')),
    CONSTRAINT joining_cases_version_positive_chk CHECK (version > 0),
    CONSTRAINT joining_cases_store_fk FOREIGN KEY (store_id) REFERENCES dsh.stores(id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX joining_cases_active_phone_uq
    ON dsh.joining_cases(contact_phone_e164) WHERE state <> 'approved';
CREATE UNIQUE INDEX joining_cases_partner_actor_uq
    ON dsh.joining_cases(partner_actor_id) WHERE partner_actor_id IS NOT NULL;
CREATE INDEX joining_cases_state_idx ON dsh.joining_cases(state, created_at ASC, id ASC);

CREATE TABLE dsh.joining_case_mutation_idempotency (
    idempotency_key text PRIMARY KEY,
    request_hash text NOT NULL,
    case_id text NOT NULL,
    operation text NOT NULL,
    result_version integer NOT NULL,
    result_state text NOT NULL,
    result_partner_actor_id text,
    result_store_id text,
    result_correction_reason text,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT joining_case_idempotency_facts_uq UNIQUE (idempotency_key, request_hash, case_id, operation),
    CONSTRAINT joining_case_idempotency_operation_chk CHECK (operation IN ('create', 'submit', 'review')),
    CONSTRAINT joining_case_idempotency_state_chk CHECK (result_state IN ('draft', 'submitted', 'needs_correction', 'approved')),
    CONSTRAINT joining_case_idempotency_version_chk CHECK (result_version > 0),
    CONSTRAINT joining_case_idempotency_case_fk FOREIGN KEY (case_id) REFERENCES dsh.joining_cases(id) ON DELETE RESTRICT
);
CREATE INDEX joining_case_idempotency_case_idx ON dsh.joining_case_mutation_idempotency(case_id, created_at DESC);

CREATE TABLE dsh.joining_case_audit (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_type text NOT NULL,
    idempotency_key text NOT NULL,
    correlation_id text NOT NULL,
    acting_actor_id text NOT NULL,
    case_id text NOT NULL,
    from_state text,
    to_state text NOT NULL,
    result_version integer NOT NULL,
    request_hash text NOT NULL,
    partner_actor_id text,
    store_id text,
    correction_reason text,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT joining_case_audit_event_type_chk CHECK (event_type IN ('joining_case_created', 'joining_case_submitted', 'joining_case_needs_correction', 'joining_case_approved')),
    CONSTRAINT joining_case_audit_event_idempotency_uq UNIQUE (event_type, idempotency_key),
    CONSTRAINT joining_case_audit_case_fk FOREIGN KEY (case_id) REFERENCES dsh.joining_cases(id) ON DELETE RESTRICT,
    CONSTRAINT joining_case_audit_version_chk CHECK (result_version > 0)
);
CREATE INDEX joining_case_audit_case_idx ON dsh.joining_case_audit(case_id, created_at DESC);

CREATE TABLE dsh.catalog_items (
    id text PRIMARY KEY,
    store_id text NOT NULL,
    name text NOT NULL,
    publication_state text NOT NULL DEFAULT 'draft',
    availability boolean NOT NULL DEFAULT true,
    version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT catalog_items_store_fk FOREIGN KEY (store_id) REFERENCES dsh.stores(id) ON DELETE RESTRICT,
    CONSTRAINT catalog_items_name_chk CHECK (char_length(name) BETWEEN 1 AND 160),
    CONSTRAINT catalog_items_state_chk CHECK (publication_state IN ('draft', 'published', 'hidden')),
    CONSTRAINT catalog_items_version_chk CHECK (version > 0)
);
CREATE INDEX catalog_items_store_idx ON dsh.catalog_items(store_id, created_at ASC, id ASC);
CREATE INDEX catalog_items_public_idx ON dsh.catalog_items(store_id, publication_state, availability, id);

CREATE TABLE dsh.catalog_item_mutation_idempotency (
    idempotency_key text PRIMARY KEY,
    request_hash text NOT NULL,
    store_id text NOT NULL,
    item_id text NOT NULL,
    operation text NOT NULL,
    result_name text NOT NULL,
    result_state text NOT NULL,
    result_availability boolean NOT NULL,
    result_version integer NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT catalog_item_idempotency_facts_uq UNIQUE (idempotency_key, request_hash, store_id, item_id, operation),
    CONSTRAINT catalog_item_idempotency_operation_chk CHECK (operation IN ('create', 'update')),
    CONSTRAINT catalog_item_idempotency_state_chk CHECK (result_state IN ('draft', 'published', 'hidden')),
    CONSTRAINT catalog_item_idempotency_version_chk CHECK (result_version > 0),
    CONSTRAINT catalog_item_idempotency_store_fk FOREIGN KEY (store_id) REFERENCES dsh.stores(id) ON DELETE RESTRICT,
    CONSTRAINT catalog_item_idempotency_item_fk FOREIGN KEY (item_id) REFERENCES dsh.catalog_items(id) ON DELETE RESTRICT
);
CREATE INDEX catalog_item_idempotency_store_idx ON dsh.catalog_item_mutation_idempotency(store_id, created_at DESC);

CREATE TABLE dsh.catalog_item_audit (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_type text NOT NULL,
    idempotency_key text NOT NULL,
    correlation_id text NOT NULL,
    acting_actor_id text NOT NULL,
    store_id text NOT NULL,
    item_id text NOT NULL,
    from_state text,
    to_state text NOT NULL,
    expected_version integer,
    result_version integer NOT NULL,
    request_hash text NOT NULL,
    availability boolean NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT catalog_item_audit_event_type_chk CHECK (event_type IN ('catalog_item_created', 'catalog_item_updated')),
    CONSTRAINT catalog_item_audit_event_idempotency_uq UNIQUE (event_type, idempotency_key),
    CONSTRAINT catalog_item_audit_store_fk FOREIGN KEY (store_id) REFERENCES dsh.stores(id) ON DELETE RESTRICT,
    CONSTRAINT catalog_item_audit_item_fk FOREIGN KEY (item_id) REFERENCES dsh.catalog_items(id) ON DELETE RESTRICT,
    CONSTRAINT catalog_item_audit_version_chk CHECK (result_version > 0)
);
CREATE INDEX catalog_item_audit_store_idx ON dsh.catalog_item_audit(store_id, created_at DESC);
