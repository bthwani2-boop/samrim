ALTER TABLE dsh.marketing_studio_drafts
    ADD COLUMN published_palette_json jsonb,
    ADD COLUMN publication_version integer NOT NULL DEFAULT 1
        CONSTRAINT marketing_studio_publication_version_chk CHECK (publication_version >= 1),
    ADD COLUMN published_at timestamptz,
    ADD COLUMN published_by_actor_id text NOT NULL DEFAULT 'system',
    ADD CONSTRAINT marketing_studio_published_palette_chk CHECK (
        published_palette_json IS NULL OR jsonb_typeof(published_palette_json) = 'object'
    );

CREATE TABLE dsh.marketing_studio_publication_events (
    idempotency_key text PRIMARY KEY,
    request_hash text NOT NULL CONSTRAINT marketing_studio_pub_hash_chk CHECK (length(request_hash) = 64),
    template_key text NOT NULL REFERENCES dsh.marketing_studio_drafts(template_key),
    action text NOT NULL CONSTRAINT marketing_studio_pub_action_chk CHECK (action IN ('ACTIVATE_DRAFT', 'RESTORE_DEFAULTS', 'ROLLBACK')),
    expected_version integer NOT NULL CONSTRAINT marketing_studio_pub_expected_chk CHECK (expected_version >= 1),
    result_version integer NOT NULL CONSTRAINT marketing_studio_pub_result_chk CHECK (result_version = expected_version + 1),
    CONSTRAINT marketing_studio_pub_unique_version UNIQUE(template_key, result_version),
    source_draft_version integer,
    target_publication_version integer,
    previous_palette_json jsonb,
    result_palette_json jsonb,
    acting_actor_id text NOT NULL,
    correlation_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT marketing_studio_pub_palette_chk CHECK (result_palette_json IS NULL OR jsonb_typeof(result_palette_json) = 'object')
);
CREATE INDEX marketing_studio_pub_recent_idx ON dsh.marketing_studio_publication_events(created_at DESC);
