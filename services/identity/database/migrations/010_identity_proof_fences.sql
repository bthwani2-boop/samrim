ALTER TABLE identity_challenges
    ADD COLUMN IF NOT EXISTS credential_version integer;

ALTER TABLE identity_challenges
    DROP CONSTRAINT identity_challenge_purpose_role_check,
    ADD CONSTRAINT identity_challenge_purpose_role_check CHECK (
        (purpose IN ('client_register','client_recover') AND role='client') OR
        (purpose IN ('managed_activate','managed_recover') AND role IN ('partner','captain','field','operator')) OR
        (purpose='operator_mfa' AND role IN ('operator','platform_owner'))
    );

CREATE UNIQUE INDEX IF NOT EXISTS identity_actor_roles_platform_owner_uq
    ON identity_actor_roles(role)
    WHERE role='platform_owner';

INSERT INTO identity_schema_migrations(version)
VALUES (10)
ON CONFLICT (version) DO NOTHING;
