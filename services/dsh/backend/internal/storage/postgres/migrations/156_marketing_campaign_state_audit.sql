-- Audit every campaign state change and make safe replay a database fact.
ALTER TABLE dsh.marketing_campaigns DROP CONSTRAINT marketing_campaigns_state_check;
ALTER TABLE dsh.marketing_campaigns ADD CONSTRAINT marketing_campaigns_state_check
    CHECK (state IN ('DRAFT','PUBLISHED','PAUSED','ENDED','ARCHIVED'));

CREATE TABLE dsh.marketing_campaign_state_events (
    idempotency_key text PRIMARY KEY CHECK (length(idempotency_key) BETWEEN 8 AND 128),
    request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
    campaign_id text NOT NULL REFERENCES dsh.marketing_campaigns(id) ON DELETE RESTRICT,
    actor_id text NOT NULL CHECK (btrim(actor_id)<>''),
    correlation_id text NOT NULL CHECK (btrim(correlation_id)<>''),
    expected_version integer NOT NULL CHECK (expected_version>0),
    result_version integer NOT NULL CHECK (result_version>0),
    previous_state text NOT NULL,
    resulting_state text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX marketing_campaign_state_events_version_uq
    ON dsh.marketing_campaign_state_events(campaign_id,result_version);
