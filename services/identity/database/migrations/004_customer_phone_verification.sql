-- Identity-owned phone verification in isolated synthetic development.
ALTER TABLE __SCHEMA__.actors
  ADD COLUMN verified_phone text UNIQUE
  CHECK (verified_phone IS NULL OR (verified_phone ~ '^\+120255501[0-9]{2}$' AND verified_at IS NOT NULL));

CREATE TABLE __SCHEMA__.customer_phone_challenges (
  phone text PRIMARY KEY CHECK (phone ~ '^\+120255501[0-9]{2}$'),
  ticket text NOT NULL UNIQUE,
  code_digest bytea NOT NULL CHECK (octet_length(code_digest) = 32),
  window_started_at timestamptz NOT NULL,
  sends integer NOT NULL CHECK (sends BETWEEN 1 AND 3),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL CHECK (expires_at > issued_at),
  consumed boolean NOT NULL DEFAULT false
);
