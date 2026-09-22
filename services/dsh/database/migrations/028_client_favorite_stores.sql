-- Client favorites are a durable DSH-owned projection of explicit customer intent.
-- Identity remains the owner of client actors; DSH stores only the actor reference.
CREATE TABLE dsh.client_favorite_stores (
    client_actor_id text NOT NULL,
    store_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT client_favorite_stores_pkey PRIMARY KEY (client_actor_id, store_id),
    CONSTRAINT client_favorite_stores_actor_chk CHECK (length(btrim(client_actor_id)) > 0),
    CONSTRAINT client_favorite_stores_store_fk FOREIGN KEY (store_id) REFERENCES dsh.stores(id) ON DELETE CASCADE
);

CREATE INDEX client_favorite_stores_client_idx
    ON dsh.client_favorite_stores(client_actor_id, created_at DESC, store_id);

CREATE TABLE dsh.client_favorite_store_mutation_idempotency (
    idempotency_key text PRIMARY KEY,
    request_hash text NOT NULL,
    client_actor_id text NOT NULL,
    store_id text NOT NULL,
    operation text NOT NULL,
    result_is_favorite boolean NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT client_favorite_store_idempotency_facts_uq
        UNIQUE (idempotency_key, request_hash, client_actor_id, store_id, operation),
    CONSTRAINT client_favorite_store_idempotency_actor_chk CHECK (length(btrim(client_actor_id)) > 0),
    CONSTRAINT client_favorite_store_idempotency_operation_chk CHECK (operation IN ('add', 'remove')),
    CONSTRAINT client_favorite_store_idempotency_store_fk
        FOREIGN KEY (store_id) REFERENCES dsh.stores(id) ON DELETE CASCADE
);

CREATE INDEX client_favorite_store_idempotency_client_idx
    ON dsh.client_favorite_store_mutation_idempotency(client_actor_id, created_at DESC);

CREATE TABLE dsh.client_favorite_store_audit (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_type text NOT NULL,
    idempotency_key text NOT NULL,
    correlation_id text NOT NULL,
    acting_actor_id text NOT NULL,
    client_actor_id text NOT NULL,
    store_id text NOT NULL,
    result_is_favorite boolean NOT NULL,
    request_hash text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT client_favorite_store_audit_event_type_chk
        CHECK (event_type IN ('client_store_favorited', 'client_store_unfavorited')),
    CONSTRAINT client_favorite_store_audit_event_idempotency_uq
        UNIQUE (event_type, idempotency_key),
    CONSTRAINT client_favorite_store_audit_actor_chk CHECK (length(btrim(client_actor_id)) > 0),
    CONSTRAINT client_favorite_store_audit_store_fk
        FOREIGN KEY (store_id) REFERENCES dsh.stores(id) ON DELETE CASCADE
);

CREATE INDEX client_favorite_store_audit_client_idx
    ON dsh.client_favorite_store_audit(client_actor_id, created_at DESC);
