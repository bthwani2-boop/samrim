-- 1. Bounded password reservation lifecycle
ALTER TABLE identity_password_attempts
    ADD COLUMN IF NOT EXISTS reserved_until timestamptz;

-- 2. Challenge delivery outcome taxonomy
ALTER TABLE identity_challenge_deliveries
    DROP CONSTRAINT IF EXISTS identity_challenge_delivery_status_check;

ALTER TABLE identity_challenge_deliveries
    ADD CONSTRAINT identity_challenge_delivery_status_check
    CHECK (status IN ('suppressed','pending','sending','sent','failed','rejected','unknown','expired'));

-- 3. Canonical Operator Enrollment Token forward rename
ALTER TABLE IF EXISTS identity_managed_activation_codes
    RENAME TO identity_operator_enrollment_tokens;

ALTER INDEX IF EXISTS identity_managed_activation_codes_pkey
    RENAME TO identity_operator_enrollment_tokens_pkey;

ALTER INDEX IF EXISTS identity_managed_activation_codes_pending_uq
    RENAME TO identity_operator_enrollment_tokens_pending_uq;

ALTER INDEX IF EXISTS identity_managed_activation_codes_lookup_idx
    RENAME TO identity_operator_enrollment_tokens_lookup_idx;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'identity_managed_activation_code_role_check'
    ) THEN
        ALTER TABLE identity_operator_enrollment_tokens
            DROP CONSTRAINT identity_managed_activation_code_role_check;
        ALTER TABLE identity_operator_enrollment_tokens
            ADD CONSTRAINT identity_operator_enrollment_token_role_check
            CHECK (role = 'operator');
    END IF;
END $$;

-- 4. Durable Irreversible Bootstrap fact
CREATE TABLE IF NOT EXISTS identity_bootstrap_state (
    id integer PRIMARY KEY DEFAULT 1,
    bootstrap_completed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    platform_owner_actor_id text NOT NULL REFERENCES identity_actors(id) ON DELETE RESTRICT,
    CONSTRAINT identity_bootstrap_state_single_row CHECK (id = 1)
);

-- Backfill bootstrap state if platform_owner exists
INSERT INTO identity_bootstrap_state (id, bootstrap_completed_at, platform_owner_actor_id)
SELECT 1, r.created_at, r.actor_id
FROM identity_actor_roles r
WHERE r.role = 'platform_owner'
ORDER BY r.created_at ASC
LIMIT 1
ON CONFLICT (id) DO NOTHING;

-- 5. Record schema version
INSERT INTO identity_schema_migrations(version)
VALUES (14)
ON CONFLICT (version) DO NOTHING;
