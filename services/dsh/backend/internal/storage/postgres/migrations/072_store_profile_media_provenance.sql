ALTER TABLE dsh.store_profile_media_assets
    ADD COLUMN creator text,
    ADD COLUMN source_description text,
    ADD COLUMN source_uri text,
    ADD COLUMN rights_statement text,
    ADD COLUMN rights_uri text,
    ADD COLUMN rights_attested_by_actor_id text,
    ADD COLUMN rights_attested_at timestamptz;

ALTER TABLE dsh.store_profile_media_assets
    ADD CONSTRAINT store_profile_media_provenance_chk CHECK (
        (creator IS NULL AND source_description IS NULL AND source_uri IS NULL AND rights_statement IS NULL AND rights_uri IS NULL AND rights_attested_by_actor_id IS NULL AND rights_attested_at IS NULL)
        OR
        (creator IS NOT NULL AND source_description IS NOT NULL AND rights_statement IS NOT NULL AND rights_attested_by_actor_id IS NOT NULL AND rights_attested_at IS NOT NULL
            AND char_length(btrim(creator)) BETWEEN 2 AND 200
            AND char_length(btrim(source_description)) BETWEEN 3 AND 1000
            AND (source_uri IS NULL OR (char_length(source_uri) <= 2048 AND source_uri ~* '^https?://[^/?#[:space:]]+[^[:space:]]*$' AND source_uri !~* '^https?://[^/?#]*@'))
            AND char_length(btrim(rights_statement)) BETWEEN 5 AND 2000
            AND (rights_uri IS NULL OR (char_length(rights_uri) <= 2048 AND rights_uri ~* '^https?://[^/?#[:space:]]+[^[:space:]]*$' AND rights_uri !~* '^https?://[^/?#]*@'))
            AND char_length(btrim(rights_attested_by_actor_id)) BETWEEN 1 AND 256
        )
    );

UPDATE dsh.store_profile_media_assets
SET state = 'retired', retired_at = clock_timestamp()
WHERE state = 'active' AND rights_attested_at IS NULL;
