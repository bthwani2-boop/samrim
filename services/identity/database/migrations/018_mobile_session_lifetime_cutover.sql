-- Forward-only mobile session continuity cutover.
-- Mobile sessions retain their current access-token expiry but receive the
-- canonical long-lived absolute and rotating refresh lifetime. Operator
-- sessions remain passkey-controlled and unchanged.

UPDATE identity_sessions
SET absolute_expires_at = created_at + interval '365 days',
    refresh_expires_at = LEAST(clock_timestamp() + interval '30 days', created_at + interval '365 days' - interval '1 second'),
    version = version + 1
WHERE role IN ('client', 'partner', 'captain', 'field')
  AND revoked_at IS NULL
  AND refresh_expires_at > clock_timestamp()
  AND absolute_expires_at > clock_timestamp();
