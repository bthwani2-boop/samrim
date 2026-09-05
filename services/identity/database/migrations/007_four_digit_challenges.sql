-- Four-digit codes are bound to phone, role, purpose, expiry and attempt state.
-- A global uniqueness constraint on the digest would make the small code space
-- reject valid codes for unrelated users, so uniqueness must remain scoped by
-- the activation record rather than the code value itself.
DROP INDEX IF EXISTS identity_managed_activation_codes_hash_uq;

-- Any in-flight six-digit or long-form code belongs to the previous contract.
-- Force a clean request so no old-format proof remains usable after migration.
UPDATE identity_managed_activation_codes
SET status = 'revoked', updated_at = clock_timestamp()
WHERE status = 'pending';

UPDATE identity_challenges
SET status = 'revoked', updated_at = clock_timestamp()
WHERE status = 'pending';

INSERT INTO identity_schema_migrations(version)
VALUES (7)
ON CONFLICT (version) DO NOTHING;
