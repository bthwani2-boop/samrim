ALTER TABLE identity_password_attempts
    ADD COLUMN IF NOT EXISTS reserved boolean NOT NULL DEFAULT false;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'identity_password_attempts'::regclass
          AND conname = 'identity_password_attempt_reserved_check'
    ) THEN
        ALTER TABLE identity_password_attempts
            ADD CONSTRAINT identity_password_attempt_reserved_check
            CHECK (NOT reserved OR succeeded = false);
    END IF;
END $$;
