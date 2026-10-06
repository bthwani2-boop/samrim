CREATE TABLE dsh.store_profile_media_assets (
    id text PRIMARY KEY,
    joining_case_id text NOT NULL REFERENCES dsh.joining_cases(id) ON DELETE RESTRICT,
    store_id text REFERENCES dsh.stores(id) ON DELETE RESTRICT,
    idempotency_key text NOT NULL UNIQUE,
    request_hash text NOT NULL,
    expected_case_version integer NOT NULL,
    object_key text NOT NULL UNIQUE,
    uri text NOT NULL UNIQUE,
    content_sha256 text NOT NULL,
    content_type text NOT NULL,
    byte_size bigint NOT NULL,
    media_role text NOT NULL DEFAULT 'primary',
    state text NOT NULL DEFAULT 'pending',
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    attached_at timestamptz,
    retired_at timestamptz,
    cleanup_attempts integer NOT NULL DEFAULT 0,
    last_cleanup_error text,
    CONSTRAINT store_profile_media_case_version_chk CHECK (expected_case_version > 0),
    CONSTRAINT store_profile_media_sha_chk CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
    CONSTRAINT store_profile_media_content_type_chk CHECK (content_type IN ('image/jpeg', 'image/png')),
    CONSTRAINT store_profile_media_byte_size_chk CHECK (byte_size > 0 AND byte_size <= 10485760),
    CONSTRAINT store_profile_media_role_chk CHECK (media_role = 'primary'),
    CONSTRAINT store_profile_media_state_chk CHECK (state IN ('pending', 'active', 'retired', 'failed')),
    CONSTRAINT store_profile_media_retired_at_chk CHECK ((state = 'retired' AND retired_at IS NOT NULL) OR (state <> 'retired')),
    CONSTRAINT store_profile_media_attached_at_chk CHECK ((state = 'active' AND attached_at IS NOT NULL) OR (state <> 'active'))
);

CREATE UNIQUE INDEX store_profile_media_case_active_uq
    ON dsh.store_profile_media_assets(joining_case_id)
    WHERE state = 'active';
CREATE UNIQUE INDEX store_profile_media_store_active_uq
    ON dsh.store_profile_media_assets(store_id)
    WHERE state = 'active' AND store_id IS NOT NULL;
CREATE INDEX store_profile_media_case_idx
    ON dsh.store_profile_media_assets(joining_case_id, created_at DESC);
CREATE INDEX store_profile_media_cleanup_idx
    ON dsh.store_profile_media_assets(state, created_at)
    WHERE state IN ('pending', 'failed', 'retired');

CREATE TABLE dsh.store_profile_media_audit (
    id text PRIMARY KEY,
    event_type text NOT NULL,
    idempotency_key text NOT NULL UNIQUE REFERENCES dsh.store_profile_media_assets(idempotency_key),
    correlation_id text NOT NULL,
    acting_actor_id text NOT NULL,
    joining_case_id text NOT NULL REFERENCES dsh.joining_cases(id),
    result_version integer NOT NULL,
    request_hash text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT store_profile_media_audit_event_chk CHECK (event_type IN ('store_profile_image_attached', 'store_profile_image_replaced')),
    CONSTRAINT store_profile_media_audit_version_chk CHECK (result_version > 0)
);
CREATE INDEX store_profile_media_audit_case_idx
    ON dsh.store_profile_media_audit(joining_case_id, created_at DESC);
