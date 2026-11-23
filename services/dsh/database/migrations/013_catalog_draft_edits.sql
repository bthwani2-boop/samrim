-- Additive DSH-owned draft edit version and immutable command journal.
-- Apply only after 001 and 012 on a verified isolated dsh_test_* schema.
-- This is not an approval, publication, inventory reservation, or Order operation.
ALTER TABLE __SCHEMA__.offers
  ADD COLUMN IF NOT EXISTS draft_version bigint NOT NULL DEFAULT 1
    CHECK (draft_version >= 1);

CREATE TABLE IF NOT EXISTS __SCHEMA__.catalog_draft_edit_commands (
    actor_id text NOT NULL CHECK (char_length(trim(actor_id)) BETWEEN 1 AND 128),
    operation_id text NOT NULL CHECK (operation_id ~ '^[A-Za-z0-9._-]{8,128}$'),
    request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
    store_id text NOT NULL REFERENCES __SCHEMA__.stores(id) ON DELETE RESTRICT,
    offer_id text NOT NULL REFERENCES __SCHEMA__.offers(id) ON DELETE RESTRICT,
    expected_version bigint NOT NULL CHECK (expected_version >= 1),
    result_version bigint NOT NULL CHECK (result_version = expected_version + 1),
    result_name text NOT NULL CHECK (char_length(trim(result_name)) BETWEEN 1 AND 160),
    result_price_yer bigint NOT NULL CHECK (result_price_yer > 0),
    result_stock_units integer NOT NULL CHECK (result_stock_units >= 0),
    committed_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (actor_id,operation_id)
);
CREATE OR REPLACE FUNCTION __SCHEMA__.reject_catalog_draft_edit_rewrite()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'DSH catalog draft edits are immutable';
END
$$;
DROP TRIGGER IF EXISTS trg_catalog_draft_edit_immutable ON __SCHEMA__.catalog_draft_edit_commands;
CREATE TRIGGER trg_catalog_draft_edit_immutable
BEFORE UPDATE OR DELETE ON __SCHEMA__.catalog_draft_edit_commands
FOR EACH ROW EXECUTE FUNCTION __SCHEMA__.reject_catalog_draft_edit_rewrite();
