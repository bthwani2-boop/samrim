ALTER TABLE identity_challenges
  DROP CONSTRAINT IF EXISTS identity_challenge_purpose_check,
  ADD CONSTRAINT identity_challenge_purpose_check CHECK (
    purpose IN ('client_register', 'client_recover', 'managed_activate', 'managed_recover', 'operator_mfa')
  );

INSERT INTO identity_schema_migrations(version)
VALUES (11)
ON CONFLICT (version) DO NOTHING;
