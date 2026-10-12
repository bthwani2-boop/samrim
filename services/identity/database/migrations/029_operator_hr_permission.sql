-- Give HR a distinct operator workspace permission without altering existing grants.
-- Only the canonical initial operator gets HR access by default.
ALTER TABLE identity_operator_permissions
    DROP CONSTRAINT identity_operator_permissions_permission_chk,
    ADD CONSTRAINT identity_operator_permissions_permission_chk
        CHECK (permission IN ('operations','partners','catalog','marketing','finance','platform_policies','hr'));

INSERT INTO identity_operator_permissions(actor_id,permission,enabled,version,changed_by_actor_id,reason)
SELECT r.actor_id,'hr',
       COALESCE(r.actor_id = bootstrap.initial_operator_actor_id, false),
       1,
       CASE WHEN r.actor_id=bootstrap.initial_operator_actor_id THEN r.actor_id ELSE NULL END,
       CASE WHEN r.actor_id=bootstrap.initial_operator_actor_id THEN 'initial operator HR access'
            ELSE 'HR permission not granted' END
FROM identity_actor_roles r
LEFT JOIN identity_bootstrap_state bootstrap ON bootstrap.id=1
WHERE r.role='operator'
ON CONFLICT(actor_id,permission) DO NOTHING;
