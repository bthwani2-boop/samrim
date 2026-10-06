ALTER TABLE dsh.catalog_categories
    ADD COLUMN image_uri text;

CREATE TABLE dsh.catalog_category_media_assets (
    id text PRIMARY KEY,
    category_id text NOT NULL,
    idempotency_key text NOT NULL UNIQUE,
    expected_version integer NOT NULL,
    object_key text NOT NULL UNIQUE,
    uri text NOT NULL UNIQUE,
    content_sha256 text NOT NULL,
    content_type text NOT NULL,
    byte_size bigint NOT NULL,
    state text NOT NULL DEFAULT 'pending',
    cleanup_attempts integer NOT NULL DEFAULT 0,
    last_cleanup_error text,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    retired_at timestamptz,
    cleaned_at timestamptz,
    CONSTRAINT catalog_category_media_assets_category_fk FOREIGN KEY (category_id) REFERENCES dsh.catalog_categories(id) ON DELETE RESTRICT,
    CONSTRAINT catalog_category_media_assets_expected_version_chk CHECK (expected_version > 0),
    CONSTRAINT catalog_category_media_assets_sha_chk CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
    CONSTRAINT catalog_category_media_assets_content_type_chk CHECK (content_type IN ('image/jpeg', 'image/png')),
    CONSTRAINT catalog_category_media_assets_byte_size_chk CHECK (byte_size BETWEEN 1 AND 10485760),
    CONSTRAINT catalog_category_media_assets_state_chk CHECK (state IN ('pending', 'active', 'retired', 'deleted', 'failed')),
    CONSTRAINT catalog_category_media_assets_cleanup_attempts_chk CHECK (cleanup_attempts >= 0),
    CONSTRAINT catalog_category_media_assets_retired_at_chk CHECK (state NOT IN ('retired', 'deleted') OR retired_at IS NOT NULL),
    CONSTRAINT catalog_category_media_assets_cleaned_at_chk CHECK (state <> 'deleted' OR cleaned_at IS NOT NULL)
);

CREATE UNIQUE INDEX catalog_category_media_assets_active_uq
    ON dsh.catalog_category_media_assets(category_id)
    WHERE state = 'active';

CREATE INDEX catalog_category_media_assets_cleanup_idx
    ON dsh.catalog_category_media_assets(state, created_at ASC)
    WHERE state IN ('pending', 'retired', 'failed');
