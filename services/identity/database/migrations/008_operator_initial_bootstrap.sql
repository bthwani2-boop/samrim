-- Initial Operator enrollment state for a disposable, isolated Identity schema.
-- It cannot activate a protected actor, and never seeds credentials or scopes.
-- Requires migrations 001-007. Do not execute against shared/protected data.
CREATE TABLE __SCHEMA__.operator_initial_bootstrap (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    proof_digest bytea NOT NULL CHECK (octet_length(proof_digest)=32),
    actor_id text NOT NULL CHECK (actor_id ~ '^operator-root-[A-Za-z0-9_-]{43}$'),
    user_handle bytea NOT NULL CHECK (octet_length(user_handle)=32),
    ceremony_id bytea CHECK (ceremony_id IS NULL OR octet_length(ceremony_id)=32),
    session_data jsonb CHECK (session_data IS NULL OR jsonb_typeof(session_data)='object'),
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CHECK ((ceremony_id IS NULL) = (session_data IS NULL)),
    CHECK (expires_at > created_at AND expires_at <= created_at + interval '10 minutes'),
    CHECK (consumed_at IS NULL OR consumed_at >= created_at)
);
-- Only the Identity application role can insert/consume; no browser/DSH/WLT grants.
