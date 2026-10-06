CREATE TABLE dsh.field_commission_publication_outbox (
    id text PRIMARY KEY,
    store_id text NOT NULL,
    field_actor_id text NOT NULL,
    vertical_id text NOT NULL,
    idempotency_key text NOT NULL,
    request_hash text NOT NULL,
    correlation_id text NOT NULL,
    state text NOT NULL DEFAULT 'PENDING',
    attempts integer NOT NULL DEFAULT 0,
    last_error text,
    next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT field_commission_publication_outbox_store_uq UNIQUE (store_id),
    CONSTRAINT field_commission_publication_outbox_idempotency_uq UNIQUE (idempotency_key),
    CONSTRAINT field_commission_publication_outbox_store_fk FOREIGN KEY (store_id) REFERENCES dsh.stores(id) ON DELETE RESTRICT,
    CONSTRAINT field_commission_publication_outbox_field_actor_chk CHECK (length(btrim(field_actor_id)) BETWEEN 1 AND 128),
    CONSTRAINT field_commission_publication_outbox_vertical_chk CHECK (length(btrim(vertical_id)) BETWEEN 1 AND 128),
    CONSTRAINT field_commission_publication_outbox_hash_chk CHECK (length(btrim(request_hash)) > 0),
    CONSTRAINT field_commission_publication_outbox_correlation_chk CHECK (length(btrim(correlation_id)) BETWEEN 1 AND 128),
    CONSTRAINT field_commission_publication_outbox_state_chk CHECK (state IN ('PENDING', 'POSTED', 'FAILED')),
    CONSTRAINT field_commission_publication_outbox_attempts_chk CHECK (attempts >= 0)
);

CREATE INDEX field_commission_publication_outbox_pending_idx
    ON dsh.field_commission_publication_outbox(state, next_attempt_at ASC, created_at ASC, id ASC);
