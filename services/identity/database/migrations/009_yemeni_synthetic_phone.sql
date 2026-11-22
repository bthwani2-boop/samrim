-- Allow canonical Yemeni mobile numbers while retaining existing fixture data.
-- The Identity phone handler separately restricts new requests to its allowlist.
BEGIN;

ALTER TABLE __SCHEMA__.actors
  ADD CONSTRAINT actors_verified_phone_format_check CHECK (
    verified_phone IS NULL OR (
      verified_at IS NOT NULL
      AND verified_phone ~ '^[+](9677[01237][0-9]{7}|120255501[0-9]{2})$'
    )
  ),
  DROP CONSTRAINT actors_check;

ALTER TABLE __SCHEMA__.customer_phone_challenges
  ADD CONSTRAINT customer_phone_challenges_format_check
    CHECK (phone ~ '^[+](9677[01237][0-9]{7}|120255501[0-9]{2})$'),
  DROP CONSTRAINT customer_phone_challenges_phone_check;

COMMIT;
