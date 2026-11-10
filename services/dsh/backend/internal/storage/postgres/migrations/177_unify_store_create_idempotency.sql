-- Preserve the existing first-Store replay evidence while making its table
-- the canonical idempotency owner for all Store creation entry points.
-- Renames are metadata-only; no Store or audit record is deleted or rewritten.
ALTER TABLE dsh.first_store_create_idempotency RENAME TO store_create_idempotency;
ALTER TABLE dsh.store_create_idempotency
  RENAME CONSTRAINT first_store_create_idempotency_pkey TO store_create_idempotency_pkey;
ALTER TABLE dsh.store_create_idempotency
  RENAME CONSTRAINT first_store_create_idempotency_store_id_fkey TO store_create_idempotency_store_id_fkey;
ALTER TABLE dsh.store_create_idempotency
  RENAME CONSTRAINT first_store_create_idem_hash_chk TO store_create_idem_hash_chk;
ALTER INDEX dsh.first_store_create_idempotency_partner_idx
  RENAME TO store_create_idempotency_partner_idx;
-- Retain the identity of any Operator acting for the owner in the SAME
-- transactional replay record; historical first-Store rows remain NULL.
ALTER TABLE dsh.store_create_idempotency
  ADD COLUMN operator_actor_id text,
  ADD COLUMN correlation_id text,
  ADD CONSTRAINT store_create_operator_attribution_chk CHECK (
    (operator_actor_id IS NULL AND correlation_id IS NULL) OR
    (operator_actor_id IS NOT NULL AND length(operator_actor_id) BETWEEN 1 AND 128
      AND correlation_id IS NOT NULL AND length(correlation_id) BETWEEN 8 AND 128)
  );
