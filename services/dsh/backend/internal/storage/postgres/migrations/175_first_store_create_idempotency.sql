-- First Store and idempotency evidence commit atomically for one authenticated actor.
CREATE TABLE dsh.first_store_create_idempotency (
    key_hash text PRIMARY KEY,
    request_hash text NOT NULL,
    partner_actor_id text NOT NULL,
    store_id text NOT NULL REFERENCES dsh.stores(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT first_store_create_idem_hash_chk CHECK
        (key_hash ~ '^[0-9a-f]{64}$' AND request_hash ~ '^[0-9a-f]{64}$')
);
CREATE INDEX first_store_create_idempotency_partner_idx
    ON dsh.first_store_create_idempotency(partner_actor_id, created_at DESC);
