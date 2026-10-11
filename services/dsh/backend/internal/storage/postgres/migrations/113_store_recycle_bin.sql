-- Store archive is reversible, never cascades into orders, agreements, wallets or partner identity.
ALTER TABLE dsh.stores
  ADD COLUMN deleted_at timestamptz,
  ADD COLUMN deleted_by text,
  ADD COLUMN deletion_reason text,
  ADD CONSTRAINT store_deletion_facts_chk CHECK (
    (deleted_at IS NULL AND deleted_by IS NULL AND deletion_reason IS NULL)
    OR (deleted_at IS NOT NULL AND deleted_by IS NOT NULL AND char_length(btrim(deletion_reason)) BETWEEN 5 AND 500 AND publication_state='hidden')
  );
CREATE INDEX stores_trash_idx ON dsh.stores(deleted_at DESC,id DESC) WHERE deleted_at IS NOT NULL;

CREATE TABLE dsh.store_trash_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  idempotency_key text NOT NULL UNIQUE,
  store_id text NOT NULL REFERENCES dsh.stores(id) ON DELETE RESTRICT,
  actor_id text NOT NULL,
  action text NOT NULL CHECK (action IN ('trash','restore')),
  reason text NOT NULL,
  expected_version integer NOT NULL CHECK (expected_version > 0),
  result_version integer NOT NULL CONSTRAINT store_trash_result_version_chk CHECK (result_version=expected_version+1),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX store_trash_audit_store_idx ON dsh.store_trash_audit(store_id,created_at DESC);
