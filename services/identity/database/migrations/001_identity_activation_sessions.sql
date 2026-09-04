CREATE TABLE IF NOT EXISTS identity_schema_migrations (
    version integer PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS identity_actors (
    id text PRIMARY KEY,
    username varchar(64) NOT NULL,
    phone_e164 varchar(16) NOT NULL,
    operator_context_id varchar(128) NOT NULL,
    roles text[] NOT NULL,
    permissions jsonb NOT NULL DEFAULT '[]'::jsonb,
    password_hash text NOT NULL DEFAULT '',
    status varchar(32) NOT NULL,
    version integer NOT NULL DEFAULT 1,
    provisioning_fingerprint char(64) NOT NULL,
    created_by_service varchar(64) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT identity_actor_status_check CHECK (
        status IN ('PROVISIONED', 'PENDING_ACTIVATION', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED')
    ),
    CONSTRAINT identity_actor_version_check CHECK (version > 0),
    CONSTRAINT identity_actor_phone_check CHECK (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
    CONSTRAINT identity_actor_roles_nonempty_check CHECK (cardinality(roles) >= 1)
);

CREATE UNIQUE INDEX IF NOT EXISTS identity_actors_username_uq ON identity_actors (lower(username));
CREATE UNIQUE INDEX IF NOT EXISTS identity_actors_phone_uq ON identity_actors (phone_e164);
CREATE INDEX IF NOT EXISTS identity_actors_context_idx ON identity_actors (operator_context_id, lower(username), id);

CREATE TABLE IF NOT EXISTS identity_activation_challenges (
    id text PRIMARY KEY,
    actor_id text NOT NULL REFERENCES identity_actors(id) ON DELETE CASCADE,
    actor_type varchar(32) NOT NULL,
    phone_e164 varchar(16) NOT NULL,
    surface varchar(32) NOT NULL,
    code_hash char(64) NOT NULL,
    status varchar(16) NOT NULL DEFAULT 'pending',
    attempts integer NOT NULL DEFAULT 0,
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz,
    issued_by varchar(128) NOT NULL,
    idempotency_scope varchar(256),
    idempotency_key varchar(128),
    correlation_id varchar(128),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT identity_activation_actor_type_check CHECK (actor_type IN ('client','partner','captain','field','operator')),
    CONSTRAINT identity_activation_surface_check CHECK (surface IN ('app-client','app-partner','app-captain','app-field','control-panel')),
    CONSTRAINT identity_activation_status_check CHECK (status IN ('pending','consumed','revoked','expired','locked')),
    CONSTRAINT identity_activation_attempts_check CHECK (attempts BETWEEN 0 AND 5),
    CONSTRAINT identity_activation_consumed_check CHECK (
        (status = 'consumed' AND consumed_at IS NOT NULL) OR
        (status <> 'consumed' AND consumed_at IS NULL)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS identity_activation_one_pending_uq
    ON identity_activation_challenges(actor_id, surface)
    WHERE status = 'pending';
CREATE UNIQUE INDEX IF NOT EXISTS identity_activation_idempotency_uq
    ON identity_activation_challenges(idempotency_scope, idempotency_key)
    WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS identity_activation_lookup_idx
    ON identity_activation_challenges(actor_type, phone_e164, surface, created_at DESC);

CREATE TABLE IF NOT EXISTS identity_sessions (
    id text PRIMARY KEY,
    actor_id text NOT NULL REFERENCES identity_actors(id) ON DELETE CASCADE,
    surface varchar(32) NOT NULL,
    access_token_hash char(64) NOT NULL,
    refresh_token_hash char(64) NOT NULL,
    previous_refresh_token_hash char(64),
    device_fingerprint_hash char(64) NOT NULL,
    access_expires_at timestamptz NOT NULL,
    refresh_expires_at timestamptz NOT NULL,
    revoked_at timestamptz,
    compromised_at timestamptz,
    last_used_at timestamptz,
    version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT identity_session_surface_check CHECK (surface IN ('app-client','app-partner','app-captain','app-field','control-panel')),
    CONSTRAINT identity_session_expiry_check CHECK (refresh_expires_at > access_expires_at),
    CONSTRAINT identity_session_version_check CHECK (version > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS identity_sessions_access_hash_uq ON identity_sessions(access_token_hash);
CREATE UNIQUE INDEX IF NOT EXISTS identity_sessions_refresh_hash_uq ON identity_sessions(refresh_token_hash);

CREATE TABLE IF NOT EXISTS identity_refresh_token_history (
    session_id text NOT NULL REFERENCES identity_sessions(id) ON DELETE CASCADE,
    token_hash char(64) NOT NULL,
    rotated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (session_id, token_hash)
);
CREATE UNIQUE INDEX IF NOT EXISTS identity_refresh_token_history_hash_uq
    ON identity_refresh_token_history(token_hash);
CREATE INDEX IF NOT EXISTS identity_refresh_token_history_session_idx
    ON identity_refresh_token_history(session_id, rotated_at DESC);

CREATE INDEX IF NOT EXISTS identity_sessions_actor_idx ON identity_sessions(actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS identity_sessions_active_idx ON identity_sessions(actor_id, refresh_expires_at) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS identity_login_attempts (
    id bigserial PRIMARY KEY,
    username varchar(64) NOT NULL,
    ip_hash char(64) NOT NULL,
    succeeded boolean NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS identity_login_attempts_username_idx ON identity_login_attempts(username, created_at DESC);

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
