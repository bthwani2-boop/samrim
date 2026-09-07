DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'identity_actors'
          AND column_name IN (
              'username','password_hash','operator_context_id','roles','permissions',
              'status','provisioning_fingerprint','created_by_service'
          )
    ) THEN
        RAISE EXCEPTION 'legacy Identity credential/schema shape detected; reset the non-production Identity database before applying the canonical authentication baseline';
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS identity_schema_migrations (
    version integer PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS identity_actors (
    id text PRIMARY KEY,
    phone_e164 varchar(16) NOT NULL,
    security_enabled boolean NOT NULL DEFAULT true,
    version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT identity_actor_version_check CHECK (version > 0),
    CONSTRAINT identity_actor_phone_check CHECK (phone_e164 ~ '^\+[1-9][0-9]{7,14}$')
);
CREATE UNIQUE INDEX IF NOT EXISTS identity_actors_phone_uq ON identity_actors(phone_e164);

CREATE TABLE IF NOT EXISTS identity_actor_roles (
    actor_id text NOT NULL REFERENCES identity_actors(id) ON DELETE CASCADE,
    role varchar(32) NOT NULL,
    enabled boolean NOT NULL DEFAULT true,
    activated_at timestamptz,
    version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (actor_id, role),
    CONSTRAINT identity_actor_role_check CHECK (role IN ('client','partner','captain','field','operator')),
    CONSTRAINT identity_actor_role_version_check CHECK (version > 0),
    CONSTRAINT identity_actor_role_activation_check CHECK (
        role IN ('partner','captain','field') OR activated_at IS NULL
    )
);
CREATE INDEX IF NOT EXISTS identity_actor_roles_role_idx ON identity_actor_roles(role, enabled, actor_id);

CREATE TABLE IF NOT EXISTS identity_password_credentials (
    actor_id text NOT NULL,
    role varchar(32) NOT NULL,
    password_hash text NOT NULL,
    version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (actor_id, role),
    FOREIGN KEY (actor_id, role) REFERENCES identity_actor_roles(actor_id, role) ON DELETE CASCADE,
    CONSTRAINT identity_password_credential_role_check CHECK (role IN ('client','operator')),
    CONSTRAINT identity_password_credential_version_check CHECK (version > 0)
);

CREATE TABLE IF NOT EXISTS identity_challenges (
    id text PRIMARY KEY,
    actor_id text REFERENCES identity_actors(id) ON DELETE CASCADE,
    role varchar(32) NOT NULL,
    purpose varchar(32) NOT NULL,
    phone_e164 varchar(16) NOT NULL,
    code_hash char(64) NOT NULL,
    request_ip_hash char(64) NOT NULL,
    admissible boolean NOT NULL DEFAULT false,
    status varchar(16) NOT NULL DEFAULT 'pending',
    attempts integer NOT NULL DEFAULT 0,
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT identity_challenge_role_check CHECK (role IN ('client','partner','captain','field','operator')),
    CONSTRAINT identity_challenge_purpose_check CHECK (purpose IN ('client_register','client_recover','managed_activate','operator_mfa')),
    CONSTRAINT identity_challenge_purpose_role_check CHECK (
        (purpose IN ('client_register','client_recover') AND role='client') OR
        (purpose='managed_activate' AND role IN ('partner','captain','field')) OR
        (purpose='operator_mfa' AND role='operator')
    ),
    CONSTRAINT identity_challenge_status_check CHECK (status IN ('pending','consumed','revoked','expired','locked')),
    CONSTRAINT identity_challenge_attempts_check CHECK (attempts BETWEEN 0 AND 5),
    CONSTRAINT identity_challenge_consumed_check CHECK (
        (status='consumed' AND consumed_at IS NOT NULL) OR
        (status<>'consumed' AND consumed_at IS NULL)
    )
);
CREATE UNIQUE INDEX IF NOT EXISTS identity_challenges_one_pending_uq
    ON identity_challenges(purpose, role, phone_e164)
    WHERE status='pending';
CREATE INDEX IF NOT EXISTS identity_challenges_lookup_idx
    ON identity_challenges(purpose, role, phone_e164, created_at DESC);
CREATE INDEX IF NOT EXISTS identity_challenges_ip_idx
    ON identity_challenges(request_ip_hash, created_at DESC);

CREATE TABLE IF NOT EXISTS identity_sessions (
    id text PRIMARY KEY,
    actor_id text NOT NULL,
    role varchar(32) NOT NULL,
    access_token_hash char(64) NOT NULL,
    refresh_token_hash char(64) NOT NULL,
    device_fingerprint_hash char(64) NOT NULL,
    access_expires_at timestamptz NOT NULL,
    refresh_expires_at timestamptz NOT NULL,
    revoked_at timestamptz,
    compromised_at timestamptz,
    last_used_at timestamptz,
    version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (actor_id, role) REFERENCES identity_actor_roles(actor_id, role) ON DELETE CASCADE,
    CONSTRAINT identity_session_role_check CHECK (role IN ('client','partner','captain','field','operator')),
    CONSTRAINT identity_session_expiry_check CHECK (refresh_expires_at > access_expires_at),
    CONSTRAINT identity_session_version_check CHECK (version > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS identity_sessions_access_hash_uq ON identity_sessions(access_token_hash);
CREATE UNIQUE INDEX IF NOT EXISTS identity_sessions_refresh_hash_uq ON identity_sessions(refresh_token_hash);
CREATE INDEX IF NOT EXISTS identity_sessions_actor_role_idx ON identity_sessions(actor_id, role, created_at DESC);
CREATE INDEX IF NOT EXISTS identity_sessions_active_idx ON identity_sessions(actor_id, role, refresh_expires_at) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS identity_refresh_token_history (
    session_id text NOT NULL REFERENCES identity_sessions(id) ON DELETE CASCADE,
    token_hash char(64) NOT NULL,
    rotated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (session_id, token_hash)
);
CREATE UNIQUE INDEX IF NOT EXISTS identity_refresh_token_history_hash_uq ON identity_refresh_token_history(token_hash);
CREATE INDEX IF NOT EXISTS identity_refresh_token_history_session_idx ON identity_refresh_token_history(session_id, rotated_at DESC);

CREATE TABLE IF NOT EXISTS identity_password_attempts (
    id bigserial PRIMARY KEY,
    phone_e164 varchar(16) NOT NULL,
    role varchar(32) NOT NULL,
    ip_hash char(64) NOT NULL,
    succeeded boolean NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT identity_password_attempt_role_check CHECK (role IN ('client','operator'))
);
CREATE INDEX IF NOT EXISTS identity_password_attempts_subject_idx ON identity_password_attempts(phone_e164, role, created_at DESC);
CREATE INDEX IF NOT EXISTS identity_password_attempts_ip_idx ON identity_password_attempts(ip_hash, created_at DESC);

CREATE TABLE IF NOT EXISTS identity_security_audit (
    id bigserial PRIMARY KEY,
    event_type varchar(64) NOT NULL,
    subject_actor_id text REFERENCES identity_actors(id) ON DELETE SET NULL,
    principal varchar(128) NOT NULL,
    outcome varchar(32) NOT NULL,
    correlation_id varchar(128),
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS identity_security_audit_subject_idx ON identity_security_audit(subject_actor_id, created_at DESC);

INSERT INTO identity_schema_migrations(version)
VALUES (1)
ON CONFLICT (version) DO NOTHING;
