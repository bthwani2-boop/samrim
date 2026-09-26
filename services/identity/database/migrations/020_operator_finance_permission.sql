CREATE TABLE identity_operator_permissions (
    actor_id text NOT NULL,
    role varchar(32) NOT NULL DEFAULT 'operator',
    permission varchar(32) NOT NULL,
    enabled boolean NOT NULL DEFAULT false,
    version integer NOT NULL DEFAULT 1,
    changed_by_actor_id text REFERENCES identity_actors(id) ON DELETE RESTRICT,
    reason text NOT NULL DEFAULT 'Finance permission is not granted',
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT identity_operator_permissions_pkey PRIMARY KEY (actor_id, permission),
    CONSTRAINT identity_operator_permissions_actor_role_fkey FOREIGN KEY (actor_id, role) REFERENCES identity_actor_roles(actor_id, role) ON DELETE CASCADE,
    CONSTRAINT identity_operator_permissions_role_chk CHECK (role = 'operator'),
    CONSTRAINT identity_operator_permissions_permission_chk CHECK (permission = 'finance'),
    CONSTRAINT identity_operator_permissions_version_chk CHECK (version > 0),
    CONSTRAINT identity_operator_permissions_reason_chk CHECK (length(btrim(reason)) BETWEEN 1 AND 500)
);

INSERT INTO identity_operator_permissions(actor_id, permission, enabled, version, changed_by_actor_id, reason)
SELECT r.actor_id,
       'finance',
       r.actor_id = bootstrap.initial_operator_actor_id,
       1,
       CASE WHEN r.actor_id = bootstrap.initial_operator_actor_id THEN r.actor_id ELSE NULL END,
       CASE WHEN r.actor_id = bootstrap.initial_operator_actor_id THEN 'initial operator bootstrap' ELSE 'Finance permission not granted' END
FROM identity_actor_roles r
LEFT JOIN identity_bootstrap_state bootstrap ON bootstrap.id = 1
WHERE r.role = 'operator';
