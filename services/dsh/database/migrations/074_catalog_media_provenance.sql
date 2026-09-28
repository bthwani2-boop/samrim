ALTER TABLE dsh.catalog_media_assets
    ADD COLUMN request_hash text,
    ADD COLUMN creator text,
    ADD COLUMN source_description text,
    ADD COLUMN source_uri text,
    ADD COLUMN rights_statement text,
    ADD COLUMN rights_uri text,
    ADD COLUMN rights_attested_by_actor_id text,
    ADD COLUMN rights_attested_at timestamptz;

ALTER TABLE dsh.catalog_category_media_assets
    ADD COLUMN request_hash text,
    ADD COLUMN creator text,
    ADD COLUMN source_description text,
    ADD COLUMN source_uri text,
    ADD COLUMN rights_statement text,
    ADD COLUMN rights_uri text,
    ADD COLUMN rights_attested_by_actor_id text,
    ADD COLUMN rights_attested_at timestamptz;

UPDATE dsh.catalog_media_assets
SET request_hash = repeat('0', 64),
    state = CASE WHEN state IN ('active', 'pending') THEN 'retired' ELSE state END,
    retired_at = CASE WHEN state IN ('active', 'pending') THEN COALESCE(retired_at, clock_timestamp()) ELSE retired_at END,
    last_cleanup_error = NULL
WHERE request_hash IS NULL;

DELETE FROM dsh.catalog_media;

UPDATE dsh.catalog_category_media_assets
SET request_hash = repeat('0', 64),
    state = CASE WHEN state IN ('active', 'pending') THEN 'retired' ELSE state END,
    retired_at = CASE WHEN state IN ('active', 'pending') THEN COALESCE(retired_at, clock_timestamp()) ELSE retired_at END,
    last_cleanup_error = NULL
WHERE request_hash IS NULL;

ALTER TABLE dsh.catalog_categories
    DROP COLUMN image_uri;

ALTER TABLE dsh.catalog_media_assets
    ALTER COLUMN request_hash SET NOT NULL,
    ADD CONSTRAINT catalog_media_assets_request_hash_chk CHECK (request_hash ~ '^[0-9a-f]{64}$'),
    ADD CONSTRAINT catalog_media_assets_provenance_chk CHECK (
        state NOT IN ('pending', 'active') OR (
            creator IS NOT NULL AND source_description IS NOT NULL AND rights_statement IS NOT NULL
            AND rights_attested_by_actor_id IS NOT NULL AND rights_attested_at IS NOT NULL
            AND char_length(btrim(creator)) BETWEEN 2 AND 200
            AND char_length(btrim(source_description)) BETWEEN 3 AND 1000
            AND (source_uri IS NULL OR (char_length(source_uri) <= 2048 AND source_uri ~* '^https?://[^/?#[:space:]]+[^[:space:]]*$' AND source_uri !~* '^https?://[^/?#]*@'))
            AND char_length(btrim(rights_statement)) BETWEEN 5 AND 2000
            AND (rights_uri IS NULL OR (char_length(rights_uri) <= 2048 AND rights_uri ~* '^https?://[^/?#[:space:]]+[^[:space:]]*$' AND rights_uri !~* '^https?://[^/?#]*@'))
            AND char_length(btrim(rights_attested_by_actor_id)) BETWEEN 1 AND 256
        )
    );

ALTER TABLE dsh.catalog_category_media_assets
    ALTER COLUMN request_hash SET NOT NULL,
    ADD CONSTRAINT catalog_category_media_assets_request_hash_chk CHECK (request_hash ~ '^[0-9a-f]{64}$'),
    ADD CONSTRAINT catalog_category_media_assets_provenance_chk CHECK (
        state NOT IN ('pending', 'active') OR (
            creator IS NOT NULL AND source_description IS NOT NULL AND rights_statement IS NOT NULL
            AND rights_attested_by_actor_id IS NOT NULL AND rights_attested_at IS NOT NULL
            AND char_length(btrim(creator)) BETWEEN 2 AND 200
            AND char_length(btrim(source_description)) BETWEEN 3 AND 1000
            AND (source_uri IS NULL OR (char_length(source_uri) <= 2048 AND source_uri ~* '^https?://[^/?#[:space:]]+[^[:space:]]*$' AND source_uri !~* '^https?://[^/?#]*@'))
            AND char_length(btrim(rights_statement)) BETWEEN 5 AND 2000
            AND (rights_uri IS NULL OR (char_length(rights_uri) <= 2048 AND rights_uri ~* '^https?://[^/?#[:space:]]+[^[:space:]]*$' AND rights_uri !~* '^https?://[^/?#]*@'))
            AND char_length(btrim(rights_attested_by_actor_id)) BETWEEN 1 AND 256
        )
    );
