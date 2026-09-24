CREATE TABLE wlt.partner_financial_terms_policies (
    id text PRIMARY KEY,
    policy_version text NOT NULL UNIQUE,
    state text NOT NULL DEFAULT 'ACTIVE',
    commission_rate_bps integer NOT NULL,
    settlement_period text NOT NULL,
    version integer NOT NULL,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    retired_at timestamptz,
    CONSTRAINT partner_financial_terms_policy_state_chk CHECK (state IN ('ACTIVE', 'RETIRED')),
    CONSTRAINT partner_financial_terms_policy_commission_chk CHECK (commission_rate_bps BETWEEN 0 AND 10000),
    CONSTRAINT partner_financial_terms_policy_settlement_chk CHECK (settlement_period IN ('DAILY', 'WEEKLY', 'MONTHLY')),
    CONSTRAINT partner_financial_terms_policy_version_chk CHECK (version > 0),
    CONSTRAINT partner_financial_terms_policy_retired_chk CHECK ((state = 'ACTIVE' AND retired_at IS NULL) OR (state = 'RETIRED' AND retired_at IS NOT NULL))
);

CREATE UNIQUE INDEX partner_financial_terms_policy_active_uq
    ON wlt.partner_financial_terms_policies(state) WHERE state = 'ACTIVE';

CREATE TABLE wlt.partner_financial_terms_policy_events (
    id bigserial PRIMARY KEY,
    policy_id text NOT NULL REFERENCES wlt.partner_financial_terms_policies(id) ON DELETE RESTRICT,
    event_type text NOT NULL,
    policy_version text NOT NULL,
    request_hash text NOT NULL,
    idempotency_key text NOT NULL UNIQUE,
    correlation_id text NOT NULL,
    acting_actor_id text NOT NULL,
    expected_version integer NOT NULL,
    change_reason text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT partner_financial_terms_policy_event_type_chk CHECK (event_type = 'PARTNER_FINANCIAL_TERMS_POLICY_ACTIVATED'),
    CONSTRAINT partner_financial_terms_policy_event_expected_version_chk CHECK (expected_version >= 0),
    CONSTRAINT partner_financial_terms_policy_event_reason_chk CHECK (length(btrim(change_reason)) BETWEEN 5 AND 500)
);

CREATE INDEX partner_financial_terms_policy_events_created_idx
    ON wlt.partner_financial_terms_policy_events(created_at DESC, id DESC);

ALTER TABLE wlt.partner_financial_profiles
    ADD COLUMN terms_policy_version text;

ALTER TABLE wlt.partner_financial_profile_events
    ADD COLUMN terms_policy_version text;
