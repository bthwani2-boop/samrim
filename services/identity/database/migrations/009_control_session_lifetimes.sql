-- Existing control-plane sessions must honor the shorter absolute lifetime.
-- Refresh expiry is clipped first so the absolute-after-refresh invariant remains valid.
UPDATE identity_sessions
SET refresh_expires_at = LEAST(refresh_expires_at, created_at + INTERVAL '24 hours' - INTERVAL '1 second'),
    absolute_expires_at = LEAST(absolute_expires_at, created_at + INTERVAL '24 hours')
WHERE role IN ('operator', 'platform_owner');

INSERT INTO identity_schema_migrations(version)
VALUES (9)
ON CONFLICT (version) DO NOTHING;
