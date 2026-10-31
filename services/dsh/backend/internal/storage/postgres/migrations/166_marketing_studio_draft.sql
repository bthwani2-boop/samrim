CREATE TABLE dsh.marketing_studio_drafts (
    template_key text PRIMARY KEY CONSTRAINT marketing_studio_draft_key_chk CHECK (template_key = 'CLIENT_HOME'),
    document_json jsonb,
    version integer NOT NULL DEFAULT 1 CONSTRAINT marketing_studio_draft_version_chk CHECK (version >= 1),
    updated_by_actor_id text NOT NULL DEFAULT 'system',
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT marketing_studio_draft_json_chk CHECK (document_json IS NULL OR jsonb_typeof(document_json) = 'object')
);
INSERT INTO dsh.marketing_studio_drafts (template_key, document_json, version, updated_by_actor_id)
VALUES ('CLIENT_HOME', NULL, 1, 'system');

CREATE TABLE dsh.marketing_studio_draft_events (
    idempotency_key text PRIMARY KEY,
    request_hash text NOT NULL CONSTRAINT marketing_studio_event_hash_chk CHECK (length(request_hash) = 64),
    template_key text NOT NULL REFERENCES dsh.marketing_studio_drafts(template_key),
    expected_version integer NOT NULL CONSTRAINT marketing_studio_event_expected_chk CHECK (expected_version >= 1),
    result_version integer NOT NULL CONSTRAINT marketing_studio_event_result_chk CHECK (result_version > expected_version),
    previous_document_json jsonb,
    result_document_json jsonb NOT NULL,
    acting_actor_id text NOT NULL,
    correlation_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX marketing_studio_events_recent_idx ON dsh.marketing_studio_draft_events(created_at DESC);
