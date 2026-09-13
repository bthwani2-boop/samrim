ALTER TABLE dsh.stores
    ADD COLUMN publication_state text NOT NULL DEFAULT 'unpublished',
    ADD COLUMN publication_changed_at timestamptz;

ALTER TABLE dsh.stores
    ADD CONSTRAINT stores_publication_state_chk
        CHECK (publication_state IN ('unpublished', 'published', 'hidden'));

CREATE INDEX stores_publication_state_idx
    ON dsh.stores(publication_state, created_at ASC, id ASC);

CREATE TABLE dsh.store_publication_idempotency (
    idempotency_key text PRIMARY KEY,
    request_hash text NOT NULL,
    store_id text NOT NULL,
    requested_state text NOT NULL,
    expected_version integer NOT NULL,
    result_version integer NOT NULL,
    result_state text NOT NULL,
    result_publication_changed_at timestamptz NOT NULL,
    result_updated_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT store_publication_idempotency_facts_uq
        UNIQUE (idempotency_key, store_id, request_hash, requested_state, expected_version),
    CONSTRAINT store_publication_idempotency_state_chk
        CHECK (requested_state IN ('published', 'hidden') AND result_state IN ('published', 'hidden') AND expected_version > 0 AND result_version > 0),
    CONSTRAINT store_publication_idempotency_store_fk
        FOREIGN KEY (store_id) REFERENCES dsh.stores(id) ON DELETE RESTRICT
);

CREATE INDEX store_publication_idempotency_store_idx
    ON dsh.store_publication_idempotency(store_id, created_at DESC);

CREATE TABLE dsh.store_publication_audit (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_type text NOT NULL,
    idempotency_key text NOT NULL,
    correlation_id text NOT NULL,
    acting_actor_id text NOT NULL,
    store_id text NOT NULL,
    from_state text NOT NULL,
    to_state text NOT NULL,
    expected_version integer NOT NULL,
    result_version integer NOT NULL,
    request_hash text NOT NULL,
    requested_state text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT store_publication_audit_event_type_chk
        CHECK (event_type IN ('store_published', 'store_hidden')),
    CONSTRAINT store_publication_audit_event_idempotency_uq
        UNIQUE (event_type, idempotency_key),
    CONSTRAINT store_publication_audit_idempotency_fk
        FOREIGN KEY (idempotency_key, store_id, request_hash, requested_state, expected_version)
        REFERENCES dsh.store_publication_idempotency(idempotency_key, store_id, request_hash, requested_state, expected_version)
        ON DELETE RESTRICT
);

CREATE INDEX store_publication_audit_store_idx
    ON dsh.store_publication_audit(store_id, created_at DESC);
