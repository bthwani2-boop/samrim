-- Identity owner: synthetic-only proof of a Customer verification event.
-- This isolated migration is NOT an authentication or verification provider.
-- Replace __SCHEMA__ ONLY after strict identity_test_* validation, and never
-- run on a protected or original production Identity schema.
--
-- New actors start unverified. Only an approved Identity verification owner
-- may author verified_at outside isolated synthetic fixtures. Merchant role
-- admission requires this actor fact, a current Customer bearer, and no
-- already-provisioned Merchant role.
ALTER TABLE __SCHEMA__.actors
  ADD COLUMN verified_at timestamptz;
