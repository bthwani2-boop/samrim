ALTER TABLE dsh.commerce_verticals
    ADD COLUMN image_uri text;

CREATE TABLE dsh.commerce_vertical_media_assets (
    id text PRIMARY KEY,
    vertical_id text NOT NULL,
    idempotency_key text NOT NULL UNIQUE,
    expected_version integer NOT NULL,
    object_key text NOT NULL UNIQUE,
    uri text NOT NULL UNIQUE,
    content_sha256 text NOT NULL,
    content_type text NOT NULL,
    byte_size bigint NOT NULL,
    reason text NOT NULL,
    state text NOT NULL DEFAULT 'pending',
    cleanup_attempts integer NOT NULL DEFAULT 0,
    last_cleanup_error text,
    request_hash text NOT NULL,
    creator text NOT NULL,
    source_description text NOT NULL,
    source_uri text,
    rights_statement text NOT NULL,
    rights_uri text,
    rights_attested_by_actor_id text NOT NULL,
    rights_attested_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    retired_at timestamptz,
    cleaned_at timestamptz,
    CONSTRAINT commerce_vertical_media_assets_vertical_fk FOREIGN KEY (vertical_id) REFERENCES dsh.commerce_verticals(id) ON DELETE RESTRICT,
    CONSTRAINT commerce_vertical_media_assets_expected_version_chk CHECK (expected_version > 0),
    CONSTRAINT commerce_vertical_media_assets_sha_chk CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
    CONSTRAINT commerce_vertical_media_assets_content_type_chk CHECK (content_type IN ('image/jpeg', 'image/png')),
    CONSTRAINT commerce_vertical_media_assets_byte_size_chk CHECK (byte_size BETWEEN 1 AND 10485760),
    CONSTRAINT commerce_vertical_media_assets_state_chk CHECK (state IN ('pending', 'active', 'retired', 'deleted', 'failed')),
    CONSTRAINT commerce_vertical_media_assets_cleanup_attempts_chk CHECK (cleanup_attempts >= 0),
    CONSTRAINT commerce_vertical_media_assets_retired_at_chk CHECK (state NOT IN ('retired', 'deleted') OR retired_at IS NOT NULL),
    CONSTRAINT commerce_vertical_media_assets_cleaned_at_chk CHECK (state <> 'deleted' OR cleaned_at IS NOT NULL),
    CONSTRAINT commerce_vertical_media_assets_request_hash_chk CHECK (request_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT commerce_vertical_media_assets_provenance_chk CHECK (length(trim(creator)) > 0 AND length(trim(source_description)) > 0 AND length(trim(rights_statement)) > 0 AND length(trim(rights_attested_by_actor_id)) > 0),
    CONSTRAINT commerce_vertical_media_assets_reason_chk CHECK (length(trim(reason)) BETWEEN 5 AND 500)
);

CREATE UNIQUE INDEX commerce_vertical_media_assets_active_uq
    ON dsh.commerce_vertical_media_assets(vertical_id)
    WHERE state = 'active';

CREATE INDEX commerce_vertical_media_assets_cleanup_idx
    ON dsh.commerce_vertical_media_assets(state, created_at ASC)
    WHERE state IN ('pending', 'retired', 'failed');
