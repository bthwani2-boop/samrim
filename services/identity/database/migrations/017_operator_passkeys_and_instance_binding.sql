-- Forward-only operator Passkey cutover and precise client-install binding.
-- Applied migrations 001..016 are immutable and remain historical evidence.

ALTER TABLE identity_sessions
    RENAME COLUMN device_fingerprint_hash TO client_instance_id_hash;

UPDATE identity_challenges
SET status = 'revoked', consumed_at = NULL, updated_at = clock_timestamp()
WHERE purpose IN ('managed_recover', 'operator_mfa');

UPDATE identity_challenges
SET status = 'revoked', consumed_at = NULL, updated_at = clock_timestamp()
WHERE role = 'operator' AND purpose = 'managed_activate';

-- Deprecated proof purposes have no valid post-cutover consumer. Remove their
-- ephemeral rows after revocation so the tightened purpose contract cannot
-- preserve a shadow authorization path.
DELETE FROM identity_challenges
WHERE purpose IN ('managed_recover', 'operator_mfa')
   OR (role = 'operator' AND purpose = 'managed_activate');

DELETE FROM identity_password_attempts
WHERE role = 'operator';

DELETE FROM identity_password_credentials WHERE role = 'operator';

ALTER TABLE identity_password_attempts
    DROP CONSTRAINT identity_password_attempt_role_check,
    ADD CONSTRAINT identity_password_attempt_role_check
    CHECK (role IN ('client','partner','captain','field'));

ALTER TABLE identity_password_credentials
    DROP CONSTRAINT identity_password_credential_role_check,
    ADD CONSTRAINT identity_password_credential_role_check
    CHECK (role IN ('client','partner','captain','field'));

ALTER TABLE identity_challenges
    DROP CONSTRAINT identity_challenge_purpose_check,
    ADD CONSTRAINT identity_challenge_purpose_check
    CHECK (purpose IN ('client_register','client_recover','managed_activate','operator_enroll','operator_recover'));

ALTER TABLE identity_challenges
    DROP CONSTRAINT identity_challenge_purpose_role_check,
    ADD CONSTRAINT identity_challenge_purpose_role_check CHECK (
        (purpose IN ('client_register','client_recover') AND role='client') OR
        (purpose='managed_activate' AND role IN ('partner','captain','field')) OR
        (purpose IN ('operator_enroll','operator_recover') AND role='operator')
    );

CREATE TABLE IF NOT EXISTS identity_webauthn_users (
    rp_id text NOT NULL,
    actor_id text NOT NULL,
    user_handle bytea NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (rp_id, actor_id),
    CONSTRAINT identity_webauthn_user_actor_fk FOREIGN KEY (actor_id) REFERENCES identity_actors(id) ON DELETE CASCADE,
    CONSTRAINT identity_webauthn_user_handle_uq UNIQUE (rp_id, user_handle)
);

CREATE TABLE IF NOT EXISTS identity_webauthn_credentials (
    rp_id text NOT NULL,
    credential_id bytea NOT NULL,
    actor_id text NOT NULL,
    credential_json jsonb NOT NULL,
    sign_count bigint NOT NULL DEFAULT 0,
    clone_warning boolean NOT NULL DEFAULT false,
    backup_state boolean NOT NULL DEFAULT false,
    last_used_at timestamptz,
    revoked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (rp_id, credential_id),
    CONSTRAINT identity_webauthn_credential_actor_fk FOREIGN KEY (actor_id) REFERENCES identity_actors(id) ON DELETE CASCADE,
    CONSTRAINT identity_webauthn_credential_sign_count_check CHECK (sign_count >= 0)
);

CREATE INDEX IF NOT EXISTS identity_webauthn_credentials_actor_idx
    ON identity_webauthn_credentials (rp_id, actor_id, created_at);
CREATE INDEX IF NOT EXISTS identity_webauthn_credentials_active_idx
    ON identity_webauthn_credentials (rp_id, credential_id)
    WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS identity_webauthn_ceremonies (
    id text PRIMARY KEY,
    kind text NOT NULL,
    actor_id text,
    challenge text NOT NULL,
    session_data jsonb NOT NULL,
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT identity_webauthn_ceremony_kind_check CHECK (kind IN ('operator_registration','operator_recovery_registration','operator_authentication')),
    CONSTRAINT identity_webauthn_ceremony_actor_fk FOREIGN KEY (actor_id) REFERENCES identity_actors(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS identity_webauthn_ceremonies_challenge_uq
    ON identity_webauthn_ceremonies (challenge);
CREATE INDEX IF NOT EXISTS identity_webauthn_ceremonies_expiry_idx
    ON identity_webauthn_ceremonies (expires_at);

CREATE TABLE IF NOT EXISTS identity_operator_recovery_credentials (
    id text PRIMARY KEY,
    actor_id text NOT NULL,
    credential_hash char(64) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    used_at timestamptz,
    revoked_at timestamptz,
    CONSTRAINT identity_operator_recovery_credential_actor_fk FOREIGN KEY (actor_id) REFERENCES identity_actors(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS identity_operator_recovery_credentials_active_uq
    ON identity_operator_recovery_credentials (actor_id)
    WHERE revoked_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS identity_operator_recovery_credentials_hash_uq
    ON identity_operator_recovery_credentials (credential_hash);
CREATE INDEX IF NOT EXISTS identity_operator_recovery_credentials_actor_idx
    ON identity_operator_recovery_credentials (actor_id, created_at DESC);
