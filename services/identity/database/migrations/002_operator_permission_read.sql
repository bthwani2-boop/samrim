-- Identity owner: additive read-side Operator grants for isolated synthetic test only.
-- Replace __SCHEMA__ after strict identity_test_* identifier and absence checks.
-- This is not a protected-role bootstrap or a permission-grant endpoint.
CREATE TABLE __SCHEMA__.operator_permissions (
    actor_id text NOT NULL,
    role text NOT NULL DEFAULT 'operator' CHECK (role = 'operator'),
    permission text NOT NULL CHECK (
        permission IN ('operations','partners','catalog','marketing','finance','hr','platform_policies')
    ),
    state text NOT NULL DEFAULT 'ACTIVE' CHECK (state IN ('ACTIVE','REVOKED')),
    granted_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (actor_id, permission),
    FOREIGN KEY (actor_id, role) REFERENCES __SCHEMA__.actor_roles(actor_id, role)
);
-- Real grant/revoke must later be owned by audited, authorized Identity
-- administration with version invalidation and protected Operator continuity.
-- No role receives an implicit permission from this migration.
