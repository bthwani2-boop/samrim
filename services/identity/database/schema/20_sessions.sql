-- Fresh isolated Identity schema: session and refresh token families.
-- Replace __SCHEMA__ only after validating a NEW identity_test_* namespace.
-- Never apply this baseline to retained credentials, sessions or root owners.
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

CREATE TABLE __SCHEMA__.auth_session_families (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  first_access_digest bytea NOT NULL UNIQUE CHECK (octet_length(first_access_digest) = 32),
  current_access_digest bytea NOT NULL CHECK (octet_length(current_access_digest) = 32),
  actor_id text NOT NULL,
  role text NOT NULL CHECK (role IN ('customer','merchant','captain','operator')),
  actor_version bigint NOT NULL CHECK (actor_version > 0),
  role_version bigint NOT NULL CHECK (role_version > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  idle_expires_at timestamptz NOT NULL,
  absolute_expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  FOREIGN KEY (actor_id,role) REFERENCES __SCHEMA__.actor_roles(actor_id,role),
  CHECK (idle_expires_at > created_at),
  CHECK (absolute_expires_at > created_at)
);
CREATE UNIQUE INDEX auth_session_families_current_access_idx
  ON __SCHEMA__.auth_session_families(current_access_digest) WHERE revoked_at IS NULL;
CREATE TABLE __SCHEMA__.auth_refresh_tokens (
  token_digest bytea PRIMARY KEY CHECK (octet_length(token_digest) = 32),
  family_id uuid NOT NULL REFERENCES __SCHEMA__.auth_session_families(id),
  issued_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  consumed_at timestamptz,
  CHECK (consumed_at IS NULL OR consumed_at >= issued_at)
);
CREATE INDEX auth_refresh_tokens_family_idx ON __SCHEMA__.auth_refresh_tokens(family_id);
-- Any canonical Identity revocation also revokes the matching persistent family.
-- Rotation first moves the family's active digest, then revokes the former access.
CREATE FUNCTION __SCHEMA__.revoke_persistent_family_on_access()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL THEN
    UPDATE __SCHEMA__.auth_session_families SET revoked_at=clock_timestamp()
    WHERE current_access_digest=NEW.token_digest AND revoked_at IS NULL;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER auth_sessions_revoke_persistent_family
AFTER UPDATE OF revoked_at ON __SCHEMA__.auth_sessions
FOR EACH ROW EXECUTE FUNCTION __SCHEMA__.revoke_persistent_family_on_access();
