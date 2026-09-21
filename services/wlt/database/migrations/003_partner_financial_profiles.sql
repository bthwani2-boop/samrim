CREATE TABLE wlt.partner_financial_profiles (
    id text PRIMARY KEY,
    joining_case_id text NOT NULL,
    partner_actor_id text NOT NULL,
    origin text NOT NULL,
    commission_rate_bps integer NOT NULL,
    settlement_period text NOT NULL,
    rounding_unit_minor bigint NOT NULL DEFAULT 50,
    state text NOT NULL DEFAULT 'PENDING_BINDING',
    version integer NOT NULL DEFAULT 1,
    idempotency_key text NOT NULL,
    request_hash text NOT NULL,
    activated_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT partner_financial_profiles_joining_uq UNIQUE (joining_case_id),
    CONSTRAINT partner_financial_profiles_partner_uq UNIQUE (partner_actor_id),
    CONSTRAINT partner_financial_profiles_idempotency_uq UNIQUE (idempotency_key),
    CONSTRAINT partner_financial_profiles_origin_chk CHECK (origin IN ('field', 'control_panel')),
    CONSTRAINT partner_financial_profiles_commission_chk CHECK (commission_rate_bps BETWEEN 0 AND 10000),
    CONSTRAINT partner_financial_profiles_settlement_chk CHECK (settlement_period IN ('DAILY', 'WEEKLY', 'MONTHLY')),
    CONSTRAINT partner_financial_profiles_rounding_chk CHECK (rounding_unit_minor = 50),
    CONSTRAINT partner_financial_profiles_state_chk CHECK (state IN ('PENDING_BINDING', 'ACTIVE')),
    CONSTRAINT partner_financial_profiles_version_chk CHECK (version > 0),
    CONSTRAINT partner_financial_profiles_activation_chk CHECK (
        (state = 'ACTIVE' AND activated_at IS NOT NULL)
        OR (state = 'PENDING_BINDING' AND activated_at IS NULL)
    )
);

CREATE INDEX partner_financial_profiles_state_idx
    ON wlt.partner_financial_profiles(state, updated_at ASC, id ASC);

CREATE TABLE wlt.partner_financial_profile_events (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    profile_id text NOT NULL,
    event_type text NOT NULL,
    idempotency_key text NOT NULL,
    request_hash text NOT NULL,
    correlation_id text NOT NULL,
    actor_id text,
    from_state text,
    to_state text NOT NULL,
    version integer NOT NULL,
    commission_rate_bps integer NOT NULL,
    settlement_period text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT partner_financial_profile_events_profile_fk FOREIGN KEY (profile_id) REFERENCES wlt.partner_financial_profiles(id) ON DELETE RESTRICT,
    CONSTRAINT partner_financial_profile_events_idempotency_uq UNIQUE (idempotency_key),
    CONSTRAINT partner_financial_profile_events_type_chk CHECK (event_type IN ('PROFILE_PREPARED', 'PROFILE_ACTIVATED')),
    CONSTRAINT partner_financial_profile_events_state_chk CHECK (to_state IN ('PENDING_BINDING', 'ACTIVE')),
    CONSTRAINT partner_financial_profile_events_commission_chk CHECK (commission_rate_bps BETWEEN 0 AND 10000),
    CONSTRAINT partner_financial_profile_events_settlement_chk CHECK (settlement_period IN ('DAILY', 'WEEKLY', 'MONTHLY')),
    CONSTRAINT partner_financial_profile_events_version_chk CHECK (version > 0)
);

CREATE INDEX partner_financial_profile_events_profile_idx
    ON wlt.partner_financial_profile_events(profile_id, created_at, id);
