-- Fresh, disposable DSH schema. Owner: Merchant Store admission and policy.
-- __SCHEMA__ requires a validated isolated test schema; never overlay retained data.
CREATE TABLE IF NOT EXISTS __SCHEMA__.store_registration_terms (
    version text PRIMARY KEY CHECK (version ~ '^[a-z0-9._-]{3,80}$'),
    body text NOT NULL CHECK (char_length(trim(body)) BETWEEN 1 AND 4000),
    recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION __SCHEMA__.reject_store_registration_terms_rewrite()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'Store registration terms are immutable';
END
$$;
DROP TRIGGER IF EXISTS trg_store_registration_terms_immutable ON __SCHEMA__.store_registration_terms;
CREATE TRIGGER trg_store_registration_terms_immutable
BEFORE UPDATE OR DELETE ON __SCHEMA__.store_registration_terms
FOR EACH ROW EXECUTE FUNCTION __SCHEMA__.reject_store_registration_terms_rewrite();

CREATE TABLE IF NOT EXISTS __SCHEMA__.store_registration_policies (
    city_id text NOT NULL REFERENCES __SCHEMA__.service_cities(id) ON DELETE RESTRICT,
    relation text NOT NULL CHECK (relation IN ('MARKETPLACE','DIRECT')),
    version bigint NOT NULL CHECK (version > 0),
    enabled boolean NOT NULL DEFAULT false,
    terms_version text NOT NULL REFERENCES __SCHEMA__.store_registration_terms(version) ON DELETE RESTRICT,
    changed_by_actor text NOT NULL CHECK (char_length(trim(changed_by_actor)) BETWEEN 1 AND 128),
    updated_at timestamptz NOT NULL DEFAULT now(),
    change_reason text NOT NULL DEFAULT '' CHECK (char_length(trim(change_reason)) <= 300),
    PRIMARY KEY (city_id,relation)
);

CREATE TABLE IF NOT EXISTS __SCHEMA__.store_registration_commands (
    actor_id text NOT NULL CHECK (char_length(trim(actor_id)) BETWEEN 1 AND 128),
    operation_id text NOT NULL CHECK (operation_id ~ '^[A-Za-z0-9._-]{8,128}$'),
    request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
    store_id text NOT NULL UNIQUE REFERENCES __SCHEMA__.stores(id) ON DELETE RESTRICT,
    policy_version bigint NOT NULL CHECK (policy_version > 0),
    terms_version text NOT NULL CHECK (terms_version ~ '^[a-z0-9._-]{3,80}$'),
    accepted_terms_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (actor_id,operation_id)
);
-- Immutable acceptance history; no Store deletion or silent command rewrite.
CREATE OR REPLACE FUNCTION __SCHEMA__.reject_store_registration_command_rewrite()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'Store registration acceptance is immutable';
END
$$;
DROP TRIGGER IF EXISTS trg_store_registration_commands_immutable ON __SCHEMA__.store_registration_commands;
CREATE TRIGGER trg_store_registration_commands_immutable
BEFORE UPDATE OR DELETE ON __SCHEMA__.store_registration_commands
FOR EACH ROW EXECUTE FUNCTION __SCHEMA__.reject_store_registration_command_rewrite();

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
