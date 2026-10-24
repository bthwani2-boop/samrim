-- DSH owns the single marketing campaign grouping for existing Promotions and Discovery Content.
-- This migration does not activate campaigns or move any existing financial postings.
CREATE TABLE dsh.marketing_campaigns (
    id text PRIMARY KEY CHECK (btrim(id) <> '' AND length(id) <= 128),
    name_ar text NOT NULL CHECK (btrim(name_ar) <> '' AND length(name_ar) <= 160),
    objective text NOT NULL CHECK (objective IN ('ACQUISITION','REACTIVATION','CONVERSION','RETENTION')),
    state text NOT NULL DEFAULT 'DRAFT' CHECK (state IN ('DRAFT','PUBLISHED','PAUSED','ENDED')),
    budget_limit_minor bigint NOT NULL CHECK (budget_limit_minor > 0),
    version integer NOT NULL DEFAULT 1 CHECK (version > 0),
    created_by_actor_id text NOT NULL CHECK (btrim(created_by_actor_id) <> ''),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX marketing_campaigns_state_idx ON dsh.marketing_campaigns(state,created_at DESC);
CREATE TABLE dsh.marketing_campaign_promotion_links (
    campaign_id text NOT NULL REFERENCES dsh.marketing_campaigns(id) ON DELETE RESTRICT,
    promotion_id text NOT NULL UNIQUE REFERENCES dsh.commerce_promotions(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (campaign_id,promotion_id)
);
CREATE TABLE dsh.marketing_campaign_content_links (
    campaign_id text NOT NULL REFERENCES dsh.marketing_campaigns(id) ON DELETE RESTRICT,
    content_id text NOT NULL UNIQUE REFERENCES dsh.discovery_content(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (campaign_id,content_id)
);
