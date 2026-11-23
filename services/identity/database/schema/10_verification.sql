-- Fresh isolated Identity schema: synthetic phone challenges.
-- Replace __SCHEMA__ only after validating a NEW identity_test_* namespace.
-- Never apply this baseline to retained credentials, sessions or root owners.
CREATE TABLE __SCHEMA__.customer_phone_challenges (
  phone text PRIMARY KEY CONSTRAINT customer_phone_challenges_format_check CHECK (phone ~ '^[+](9677[01237][0-9]{7}|120255501[0-9]{2})$'),
  ticket text NOT NULL UNIQUE,
  code_digest bytea NOT NULL CHECK (octet_length(code_digest) = 32),
  window_started_at timestamptz NOT NULL,
  sends integer NOT NULL CHECK (sends BETWEEN 1 AND 3),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL CHECK (expires_at > issued_at),
  consumed boolean NOT NULL DEFAULT false
);
