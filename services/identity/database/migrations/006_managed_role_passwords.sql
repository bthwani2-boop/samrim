ALTER TABLE identity_password_credentials
    DROP CONSTRAINT identity_password_credential_role_check,
    ADD CONSTRAINT identity_password_credential_role_check CHECK (
        role IN ('client','partner','captain','field','operator','platform_owner')
    );

ALTER TABLE identity_password_attempts
    DROP CONSTRAINT identity_password_attempt_role_check,
    ADD CONSTRAINT identity_password_attempt_role_check CHECK (
        role IN ('client','partner','captain','field','operator','platform_owner')
    );

-- Managed roles own their password after phone-proof activation; keep the
-- credential and rate-limit constraints aligned with that single identity model.
INSERT INTO identity_schema_migrations(version)
VALUES (6)
ON CONFLICT (version) DO NOTHING;
