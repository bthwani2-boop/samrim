-- Fresh isolated Identity schema: Operator permissions and immutable audit.
-- Replace __SCHEMA__ only after validating a NEW identity_test_* namespace.
-- Never apply this baseline to retained credentials, sessions or root owners.
CREATE TABLE __SCHEMA__.operator_permissions (
    actor_id text NOT NULL,
    role text NOT NULL DEFAULT 'operator' CHECK (role = 'operator'),
    permission text NOT NULL CHECK (
        permission IN ('operations','merchant','catalog','marketing','finance','hr','platform_policies')
    ),
    state text NOT NULL DEFAULT 'ACTIVE' CHECK (state IN ('ACTIVE','REVOKED')),
    version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
    granted_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (actor_id, permission),
    FOREIGN KEY (actor_id, role) REFERENCES __SCHEMA__.actor_roles(actor_id, role)
);
-- Real grant/revoke must later be owned by audited, authorized Identity
-- administration with version invalidation and protected Operator continuity.
-- No role receives an implicit permission from this migration.

CREATE TABLE __SCHEMA__.operator_bootstrap (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    actor_id text NOT NULL,
    role text NOT NULL DEFAULT 'operator' CHECK (role = 'operator'),
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (actor_id, role) REFERENCES __SCHEMA__.actor_roles(actor_id,role)
);


CREATE TABLE __SCHEMA__.operator_permission_commands (
    operation_id text PRIMARY KEY
        CHECK (char_length(operation_id) BETWEEN 8 AND 64),
    admin_actor_id text NOT NULL REFERENCES __SCHEMA__.actors(id),
    target_actor_id text NOT NULL REFERENCES __SCHEMA__.actors(id),
    permission text NOT NULL CHECK (permission IN (
        'operations','merchant','catalog','marketing','finance','hr','platform_policies'
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

-- Preserve original Operator attribution and append-only commands.
-- No historical permission-name cutover is needed in a fresh schema.
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
