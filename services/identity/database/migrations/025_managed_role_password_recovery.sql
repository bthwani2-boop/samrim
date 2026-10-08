ALTER TABLE identity_challenges
    DROP CONSTRAINT identity_challenge_purpose_check,
    ADD CONSTRAINT identity_challenge_purpose_check
    CHECK (purpose IN ('client_register','client_recover','managed_activate','managed_recover','operator_enroll','operator_recover'));

ALTER TABLE identity_challenges
    DROP CONSTRAINT identity_challenge_purpose_role_check,
    ADD CONSTRAINT identity_challenge_purpose_role_check CHECK (
        (purpose IN ('client_register','client_recover') AND role='client') OR
        (purpose IN ('managed_activate','managed_recover') AND role IN ('partner','captain','field')) OR
        (purpose IN ('operator_enroll','operator_recover') AND role='operator')
    );
