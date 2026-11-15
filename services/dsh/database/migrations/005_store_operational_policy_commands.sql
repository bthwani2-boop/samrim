-- Additive DSH owner-only idempotency record for versioned Operator city-policy writes.
-- Apply AFTER 004 to a fresh, isolated synthetic DSH schema first.
-- Never rewrite applied 001-004 or backfill an invented policy.
CREATE TABLE IF NOT EXISTS __SCHEMA__.store_operational_policy_commands (
    city_id text NOT NULL REFERENCES __SCHEMA__.service_cities(id) ON DELETE RESTRICT,
    operation_id text NOT NULL CHECK (operation_id ~ '^[A-Za-z0-9._-]{8,128}$'),
    request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
    acting_actor_id text NOT NULL CHECK (char_length(trim(acting_actor_id)) BETWEEN 1 AND 128),
    resulting_version bigint NOT NULL CHECK (resulting_version >= 1),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (city_id, operation_id),
    FOREIGN KEY (city_id, resulting_version)
        REFERENCES __SCHEMA__.store_operational_limits_audit(city_id, version)
        ON DELETE RESTRICT
);
-- Commands cannot be removed or rewritten to mask a prior policy outcome.
DROP TRIGGER IF EXISTS trg_store_operational_policy_commands_immutable ON __SCHEMA__.store_operational_policy_commands;
CREATE TRIGGER trg_store_operational_policy_commands_immutable
BEFORE UPDATE OR DELETE ON __SCHEMA__.store_operational_policy_commands
FOR EACH ROW EXECUTE FUNCTION __SCHEMA__.reject_operational_audit_rewrite();
