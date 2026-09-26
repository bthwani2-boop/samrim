ALTER TABLE dsh.store_profile_media_assets
    ADD COLUMN cleaned_at timestamptz,
    ADD COLUMN last_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    ADD COLUMN cleanup_claimed_at timestamptz,
    ADD COLUMN last_upload_error text;

ALTER TABLE dsh.store_profile_media_assets
    ADD CONSTRAINT store_profile_media_cleaned_at_chk
    CHECK (cleaned_at IS NULL OR state IN ('failed', 'retired')),
    ADD CONSTRAINT store_profile_media_cleanup_claim_chk
    CHECK (cleanup_claimed_at IS NULL OR cleaned_at IS NULL);

DROP INDEX dsh.store_profile_media_cleanup_idx;

CREATE INDEX store_profile_media_cleanup_idx
    ON dsh.store_profile_media_assets(state, last_attempt_at)
    WHERE cleaned_at IS NULL;
