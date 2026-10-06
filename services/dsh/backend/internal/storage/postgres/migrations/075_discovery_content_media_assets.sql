CREATE TABLE dsh.discovery_content_media_assets (
    id text PRIMARY KEY,
    idempotency_key text NOT NULL UNIQUE,
    request_hash text NOT NULL,
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
    creator text NOT NULL,
    source_description text NOT NULL,
    source_uri text,
    rights_statement text NOT NULL,
    rights_uri text,
    rights_attested_by_actor_id text NOT NULL,
    rights_attested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT discovery_content_media_sha_chk CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
    CONSTRAINT discovery_content_media_request_hash_chk CHECK (request_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT discovery_content_media_type_chk CHECK (content_type IN ('image/jpeg', 'image/png')),
    CONSTRAINT discovery_content_media_size_chk CHECK (byte_size BETWEEN 1 AND 10485760),
    CONSTRAINT discovery_content_media_state_chk CHECK (state IN ('pending', 'active', 'retired', 'deleted', 'failed')),
    CONSTRAINT discovery_content_media_cleanup_attempts_chk CHECK (cleanup_attempts >= 0),
    CONSTRAINT discovery_content_media_retired_at_chk CHECK (state NOT IN ('retired', 'deleted') OR retired_at IS NOT NULL),
    CONSTRAINT discovery_content_media_cleaned_at_chk CHECK (state <> 'deleted' OR cleaned_at IS NOT NULL),
    CONSTRAINT discovery_content_media_provenance_chk CHECK (
        length(btrim(creator)) BETWEEN 2 AND 200
        AND length(btrim(source_description)) BETWEEN 3 AND 1000
        AND (source_uri IS NULL OR length(btrim(source_uri)) <= 2048)
        AND length(btrim(rights_statement)) BETWEEN 5 AND 2000
        AND (rights_uri IS NULL OR length(btrim(rights_uri)) <= 2048)
        AND length(btrim(rights_attested_by_actor_id)) BETWEEN 1 AND 128
    )
);

ALTER TABLE dsh.discovery_content
    ADD COLUMN media_asset_id text;

UPDATE dsh.discovery_content
SET state = 'PAUSED', updated_at = clock_timestamp()
WHERE state = 'PUBLISHED';

ALTER TABLE dsh.discovery_content
    DROP COLUMN media_uri,
    ADD CONSTRAINT discovery_content_media_asset_fk FOREIGN KEY (media_asset_id) REFERENCES dsh.discovery_content_media_assets(id) ON DELETE RESTRICT,
    ADD CONSTRAINT discovery_content_published_media_chk CHECK (state <> 'PUBLISHED' OR media_asset_id IS NOT NULL);

CREATE UNIQUE INDEX discovery_content_media_asset_uq
    ON dsh.discovery_content(media_asset_id)
    WHERE media_asset_id IS NOT NULL;
CREATE INDEX discovery_content_media_cleanup_idx
    ON dsh.discovery_content_media_assets(state, created_at ASC);
