CREATE TABLE wlt.partner_commission_rate_history (
    source_relation text NOT NULL,
    source_id text NOT NULL,
    related_id text,
    policy_version text,
    record_state text,
    commission_rate_bps integer NOT NULL,
    recorded_at timestamptz NOT NULL,
    archived_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT partner_commission_rate_history_pkey PRIMARY KEY (source_relation, source_id),
    CONSTRAINT partner_commission_rate_history_source_chk CHECK (source_relation IN ('partner_financial_profiles','partner_financial_profile_events','partner_financial_terms_policies')),
    CONSTRAINT partner_commission_rate_history_rate_chk CHECK (commission_rate_bps BETWEEN 0 AND 10000),
    CONSTRAINT partner_commission_rate_history_id_chk CHECK (length(btrim(source_id)) BETWEEN 1 AND 128)
);

INSERT INTO wlt.partner_commission_rate_history(source_relation,source_id,related_id,record_state,commission_rate_bps,recorded_at)
SELECT 'partner_financial_profiles',id,partner_actor_id,state,commission_rate_bps,created_at
FROM wlt.partner_financial_profiles;

INSERT INTO wlt.partner_commission_rate_history(source_relation,source_id,related_id,record_state,commission_rate_bps,recorded_at)
SELECT 'partner_financial_profile_events',id::text,profile_id,to_state,commission_rate_bps,created_at
FROM wlt.partner_financial_profile_events;

INSERT INTO wlt.partner_commission_rate_history(source_relation,source_id,policy_version,record_state,commission_rate_bps,recorded_at)
SELECT 'partner_financial_terms_policies',id,policy_version||':'||version::text,state,commission_rate_bps,created_at
FROM wlt.partner_financial_terms_policies;

ALTER TABLE wlt.partner_financial_profiles
    DROP COLUMN commission_rate_bps;

ALTER TABLE wlt.partner_financial_profile_events
    DROP COLUMN commission_rate_bps;

ALTER TABLE wlt.partner_financial_terms_policies
    DROP COLUMN commission_rate_bps;
