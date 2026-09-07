-- The verification-code contract is now six decimal digits. Revoke every
-- challenge that was pending before this migration so an old four-digit hash
-- can never be paired with a newly generated six-digit delivery code.
UPDATE identity_challenges
SET status = 'revoked', updated_at = clock_timestamp()
WHERE status = 'pending';

-- Pending deliveries must not send proofs for revoked challenges. A delivery
-- already in flight has an unknowable provider outcome, so preserve that
-- uncertainty instead of claiming it was suppressed or sent.
UPDATE identity_challenge_deliveries
SET status = CASE WHEN status = 'sending' THEN 'unknown' ELSE 'suppressed' END,
    finished_at = clock_timestamp(),
    updated_at = clock_timestamp()
WHERE status IN ('pending', 'sending');

INSERT INTO identity_schema_migrations(version)
VALUES (15)
ON CONFLICT (version) DO NOTHING;
