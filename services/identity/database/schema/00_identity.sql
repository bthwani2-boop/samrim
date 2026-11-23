-- Fresh isolated Identity schema: actors and role standing.
-- Replace __SCHEMA__ only after validating a NEW identity_test_* namespace.
-- Never apply this baseline to retained credentials, sessions or root owners.
CREATE SCHEMA __SCHEMA__;
CREATE TABLE __SCHEMA__.actors (
    id text PRIMARY KEY CHECK (char_length(id) BETWEEN 1 AND 128),
    status text NOT NULL CHECK (status IN ('ACTIVE','SUSPENDED','DISABLED')),
    auth_version bigint NOT NULL DEFAULT 1 CHECK (auth_version > 0),
    updated_at timestamptz NOT NULL DEFAULT now(),
    verified_at timestamptz,
    verified_phone text UNIQUE CONSTRAINT actors_verified_phone_format_check CHECK (
        verified_phone IS NULL OR (
            verified_at IS NOT NULL AND verified_phone ~ '^[+](9677[01237][0-9]{7}|120255501[0-9]{2})$'
        )
    )
);
CREATE TABLE __SCHEMA__.actor_roles (
    actor_id text NOT NULL REFERENCES __SCHEMA__.actors(id),
    role text NOT NULL CHECK (role IN ('customer','merchant','captain','operator')),
    status text NOT NULL CHECK (status IN ('ACTIVE','SUSPENDED','DISABLED')),
    version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (actor_id,role)
);
