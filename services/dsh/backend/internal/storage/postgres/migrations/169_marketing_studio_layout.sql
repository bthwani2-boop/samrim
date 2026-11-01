-- Public client-home layout is independently versioned from the published theme.
-- Version 1 represents the compiled storefront layout; no operator draft is public by default.
ALTER TABLE dsh.marketing_studio_drafts
  ADD COLUMN published_layout_json jsonb,
  ADD COLUMN layout_publication_version integer NOT NULL DEFAULT 1
    CONSTRAINT marketing_studio_layout_version_chk CHECK (layout_publication_version >= 1),
  ADD COLUMN layout_published_at timestamptz,
  ADD COLUMN layout_published_by_actor_id text NOT NULL DEFAULT 'system',
  ADD CONSTRAINT marketing_studio_layout_json_chk CHECK (
    published_layout_json IS NULL OR jsonb_typeof(published_layout_json) = 'object'
  );

CREATE TABLE dsh.marketing_studio_layout_events (
  idempotency_key text PRIMARY KEY,
  request_hash text NOT NULL CONSTRAINT marketing_studio_layout_hash_chk CHECK (length(request_hash) = 64),
  template_key text NOT NULL REFERENCES dsh.marketing_studio_drafts(template_key),
  action text NOT NULL CONSTRAINT marketing_studio_layout_action_chk
    CHECK (action IN ('ACTIVATE_DRAFT', 'RESTORE_DEFAULTS', 'ROLLBACK')),
  expected_version integer NOT NULL CONSTRAINT marketing_studio_layout_expected_chk CHECK (expected_version >= 1),
  result_version integer NOT NULL CONSTRAINT marketing_studio_layout_result_chk CHECK (result_version = expected_version + 1),
  CONSTRAINT marketing_studio_layout_unique_version UNIQUE (template_key, result_version),
  source_draft_version integer,
  target_publication_version integer,
  previous_document_json jsonb,
  result_document_json jsonb,
  acting_actor_id text NOT NULL,
  correlation_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT marketing_studio_layout_document_chk
    CHECK (result_document_json IS NULL OR jsonb_typeof(result_document_json) = 'object')
);
CREATE INDEX marketing_studio_layout_recent_idx ON dsh.marketing_studio_layout_events(created_at DESC);
