-- Identity-owned Operator permission administration, isolated synthetic only.
-- Requires 001-004. Never run against a protected/historical database or
-- provision/reassign the original Operator through this migration.
-- The original root is deliberately NOT seeded here: authorized one-time
-- bootstrap and user-verified WebAuthn continuity are separate protected acts.

CREATE TABLE __SCHEMA__.operator_bootstrap (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    actor_id text NOT NULL,
    role text NOT NULL DEFAULT 'operator' CHECK (role = 'operator'),
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (actor_id, role) REFERENCES __SCHEMA__.actor_roles(actor_id,role)
);

-- Permission row version is separate from the actor role version.
-- Each grant/revoke must advance both the permission version AND the target
-- Operator role version, revoking active Operator credentials atomically.
ALTER TABLE __SCHEMA__.operator_permissions
    ADD COLUMN version bigint NOT NULL DEFAULT 1 CHECK (version > 0);

-- Append-only command+audit table: the operation id is the concurrency-safe
-- idempotency key. A replay cannot repeat mutation, role invalidation or audit.
CREATE TABLE __SCHEMA__.operator_permission_commands (
    operation_id text PRIMARY KEY
        CHECK (char_length(operation_id) BETWEEN 8 AND 64),
    admin_actor_id text NOT NULL REFERENCES __SCHEMA__.actors(id),
    target_actor_id text NOT NULL REFERENCES __SCHEMA__.actors(id),
    permission text NOT NULL CHECK (permission IN (
        'operations','partners','catalog','marketing','finance','hr','platform_policies'
    )),
    state text NOT NULL CHECK (state IN ('ACTIVE','REVOKED')),
    expected_version bigint NOT NULL CHECK (expected_version >= 0),
    reason text NOT NULL CHECK (
        char_length(reason) BETWEEN 10 AND 500
        AND reason = btrim(reason)
        AND position(chr(10) in reason) = 0
        AND position(chr(13) in reason) = 0
    ),
    result_version bigint NOT NULL CHECK (result_version = expected_version + 1),
    previous_state text CHECK (previous_state IS NULL OR previous_state IN ('ACTIVE','REVOKED')),
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX idx_operator_permission_commands_target
    ON __SCHEMA__.operator_permission_commands (target_actor_id, recorded_at DESC);

-- Preserve initial original-actor attribution and historical audit rows.
-- The SQL owner migration role can still replace this DDL via a separately
-- reviewed protected migration, but the running app cannot rewrite history.
CREATE FUNCTION __SCHEMA__.deny_operator_admin_audit_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'original Operator marker and permission audit are append-only'
        USING ERRCODE = '42501';
END;
$$;
CREATE TRIGGER original_operator_marker_immutable
    BEFORE UPDATE OR DELETE ON __SCHEMA__.operator_bootstrap
    FOR EACH ROW EXECUTE FUNCTION __SCHEMA__.deny_operator_admin_audit_mutation();
CREATE TRIGGER operator_permission_command_immutable
    BEFORE UPDATE OR DELETE ON __SCHEMA__.operator_permission_commands
    FOR EACH ROW EXECUTE FUNCTION __SCHEMA__.deny_operator_admin_audit_mutation();
