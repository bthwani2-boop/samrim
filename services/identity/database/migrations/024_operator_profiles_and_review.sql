CREATE TABLE identity_operator_profiles (
    id text PRIMARY KEY,
    full_name_ar text NOT NULL,
    phone_e164 text,
    actor_id text UNIQUE REFERENCES identity_actors(id) ON DELETE RESTRICT,
    state text NOT NULL,
    version integer NOT NULL DEFAULT 1,
    created_by_actor_id text NOT NULL REFERENCES identity_actors(id) ON DELETE RESTRICT,
    reviewed_by_actor_id text REFERENCES identity_actors(id) ON DELETE RESTRICT,
    reviewed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT identity_operator_profiles_name_chk CHECK (length(btrim(full_name_ar)) BETWEEN 2 AND 120),
    CONSTRAINT identity_operator_profiles_phone_chk CHECK (phone_e164 IS NULL OR phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
    CONSTRAINT identity_operator_profiles_state_chk CHECK (state IN ('pending_review', 'approved', 'admitted')),
    CONSTRAINT identity_operator_profiles_version_chk CHECK (version > 0),
    CONSTRAINT identity_operator_profiles_review_chk CHECK (
        (state = 'pending_review' AND reviewed_by_actor_id IS NULL AND reviewed_at IS NULL)
        OR (state IN ('approved', 'admitted') AND reviewed_by_actor_id IS NOT NULL AND reviewed_at IS NOT NULL)
    ),
    CONSTRAINT identity_operator_profiles_actor_state_chk CHECK (
        (state IN ('pending_review', 'approved') AND phone_e164 IS NOT NULL AND actor_id IS NULL)
        OR (state = 'admitted' AND phone_e164 IS NULL AND actor_id IS NOT NULL)
    )
);

CREATE UNIQUE INDEX identity_operator_profiles_pending_phone_uq
    ON identity_operator_profiles(phone_e164) WHERE phone_e164 IS NOT NULL;
CREATE INDEX identity_operator_profiles_registry_idx
    ON identity_operator_profiles(created_at DESC, id DESC);

CREATE TABLE identity_operator_profile_events (
    id text PRIMARY KEY,
    profile_id text NOT NULL REFERENCES identity_operator_profiles(id) ON DELETE RESTRICT,
    event_type text NOT NULL,
    acting_actor_id text NOT NULL REFERENCES identity_actors(id) ON DELETE RESTRICT,
    idempotency_key text NOT NULL UNIQUE,
    request_hash text NOT NULL,
    correlation_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT identity_operator_profile_events_type_chk CHECK (event_type IN ('created', 'profile_updated', 'approved', 'role_admitted')),
    CONSTRAINT identity_operator_profile_events_hash_chk CHECK (length(btrim(request_hash)) > 0),
    CONSTRAINT identity_operator_profile_events_correlation_chk CHECK (length(btrim(correlation_id)) BETWEEN 8 AND 128)
);
CREATE INDEX identity_operator_profile_events_profile_idx
    ON identity_operator_profile_events(profile_id, created_at DESC);
