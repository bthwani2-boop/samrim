ALTER TABLE identity_operator_permissions
    DROP CONSTRAINT identity_operator_permissions_permission_chk,
    ADD CONSTRAINT identity_operator_permissions_permission_chk
        CHECK (permission IN ('finance', 'platform_policies'));

INSERT INTO identity_operator_permissions(actor_id, permission, enabled, version, changed_by_actor_id, reason)
SELECT r.actor_id,
       'platform_policies',
       r.actor_id = bootstrap.initial_operator_actor_id,
       1,
       CASE WHEN r.actor_id = bootstrap.initial_operator_actor_id THEN r.actor_id ELSE NULL END,
       CASE WHEN r.actor_id = bootstrap.initial_operator_actor_id THEN 'initial operator bootstrap' ELSE 'Platform Policies permission not granted' END
FROM identity_actor_roles r
LEFT JOIN identity_bootstrap_state bootstrap ON bootstrap.id = 1
WHERE r.role = 'operator';
