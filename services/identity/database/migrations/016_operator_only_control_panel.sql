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
END $$;

-- If an actor somehow has both legacy owner and operator rows, merge into the
-- operator row before removing the legacy row so the migration is deterministic.
UPDATE identity_actor_roles AS operator_role
SET enabled = operator_role.enabled OR owner_role.enabled,
    activated_at = COALESCE(operator_role.activated_at, owner_role.activated_at),
    version = GREATEST(operator_role.version, owner_role.version) + 1,
    updated_at = clock_timestamp()
FROM identity_actor_roles AS owner_role
WHERE operator_role.actor_id = owner_role.actor_id
  AND operator_role.role = 'operator'
  AND owner_role.role = 'platform_owner';

DELETE FROM identity_actor_roles AS owner_role
USING identity_actor_roles AS operator_role
WHERE owner_role.actor_id = operator_role.actor_id
  AND owner_role.role = 'platform_owner'
  AND operator_role.role = 'operator';

UPDATE identity_actor_roles
SET role = 'operator', updated_at = clock_timestamp()
WHERE role = 'platform_owner';

-- Preserve the legacy owner's password as the operator credential if both rows
-- exist; otherwise rename the legacy credential in place.
UPDATE identity_password_credentials AS operator_credential
SET password_hash = owner_credential.password_hash,
    version = GREATEST(operator_credential.version, owner_credential.version) + 1,
    updated_at = clock_timestamp()
FROM identity_password_credentials AS owner_credential
WHERE operator_credential.actor_id = owner_credential.actor_id
  AND operator_credential.role = 'operator'
  AND owner_credential.role = 'platform_owner';

DELETE FROM identity_password_credentials AS owner_credential
USING identity_password_credentials AS operator_credential
WHERE owner_credential.actor_id = operator_credential.actor_id
  AND owner_credential.role = 'platform_owner'
  AND operator_credential.role = 'operator';

UPDATE identity_password_credentials
SET role = 'operator', updated_at = clock_timestamp()
WHERE role = 'platform_owner';

UPDATE identity_challenges
SET role = 'operator', updated_at = clock_timestamp()
WHERE role = 'platform_owner';

UPDATE identity_sessions
SET role = 'operator', updated_at = clock_timestamp()
WHERE role = 'platform_owner';

UPDATE identity_password_attempts
SET role = 'operator', updated_at = clock_timestamp()
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
    CHECK (role IN ('client','operator'));

ALTER TABLE identity_challenges
    DROP CONSTRAINT identity_challenge_role_check,
    ADD CONSTRAINT identity_challenge_role_check
    CHECK (role IN ('client','partner','captain','field','operator'));

ALTER TABLE identity_challenges
    DROP CONSTRAINT identity_challenge_purpose_role_check,
    ADD CONSTRAINT identity_challenge_purpose_role_check CHECK (
        (purpose IN ('client_register','client_recover') AND role='client') OR
        (purpose='managed_activate' AND role IN ('partner','captain','field','operator')) OR
        (purpose='managed_recover' AND role IN ('partner','captain','field','operator')) OR
        (purpose='operator_mfa' AND role='operator')
    );

ALTER TABLE identity_sessions
    DROP CONSTRAINT identity_session_role_check,
    ADD CONSTRAINT identity_session_role_check
    CHECK (role IN ('client','partner','captain','field','operator'));

ALTER TABLE identity_password_attempts
    DROP CONSTRAINT identity_password_attempt_role_check,
    ADD CONSTRAINT identity_password_attempt_role_check
    CHECK (role IN ('client','operator'));

INSERT INTO identity_schema_migrations(version)
VALUES (16)
ON CONFLICT (version) DO NOTHING;
