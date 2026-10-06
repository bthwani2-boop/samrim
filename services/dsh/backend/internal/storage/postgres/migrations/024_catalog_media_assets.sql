CREATE TABLE dsh.catalog_media_assets (
    id text PRIMARY KEY,
    product_id text NOT NULL,
    idempotency_key text NOT NULL UNIQUE,
    expected_version integer NOT NULL,
    object_key text NOT NULL UNIQUE,
    uri text NOT NULL UNIQUE,
    content_sha256 text NOT NULL,
    content_type text NOT NULL,
    byte_size bigint NOT NULL,
    media_role text NOT NULL,
    state text NOT NULL DEFAULT 'pending',
    cleanup_attempts integer NOT NULL DEFAULT 0,
    last_cleanup_error text,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    retired_at timestamptz,
    cleaned_at timestamptz,
    CONSTRAINT catalog_media_assets_product_fk FOREIGN KEY (product_id) REFERENCES dsh.catalog_products(id) ON DELETE RESTRICT,
    CONSTRAINT catalog_media_assets_expected_version_chk CHECK (expected_version > 0),
    CONSTRAINT catalog_media_assets_sha_chk CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
    CONSTRAINT catalog_media_assets_content_type_chk CHECK (content_type IN ('image/jpeg', 'image/png')),
    CONSTRAINT catalog_media_assets_byte_size_chk CHECK (byte_size BETWEEN 1 AND 10485760),
    CONSTRAINT catalog_media_assets_role_chk CHECK (media_role IN ('primary', 'gallery')),
    CONSTRAINT catalog_media_assets_state_chk CHECK (state IN ('pending', 'active', 'retired', 'deleted', 'failed')),
    CONSTRAINT catalog_media_assets_cleanup_attempts_chk CHECK (cleanup_attempts >= 0),
    CONSTRAINT catalog_media_assets_retired_at_chk CHECK (state NOT IN ('retired', 'deleted') OR retired_at IS NOT NULL),
    CONSTRAINT catalog_media_assets_cleaned_at_chk CHECK (state <> 'deleted' OR cleaned_at IS NOT NULL)
);

CREATE INDEX catalog_media_assets_product_idx
    ON dsh.catalog_media_assets(product_id, state, created_at DESC);

CREATE INDEX catalog_media_assets_cleanup_idx
    ON dsh.catalog_media_assets(state, created_at ASC)
    WHERE state IN ('pending', 'retired', 'failed');
