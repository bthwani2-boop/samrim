ALTER TABLE identity_actor_roles
    DROP CONSTRAINT identity_actor_role_check,
    ADD CONSTRAINT identity_actor_role_check CHECK (role IN ('client','partner','captain','field','operator','platform_owner'));

ALTER TABLE identity_actor_roles
    DROP CONSTRAINT identity_actor_role_activation_check,
    ADD CONSTRAINT identity_actor_role_activation_check CHECK (
        role IN ('partner','captain','field','operator') OR activated_at IS NULL
    );

ALTER TABLE identity_password_credentials
    DROP CONSTRAINT identity_password_credential_role_check,
    ADD CONSTRAINT identity_password_credential_role_check CHECK (role IN ('client','operator','platform_owner'));

ALTER TABLE identity_challenges
    DROP CONSTRAINT identity_challenge_role_check,
    ADD CONSTRAINT identity_challenge_role_check CHECK (role IN ('client','partner','captain','field','operator','platform_owner'));

ALTER TABLE identity_challenges
    DROP CONSTRAINT identity_challenge_purpose_role_check,
    ADD CONSTRAINT identity_challenge_purpose_role_check CHECK (
        (purpose IN ('client_register','client_recover') AND role='client') OR
        (purpose='managed_activate' AND role IN ('partner','captain','field','operator')) OR
        (purpose='operator_mfa' AND role IN ('operator','platform_owner'))
    );

ALTER TABLE identity_sessions
    DROP CONSTRAINT identity_session_role_check,
    ADD CONSTRAINT identity_session_role_check CHECK (role IN ('client','partner','captain','field','operator','platform_owner'));

ALTER TABLE identity_password_attempts
    DROP CONSTRAINT identity_password_attempt_role_check,
    ADD CONSTRAINT identity_password_attempt_role_check CHECK (role IN ('client','operator','platform_owner'));

ALTER TABLE identity_managed_activation_codes
    DROP CONSTRAINT identity_managed_activation_code_role_check,
    ADD CONSTRAINT identity_managed_activation_code_role_check CHECK (role IN ('partner','captain','field','operator'));

INSERT INTO identity_schema_migrations(version)
VALUES (4)
ON CONFLICT (version) DO NOTHING;
