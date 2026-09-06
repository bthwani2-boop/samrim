ALTER TABLE identity_sessions ADD COLUMN IF NOT EXISTS absolute_expires_at TIMESTAMPTZ;
UPDATE identity_sessions
SET absolute_expires_at = GREATEST(refresh_expires_at + INTERVAL '1 second', created_at + INTERVAL '30 days')
WHERE absolute_expires_at IS NULL;
ALTER TABLE identity_sessions ALTER COLUMN absolute_expires_at SET NOT NULL;
ALTER TABLE identity_sessions DROP CONSTRAINT IF EXISTS identity_sessions_absolute_after_refresh_check;
ALTER TABLE identity_sessions ADD CONSTRAINT identity_sessions_absolute_after_refresh_check CHECK (absolute_expires_at > refresh_expires_at);
CREATE INDEX IF NOT EXISTS identity_sessions_absolute_idx ON identity_sessions (absolute_expires_at);
CREATE INDEX IF NOT EXISTS identity_challenges_phone_purpose_idx ON identity_challenges (phone_e164, role, purpose, created_at DESC);
INSERT INTO identity_schema_migrations(version) VALUES (8) ON CONFLICT (version) DO NOTHING;
