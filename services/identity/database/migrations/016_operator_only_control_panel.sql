-- Canonical control-panel cutover: operator is the only human role.
-- The one-time bootstrap remains a lifecycle fact, not a second role.

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'identity_bootstrap_state'
          AND column_name = 'platform_owner_actor_id'
    ) THEN
        ALTER TABLE identity_bootstrap_state
            RENAME COLUMN platform_owner_actor_id TO initial_operator_actor_id;
    END IF;
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'identity_bootstrap_state_platform_owner_actor_id_fkey'
    ) THEN
        ALTER TABLE identity_bootstrap_state
            RENAME CONSTRAINT identity_bootstrap_state_platform_owner_actor_id_fkey
            TO identity_bootstrap_state_initial_operator_actor_id_fkey;
    END IF;
END $$;

-- Materialize the canonical operator parent row before migrating children that
-- reference (actor_id, role). This avoids changing a referenced composite key
-- in place and keeps the cutover valid with non-deferrable foreign keys.
INSERT INTO identity_actor_roles(actor_id, role, enabled, activated_at, version)
SELECT actor_id, 'operator', enabled, activated_at, version
FROM identity_actor_roles
WHERE role = 'platform_owner'
ON CONFLICT (actor_id, role) DO UPDATE
SET enabled = identity_actor_roles.enabled OR EXCLUDED.enabled,
    activated_at = COALESCE(identity_actor_roles.activated_at, EXCLUDED.activated_at),
    version = GREATEST(identity_actor_roles.version, EXCLUDED.version) + 1,
    updated_at = clock_timestamp();

INSERT INTO identity_password_credentials(actor_id, role, password_hash, version)
SELECT actor_id, 'operator', password_hash, version
FROM identity_password_credentials
WHERE role = 'platform_owner'
ON CONFLICT (actor_id, role) DO UPDATE
SET password_hash = EXCLUDED.password_hash,
    version = GREATEST(identity_password_credentials.version, EXCLUDED.version) + 1,
    updated_at = clock_timestamp();

UPDATE identity_challenges
SET role = 'operator', updated_at = clock_timestamp()
WHERE role = 'platform_owner';

UPDATE identity_sessions
SET role = 'operator', updated_at = clock_timestamp()
WHERE role = 'platform_owner';

UPDATE identity_password_attempts
SET role = 'operator', updated_at = clock_timestamp()
WHERE role = 'platform_owner';

DELETE FROM identity_password_credentials
WHERE role = 'platform_owner';

DELETE FROM identity_actor_roles
WHERE role = 'platform_owner';

ALTER TABLE identity_actor_roles
    DROP CONSTRAINT identity_actor_role_check,
    ADD CONSTRAINT identity_actor_role_check
    CHECK (role IN ('client','partner','captain','field','operator'));

ALTER TABLE identity_actor_roles
    DROP CONSTRAINT identity_actor_role_activation_check,
    ADD CONSTRAINT identity_actor_role_activation_check CHECK (
        role IN ('partner','captain','field','operator') OR activated_at IS NULL
    );

ALTER TABLE identity_password_credentials
    DROP CONSTRAINT identity_password_credential_role_check,
    ADD CONSTRAINT identity_password_credential_role_check
    CHECK (role IN ('client','partner','captain','field','operator'));

ALTER TABLE identity_challenges
    DROP CONSTRAINT identity_challenge_role_check,
    ADD CONSTRAINT identity_challenge_role_check
    CHECK (role IN ('client','partner','captain','field','operator'));

ALTER TABLE identity_challenges
    DROP CONSTRAINT identity_challenge_purpose_role_check,
    ADD CONSTRAINT identity_challenge_purpose_role_check CHECK (
        (purpose IN ('client_register','client_recover') AND role='client') OR
        (purpose IN ('managed_activate','managed_recover') AND role IN ('partner','captain','field','operator')) OR
        (purpose='operator_mfa' AND role='operator')
    );

ALTER TABLE identity_sessions
    DROP CONSTRAINT identity_session_role_check,
    ADD CONSTRAINT identity_session_role_check
    CHECK (role IN ('client','partner','captain','field','operator'));

ALTER TABLE identity_password_attempts
    DROP CONSTRAINT identity_password_attempt_role_check,
    ADD CONSTRAINT identity_password_attempt_role_check
    CHECK (role IN ('client','partner','captain','field','operator'));

INSERT INTO identity_schema_migrations(version)
VALUES (16)
ON CONFLICT (version) DO NOTHING;
