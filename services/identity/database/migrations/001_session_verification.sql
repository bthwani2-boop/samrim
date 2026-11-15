-- Identity owner: isolated synthetic development baseline only.
-- Replace __SCHEMA__ after strict identity_test_* identifier and absence checks.
-- Do not apply this migration to an existing/protected Identity namespace.
CREATE SCHEMA __SCHEMA__;
CREATE TABLE __SCHEMA__.actors (
    id text PRIMARY KEY CHECK (char_length(id) BETWEEN 1 AND 128),
    status text NOT NULL CHECK (status IN ('ACTIVE','SUSPENDED','DISABLED')),
    auth_version bigint NOT NULL DEFAULT 1 CHECK (auth_version > 0),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE __SCHEMA__.actor_roles (
    actor_id text NOT NULL REFERENCES __SCHEMA__.actors(id),
    role text NOT NULL CHECK (role IN ('customer','merchant','captain','operator')),
    status text NOT NULL CHECK (status IN ('ACTIVE','SUSPENDED','DISABLED')),
    version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (actor_id,role)
);
CREATE TABLE __SCHEMA__.auth_sessions (
    token_digest bytea PRIMARY KEY CHECK (octet_length(token_digest)=32),
    actor_id text NOT NULL,
    role text NOT NULL,
    actor_version bigint NOT NULL CHECK (actor_version > 0),
    role_version bigint NOT NULL CHECK (role_version > 0),
    issued_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz,
    FOREIGN KEY (actor_id,role) REFERENCES __SCHEMA__.actor_roles(actor_id,role),
    CHECK (expires_at > issued_at),
    CHECK (revoked_at IS NULL OR revoked_at >= issued_at)
);
CREATE INDEX idx_auth_sessions_actor ON __SCHEMA__.auth_sessions (actor_id,role,expires_at);
