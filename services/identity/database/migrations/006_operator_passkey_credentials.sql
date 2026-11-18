-- Identity-owned user-verified WebAuthn state for the isolated progressive
-- Operator journey. Requires Identity migrations 001-005.
-- This migration only creates empty structures. It NEVER creates the original
-- Operator, inserts an authenticator, grants a role, or enables recovery.
-- Apply ONLY after strict identity_test_* schema validation in an isolated DB.

CREATE TABLE __SCHEMA__.operator_passkey_users (
    rp_id text NOT NULL CHECK (char_length(rp_id) BETWEEN 1 AND 253),
    actor_id text NOT NULL,
    role text NOT NULL DEFAULT 'operator' CHECK (role='operator'),
    user_handle bytea NOT NULL CHECK (octet_length(user_handle) BETWEEN 16 AND 64),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (rp_id, actor_id),
    UNIQUE (rp_id, user_handle),
    FOREIGN KEY (actor_id, role) REFERENCES __SCHEMA__.actor_roles(actor_id,role)
);

CREATE TABLE __SCHEMA__.operator_passkey_credentials (
    rp_id text NOT NULL,
    credential_id bytea NOT NULL CHECK (octet_length(credential_id) BETWEEN 16 AND 1024),
    actor_id text NOT NULL,
    credential_json jsonb NOT NULL CHECK (jsonb_typeof(credential_json)='object'),
    sign_count bigint NOT NULL DEFAULT 0 CHECK (sign_count>=0),
    backup_eligible boolean NOT NULL DEFAULT false,
    backup_state boolean NOT NULL DEFAULT false,
    clone_warning boolean NOT NULL DEFAULT false,
    revoked_at timestamptz,
    last_used_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (rp_id, credential_id),
    FOREIGN KEY (rp_id, actor_id)
        REFERENCES __SCHEMA__.operator_passkey_users(rp_id, actor_id),
    CHECK (NOT backup_state OR backup_eligible)
);
CREATE INDEX idx_operator_passkey_credentials_actor
    ON __SCHEMA__.operator_passkey_credentials (rp_id, actor_id, created_at);
CREATE INDEX idx_operator_passkey_credentials_active
    ON __SCHEMA__.operator_passkey_credentials (rp_id, credential_id)
    WHERE revoked_at IS NULL;

-- The server stores only a cryptographically random challenge and a bounded
-- ceremony state. The library must verify clientDataJSON origin, RPID hash,
-- challenge, user verification, signature, counter and authorization policy.
-- A transaction must lock and consume this row exactly once BEFORE returning
-- an issued Identity bearer, and roll back if the assertion is not valid.
CREATE TABLE __SCHEMA__.operator_passkey_ceremonies (
    ceremony_id bytea PRIMARY KEY CHECK (octet_length(ceremony_id)=32),
    challenge bytea NOT NULL UNIQUE CHECK (octet_length(challenge)>=32),
    kind text NOT NULL CHECK (kind IN ('AUTHENTICATE','ENROLL','RECOVER')),
    rp_id text NOT NULL CHECK (char_length(rp_id) BETWEEN 1 AND 253),
    actor_id text REFERENCES __SCHEMA__.actors(id),
    session_data jsonb NOT NULL CHECK (jsonb_typeof(session_data)='object'),
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CHECK (expires_at > created_at AND expires_at <= created_at+interval '5 minutes'),
    CHECK (consumed_at IS NULL OR consumed_at >= created_at),
    CHECK (kind='AUTHENTICATE' OR actor_id IS NOT NULL)
);
CREATE INDEX idx_operator_passkey_ceremonies_expiry
    ON __SCHEMA__.operator_passkey_ceremonies(expires_at);

-- Recovery tokens must be high-entropy user-held proofs stored only as digests.
-- Inserting one requires independently authorized original-actor continuity.
-- Presenting this digest alone must NEVER issue an Operator session.
CREATE TABLE __SCHEMA__.operator_passkey_recovery_proofs (
    proof_digest bytea PRIMARY KEY CHECK (octet_length(proof_digest)=32),
    actor_id text NOT NULL REFERENCES __SCHEMA__.actors(id),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz,
    revoked_at timestamptz,
    CHECK (expires_at > created_at),
    CHECK (consumed_at IS NULL OR consumed_at >= created_at)
);
CREATE INDEX idx_operator_passkey_recovery_actor
    ON __SCHEMA__.operator_passkey_recovery_proofs(actor_id, expires_at);

CREATE TABLE __SCHEMA__.operator_passkey_audit (
    event_id bytea PRIMARY KEY CHECK (octet_length(event_id)=32),
    actor_id text REFERENCES __SCHEMA__.actors(id),
    credential_id_digest bytea CHECK (credential_id_digest IS NULL OR octet_length(credential_id_digest)=32),
    event_kind text NOT NULL CHECK (event_kind IN (
        'ENROLLED','AUTHENTICATED','AUTH_REJECTED','CREDENTIAL_REVOKED',
        'RECOVERY_BEGUN','RECOVERED','RECOVERY_REJECTED'
    )),
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX idx_operator_passkey_audit_actor
    ON __SCHEMA__.operator_passkey_audit(actor_id, recorded_at DESC);
CREATE TRIGGER operator_passkey_audit_immutable
    BEFORE UPDATE OR DELETE ON __SCHEMA__.operator_passkey_audit
    FOR EACH ROW EXECUTE FUNCTION __SCHEMA__.deny_operator_admin_audit_mutation();
