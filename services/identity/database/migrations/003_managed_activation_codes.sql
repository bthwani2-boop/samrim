CREATE TABLE identity_managed_activation_codes (
    id text PRIMARY KEY,
    actor_id text NOT NULL,
    role varchar(32) NOT NULL,
    phone_e164 varchar(16) NOT NULL,
    code_hash char(64) NOT NULL,
    status varchar(16) NOT NULL DEFAULT 'pending',
    attempts integer NOT NULL DEFAULT 0,
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz,
    created_by varchar(64) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (actor_id, role) REFERENCES identity_actor_roles(actor_id, role) ON DELETE CASCADE,
    CONSTRAINT identity_managed_activation_code_role_check CHECK (role IN ('partner','captain','field')),
    CONSTRAINT identity_managed_activation_code_status_check CHECK (status IN ('pending','consumed','revoked','expired','locked')),
    CONSTRAINT identity_managed_activation_code_attempts_check CHECK (attempts BETWEEN 0 AND 5),
    CONSTRAINT identity_managed_activation_code_consumed_check CHECK (
        (status='consumed' AND consumed_at IS NOT NULL) OR
        (status<>'consumed' AND consumed_at IS NULL)
    )
);

CREATE UNIQUE INDEX identity_managed_activation_codes_pending_uq
    ON identity_managed_activation_codes(actor_id, role)
    WHERE status='pending';
CREATE UNIQUE INDEX identity_managed_activation_codes_hash_uq
    ON identity_managed_activation_codes(code_hash);
CREATE INDEX identity_managed_activation_codes_lookup_idx
    ON identity_managed_activation_codes(phone_e164, role, status, created_at DESC);

INSERT INTO identity_schema_migrations(version)
VALUES (3);
