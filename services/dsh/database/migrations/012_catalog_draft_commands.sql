-- DSH isolated-development Store-owned draft catalogue command.
-- Apply only after 001 to a verified disposable dsh_test_* schema.
-- A draft does not admit public publication, inventory reservations or checkout.
CREATE TABLE IF NOT EXISTS __SCHEMA__.catalog_draft_commands (
    actor_id text NOT NULL CHECK (char_length(trim(actor_id)) BETWEEN 1 AND 128),
    operation_id text NOT NULL CHECK (operation_id ~ '^[A-Za-z0-9._-]{8,128}$'),
    request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
    store_id text NOT NULL REFERENCES __SCHEMA__.stores(id) ON DELETE RESTRICT,
    offer_id text NOT NULL UNIQUE REFERENCES __SCHEMA__.offers(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (actor_id,operation_id)
);
CREATE OR REPLACE FUNCTION __SCHEMA__.reject_catalog_draft_command_rewrite()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'DSH catalog draft commands are immutable';
END
$$;
DROP TRIGGER IF EXISTS trg_catalog_draft_commands_immutable ON __SCHEMA__.catalog_draft_commands;
CREATE TRIGGER trg_catalog_draft_commands_immutable
BEFORE UPDATE OR DELETE ON __SCHEMA__.catalog_draft_commands
FOR EACH ROW EXECUTE FUNCTION __SCHEMA__.reject_catalog_draft_command_rewrite();
