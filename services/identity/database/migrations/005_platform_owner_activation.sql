ALTER TABLE identity_actor_roles
    DROP CONSTRAINT identity_actor_role_activation_check,
    ADD CONSTRAINT identity_actor_role_activation_check CHECK (
        role IN ('partner','captain','field','operator','platform_owner') OR activated_at IS NULL
    );

INSERT INTO identity_schema_migrations(version)
VALUES (5)
ON CONFLICT (version) DO NOTHING;
