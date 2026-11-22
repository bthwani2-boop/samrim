-- DSH Store admission policy writer: additive, versioned, auditable and rollback-safe.
-- This migration changes no currently enabled admission; a missing policy denies registration.
ALTER TABLE __SCHEMA__.store_registration_policies
  ADD COLUMN IF NOT EXISTS change_reason text NOT NULL DEFAULT ''
    CHECK (char_length(trim(change_reason)) <= 300);

CREATE TABLE IF NOT EXISTS __SCHEMA__.store_registration_policy_commands (
  actor_id text NOT NULL CHECK (char_length(trim(actor_id)) BETWEEN 1 AND 128),
  operation_id text NOT NULL CHECK (operation_id ~ '^[A-Za-z0-9._-]{8,128}$'),
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  city_id text NOT NULL REFERENCES __SCHEMA__.service_cities(id) ON DELETE RESTRICT,
  relation text NOT NULL CHECK (relation IN ('MARKETPLACE','DIRECT')),
  result_version bigint NOT NULL CHECK (result_version > 0),
  enabled boolean NOT NULL,
  terms_version text NOT NULL REFERENCES __SCHEMA__.store_registration_terms(version) ON DELETE RESTRICT,
  change_reason text NOT NULL CHECK (char_length(trim(change_reason)) BETWEEN 1 AND 300),
  applied_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (actor_id,operation_id)
);
CREATE OR REPLACE FUNCTION __SCHEMA__.reject_store_registration_policy_command_rewrite()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Store registration policy audit is immutable';
END
$$;
DROP TRIGGER IF EXISTS trg_store_registration_policy_commands_immutable ON __SCHEMA__.store_registration_policy_commands;
CREATE TRIGGER trg_store_registration_policy_commands_immutable
BEFORE UPDATE OR DELETE ON __SCHEMA__.store_registration_policy_commands
FOR EACH ROW EXECUTE FUNCTION __SCHEMA__.reject_store_registration_policy_command_rewrite();
