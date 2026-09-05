CREATE TABLE identity_challenge_deliveries (
    challenge_id text PRIMARY KEY REFERENCES identity_challenges(id) ON DELETE CASCADE,
    provider varchar(32) NOT NULL,
    status varchar(16) NOT NULL,
    attempts integer NOT NULL DEFAULT 0,
    started_at timestamptz,
    finished_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT identity_challenge_delivery_provider_check CHECK (provider <> ''),
    CONSTRAINT identity_challenge_delivery_status_check CHECK (status IN ('suppressed','pending','sending','sent','unknown','expired')),
    CONSTRAINT identity_challenge_delivery_attempts_check CHECK (attempts BETWEEN 0 AND 1)
);

CREATE INDEX identity_challenge_deliveries_pending_idx
    ON identity_challenge_deliveries(status, created_at, challenge_id)
    WHERE status = 'pending';

INSERT INTO identity_schema_migrations(version)
VALUES (2);
