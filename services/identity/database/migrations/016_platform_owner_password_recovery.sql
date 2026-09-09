-- Platform-owner password recovery uses the existing phone-proof recovery
-- lifecycle. Keep platform-owner activation bootstrap-only.
ALTER TABLE identity_challenges
    DROP CONSTRAINT identity_challenge_purpose_role_check,
    ADD CONSTRAINT identity_challenge_purpose_role_check CHECK (
        (purpose IN ('client_register','client_recover') AND role='client') OR
        (purpose='managed_activate' AND role IN ('partner','captain','field','operator')) OR
        (purpose='managed_recover' AND role IN ('partner','captain','field','operator','platform_owner')) OR
        (purpose='operator_mfa' AND role IN ('operator','platform_owner'))
    );
