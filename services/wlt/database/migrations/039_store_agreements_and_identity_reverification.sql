-- Store Type rates survive as editable suggestions only. They no longer own
-- the rate used by an order or settlement calculation.
ALTER TABLE wlt.commercial_store_type_commission_policies
    RENAME TO commercial_store_type_commission_defaults;
ALTER TABLE wlt.commercial_store_type_commission_policy_events
    RENAME TO commercial_store_type_commission_default_events;

ALTER TABLE wlt.commercial_store_type_commission_defaults
    RENAME CONSTRAINT commercial_store_type_commission_policies_pkey TO commercial_store_type_commission_defaults_pkey;
ALTER TABLE wlt.commercial_store_type_commission_defaults
    RENAME CONSTRAINT commercial_store_type_commission_type_chk TO commercial_store_type_commission_defaults_type_chk;
ALTER TABLE wlt.commercial_store_type_commission_defaults
    RENAME CONSTRAINT commercial_store_type_commission_mode_chk TO commercial_store_type_commission_defaults_mode_chk;
ALTER TABLE wlt.commercial_store_type_commission_defaults
    RENAME CONSTRAINT commercial_store_type_commission_rate_chk TO commercial_store_type_commission_defaults_rate_chk;
ALTER TABLE wlt.commercial_store_type_commission_defaults
    RENAME CONSTRAINT commercial_store_type_commission_version_chk TO commercial_store_type_commission_defaults_version_chk;
ALTER TABLE wlt.commercial_store_type_commission_defaults
    RENAME CONSTRAINT commercial_store_type_commission_change_chk TO commercial_store_type_commission_defaults_change_chk;
ALTER TABLE wlt.commercial_store_type_commission_default_events
    RENAME CONSTRAINT commercial_store_type_commission_event_policy_fk TO commercial_store_type_commission_default_event_fk;
ALTER TABLE wlt.commercial_store_type_commission_default_events
    RENAME CONSTRAINT commercial_store_type_commission_event_values_chk TO commercial_store_type_commission_default_event_values_chk;
ALTER INDEX wlt.commercial_store_type_commission_events_scope_idx
    RENAME TO commercial_store_type_commission_default_events_scope_idx;

CREATE TABLE wlt.store_commercial_agreements (
    agreement_id text PRIMARY KEY,
    store_id text NOT NULL,
    partner_actor_id text NOT NULL,
    agreement_version integer NOT NULL,
    status text NOT NULL,
    proposed_by_actor_id text NOT NULL,
    proposed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    partner_accepted_by_actor_id text,
    partner_accepted_at timestamptz,
    finance_approved_by_actor_id text,
    finance_approved_at timestamptz,
    effective_at timestamptz,
    superseded_at timestamptz,
    reason text NOT NULL,
    finance_decision_reason text,
    idempotency_key text NOT NULL UNIQUE,
    request_hash text NOT NULL,
    correlation_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT store_commercial_agreements_store_version_uq UNIQUE (store_id, agreement_version),
    CONSTRAINT store_commercial_agreements_store_chk CHECK (length(btrim(store_id)) BETWEEN 1 AND 128),
    CONSTRAINT store_commercial_agreements_partner_chk CHECK (length(btrim(partner_actor_id)) BETWEEN 1 AND 128),
    CONSTRAINT store_commercial_agreements_version_chk CHECK (agreement_version > 0),
    CONSTRAINT store_commercial_agreements_status_chk CHECK (status IN ('PROPOSED','PARTNER_ACCEPTED','ACTIVE','FINANCE_REJECTED','SUPERSEDED')),
    CONSTRAINT store_commercial_agreements_proposer_chk CHECK (length(btrim(proposed_by_actor_id)) BETWEEN 1 AND 128),
    CONSTRAINT store_commercial_agreements_partner_acceptance_chk CHECK (
        (partner_accepted_by_actor_id IS NULL AND partner_accepted_at IS NULL) OR
        (length(btrim(partner_accepted_by_actor_id)) BETWEEN 1 AND 128 AND partner_accepted_at IS NOT NULL)
    ),
    CONSTRAINT store_commercial_agreements_finance_approval_chk CHECK (
        (finance_approved_by_actor_id IS NULL AND finance_approved_at IS NULL) OR
        (length(btrim(finance_approved_by_actor_id)) BETWEEN 1 AND 128 AND finance_approved_at IS NOT NULL)
    ),
    CONSTRAINT store_commercial_agreements_lifecycle_chk CHECK (
        (status = 'PROPOSED' AND partner_accepted_at IS NULL AND finance_approved_at IS NULL AND effective_at IS NULL AND superseded_at IS NULL) OR
        (status = 'PARTNER_ACCEPTED' AND partner_accepted_at IS NOT NULL AND finance_approved_at IS NULL AND effective_at IS NULL AND superseded_at IS NULL) OR
        (status = 'ACTIVE' AND partner_accepted_at IS NOT NULL AND finance_approved_at IS NOT NULL AND effective_at IS NOT NULL AND superseded_at IS NULL) OR
        (status = 'FINANCE_REJECTED' AND partner_accepted_at IS NOT NULL AND finance_approved_at IS NULL AND effective_at IS NULL AND superseded_at IS NULL) OR
        (status = 'SUPERSEDED' AND partner_accepted_at IS NOT NULL AND finance_approved_at IS NOT NULL AND effective_at IS NOT NULL AND superseded_at IS NOT NULL)
    ),
    CONSTRAINT store_commercial_agreements_reason_chk CHECK (length(btrim(reason)) BETWEEN 8 AND 500 AND (finance_decision_reason IS NULL OR length(btrim(finance_decision_reason)) BETWEEN 1 AND 500)),
    CONSTRAINT store_commercial_agreements_idempotency_chk CHECK (length(btrim(idempotency_key)) BETWEEN 8 AND 128),
    CONSTRAINT store_commercial_agreements_hash_chk CHECK (request_hash ~ '^[a-f0-9]{64}$'),
    CONSTRAINT store_commercial_agreements_correlation_chk CHECK (length(btrim(correlation_id)) BETWEEN 8 AND 128)
);

CREATE UNIQUE INDEX store_commercial_agreements_one_active_store_uq
    ON wlt.store_commercial_agreements(store_id) WHERE status = 'ACTIVE';
CREATE UNIQUE INDEX store_commercial_agreements_one_pending_store_uq
    ON wlt.store_commercial_agreements(store_id) WHERE status IN ('PROPOSED','PARTNER_ACCEPTED');
CREATE INDEX store_commercial_agreements_store_history_idx
    ON wlt.store_commercial_agreements(store_id, agreement_version DESC);

CREATE TABLE wlt.store_commercial_agreement_rates (
    agreement_id text NOT NULL REFERENCES wlt.store_commercial_agreements(agreement_id) ON DELETE RESTRICT,
    fulfillment_mode text NOT NULL,
    commission_rate_bps integer NOT NULL,
    CONSTRAINT store_commercial_agreement_rates_pkey PRIMARY KEY (agreement_id, fulfillment_mode),
    CONSTRAINT store_commercial_agreement_rates_mode_chk CHECK (fulfillment_mode IN ('BTHWANI_CAPTAIN','PARTNER_CAPTAIN','CUSTOMER_PICKUP')),
    CONSTRAINT store_commercial_agreement_rates_rate_chk CHECK (commission_rate_bps BETWEEN 0 AND 10000)
);

CREATE TABLE wlt.store_commercial_agreement_events (
    id text PRIMARY KEY,
    agreement_id text NOT NULL REFERENCES wlt.store_commercial_agreements(agreement_id) ON DELETE RESTRICT,
    event_type text NOT NULL,
    from_status text,
    to_status text NOT NULL,
    actor_id text NOT NULL,
    reason text NOT NULL,
    idempotency_key text NOT NULL UNIQUE,
    request_hash text NOT NULL,
    correlation_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT store_commercial_agreement_events_type_chk CHECK (event_type IN ('PROPOSED','PARTNER_ACCEPTED','FINANCE_APPROVED','FINANCE_REJECTED','SUPERSEDED')),
    CONSTRAINT store_commercial_agreement_events_status_chk CHECK (to_status IN ('PROPOSED','PARTNER_ACCEPTED','ACTIVE','FINANCE_REJECTED','SUPERSEDED') AND (from_status IS NULL OR from_status IN ('PROPOSED','PARTNER_ACCEPTED','ACTIVE','FINANCE_REJECTED','SUPERSEDED'))),
    CONSTRAINT store_commercial_agreement_events_actor_chk CHECK (length(btrim(actor_id)) BETWEEN 1 AND 128),
    CONSTRAINT store_commercial_agreement_events_reason_chk CHECK (length(btrim(reason)) BETWEEN 1 AND 500),
    CONSTRAINT store_commercial_agreement_events_idempotency_chk CHECK (length(btrim(idempotency_key)) BETWEEN 8 AND 128),
    CONSTRAINT store_commercial_agreement_events_hash_chk CHECK (request_hash ~ '^[a-f0-9]{64}$'),
    CONSTRAINT store_commercial_agreement_events_correlation_chk CHECK (length(btrim(correlation_id)) BETWEEN 8 AND 128)
);
CREATE INDEX store_commercial_agreement_events_history_idx
    ON wlt.store_commercial_agreement_events(agreement_id, created_at, id);

CREATE FUNCTION wlt.reject_store_commercial_agreement_event_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'store commercial agreement events are immutable';
END;
$$;
CREATE TRIGGER store_commercial_agreement_events_immutable
    BEFORE UPDATE OR DELETE ON wlt.store_commercial_agreement_events
    FOR EACH ROW EXECUTE FUNCTION wlt.reject_store_commercial_agreement_event_mutation();

CREATE FUNCTION wlt.reject_store_commercial_agreement_rate_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'store commercial agreement rates are immutable';
END;
$$;
CREATE TRIGGER store_commercial_agreement_rates_immutable
    BEFORE UPDATE OR DELETE ON wlt.store_commercial_agreement_rates
    FOR EACH ROW EXECUTE FUNCTION wlt.reject_store_commercial_agreement_rate_mutation();

CREATE FUNCTION wlt.guard_store_commercial_agreement_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.store_id <> NEW.store_id OR OLD.partner_actor_id <> NEW.partner_actor_id OR
       OLD.agreement_version <> NEW.agreement_version OR OLD.proposed_by_actor_id <> NEW.proposed_by_actor_id OR
       OLD.proposed_at <> NEW.proposed_at OR OLD.reason <> NEW.reason OR
       OLD.idempotency_key <> NEW.idempotency_key OR OLD.request_hash <> NEW.request_hash OR
       OLD.correlation_id <> NEW.correlation_id THEN
        RAISE EXCEPTION 'store commercial agreement proposal facts are immutable';
    END IF;
    IF OLD.status = 'ACTIVE' AND NEW.status = 'SUPERSEDED' AND
       OLD.partner_accepted_by_actor_id = NEW.partner_accepted_by_actor_id AND
       OLD.partner_accepted_at = NEW.partner_accepted_at AND
       OLD.finance_approved_by_actor_id = NEW.finance_approved_by_actor_id AND
       OLD.finance_approved_at = NEW.finance_approved_at AND OLD.effective_at = NEW.effective_at AND
       NEW.superseded_at IS NOT NULL THEN
        RETURN NEW;
    END IF;
    IF OLD.status = 'PROPOSED' AND NEW.status = 'PARTNER_ACCEPTED' AND
       NEW.partner_accepted_by_actor_id IS NOT NULL AND NEW.partner_accepted_at IS NOT NULL AND
       NEW.finance_approved_at IS NULL AND NEW.effective_at IS NULL AND NEW.superseded_at IS NULL THEN
        RETURN NEW;
    END IF;
    IF OLD.status = 'PARTNER_ACCEPTED' AND NEW.status IN ('ACTIVE','FINANCE_REJECTED') AND
       OLD.partner_accepted_by_actor_id = NEW.partner_accepted_by_actor_id AND
       OLD.partner_accepted_at = NEW.partner_accepted_at AND NEW.superseded_at IS NULL AND
       ((NEW.status = 'ACTIVE' AND NEW.finance_approved_by_actor_id IS NOT NULL AND NEW.finance_approved_at IS NOT NULL AND NEW.effective_at IS NOT NULL) OR
        (NEW.status = 'FINANCE_REJECTED' AND NEW.finance_approved_by_actor_id IS NULL AND NEW.finance_approved_at IS NULL AND NEW.effective_at IS NULL)) THEN
        RETURN NEW;
    END IF;
    RAISE EXCEPTION 'invalid store commercial agreement lifecycle transition';
END;
$$;
CREATE TRIGGER store_commercial_agreements_lifecycle_guard
    BEFORE UPDATE ON wlt.store_commercial_agreements
    FOR EACH ROW EXECUTE FUNCTION wlt.guard_store_commercial_agreement_mutation();

ALTER TABLE wlt.customer_payment_allocations
    ADD COLUMN commission_snapshot_source text NOT NULL DEFAULT 'LEGACY_PRE_AGREEMENT',
    ADD COLUMN commission_agreement_id_snapshot text REFERENCES wlt.store_commercial_agreements(agreement_id) ON DELETE RESTRICT,
    ADD COLUMN commission_agreement_version_snapshot integer,
    ADD COLUMN commission_calculation_basis_snapshot text,
    DROP CONSTRAINT customer_payment_allocations_commission_snapshot_chk,
    ADD CONSTRAINT customer_payment_allocations_commission_snapshot_chk CHECK (
        (store_id IS NULL AND partner_actor_id_snapshot IS NULL AND fulfillment_mode IS NULL AND commission_rate_bps_snapshot IS NULL AND commission_policy_version_snapshot IS NULL AND commission_profile_id_snapshot IS NULL AND commission_profile_version_snapshot IS NULL AND commission_rounding_unit_minor_snapshot IS NULL AND commission_settlement_period_snapshot IS NULL AND commercial_store_type_id IS NULL) OR
        (store_id IS NOT NULL AND partner_actor_id_snapshot IS NOT NULL AND fulfillment_mode IS NOT NULL AND commission_rate_bps_snapshot IS NOT NULL AND commission_policy_version_snapshot IS NOT NULL AND commission_profile_id_snapshot IS NOT NULL AND commission_profile_version_snapshot IS NOT NULL AND commission_rounding_unit_minor_snapshot IS NOT NULL AND commission_settlement_period_snapshot IS NOT NULL AND length(btrim(store_id)) BETWEEN 1 AND 128 AND length(btrim(partner_actor_id_snapshot)) BETWEEN 1 AND 128 AND fulfillment_mode IN ('BTHWANI_CAPTAIN','PARTNER_CAPTAIN','CUSTOMER_PICKUP') AND commission_rate_bps_snapshot BETWEEN 0 AND 10000 AND ((commission_snapshot_source='LEGACY_PRE_AGREEMENT' AND commission_policy_version_snapshot > 0) OR (commission_snapshot_source='STORE_AGREEMENT' AND commission_policy_version_snapshot = 0)) AND length(btrim(commission_profile_id_snapshot)) BETWEEN 1 AND 128 AND commission_profile_version_snapshot > 0 AND commission_rounding_unit_minor_snapshot=50 AND commission_settlement_period_snapshot IN ('DAILY','WEEKLY','MONTHLY') AND (commercial_store_type_id IS NULL OR length(btrim(commercial_store_type_id)) BETWEEN 1 AND 128))
    ),
    ADD CONSTRAINT customer_payment_allocations_agreement_snapshot_chk CHECK (
        commission_snapshot_source IN ('LEGACY_PRE_AGREEMENT','STORE_AGREEMENT') AND
        ((commission_snapshot_source = 'LEGACY_PRE_AGREEMENT' AND commission_agreement_id_snapshot IS NULL AND commission_agreement_version_snapshot IS NULL AND commission_calculation_basis_snapshot IS NULL) OR
         (commission_snapshot_source = 'STORE_AGREEMENT' AND store_id IS NOT NULL AND partner_actor_id_snapshot IS NOT NULL AND fulfillment_mode IS NOT NULL AND
          commission_rate_bps_snapshot IS NOT NULL AND commission_policy_version_snapshot IS NOT NULL AND commission_profile_id_snapshot IS NOT NULL AND
          commission_profile_version_snapshot IS NOT NULL AND commission_rounding_unit_minor_snapshot IS NOT NULL AND commission_settlement_period_snapshot IS NOT NULL AND
          commission_agreement_id_snapshot IS NOT NULL AND commission_agreement_version_snapshot > 0 AND
          commission_calculation_basis_snapshot = 'SUBTOTAL_MINUS_DISCOUNT'))
    );

ALTER TABLE wlt.customer_payment_allocations
    DROP CONSTRAINT payment_allocations_policy_chk,
    ADD CONSTRAINT payment_allocations_policy_chk CHECK (length(btrim(policy_version)) BETWEEN 1 AND 512);

ALTER TABLE wlt.official_wallet_destinations
    ADD COLUMN identity_actor_version integer,
    ADD COLUMN identity_role_version integer,
    ADD COLUMN role_enabled boolean,
    ADD COLUMN security_enabled boolean,
    ADD COLUMN official_name_status text;
UPDATE wlt.official_wallet_destinations
    SET status='SUSPENDED', verification_status='STALE'
    WHERE status <> 'SUSPENDED' OR verification_status <> 'STALE';
ALTER TABLE wlt.official_wallet_destinations
    DROP CONSTRAINT official_wallet_destinations_verification_chk,
    ADD CONSTRAINT official_wallet_destinations_verification_chk CHECK (verification_status IN ('PENDING_VERIFICATION','VERIFIED','REJECTED','STALE')),
    ADD CONSTRAINT official_wallet_destinations_identity_facts_chk CHECK (
        (verification_status='STALE' AND status='SUSPENDED') OR
        (verification_status<>'STALE' AND identity_actor_version>0 AND identity_role_version>0 AND role_enabled IS TRUE AND
         security_enabled IS TRUE AND official_name_status='VERIFIED' AND beneficiary_identity_version>0)
    );

ALTER TABLE wlt.approved_payout_snapshots
    ADD COLUMN identity_actor_version_snapshot integer,
    ADD COLUMN identity_role_version_snapshot integer,
    ADD COLUMN role_enabled_snapshot boolean,
    ADD COLUMN security_enabled_snapshot boolean,
    ADD COLUMN official_name_status_snapshot text,
    ADD CONSTRAINT approved_payout_snapshots_identity_facts_chk CHECK (
        (identity_actor_version_snapshot IS NULL AND identity_role_version_snapshot IS NULL AND role_enabled_snapshot IS NULL AND security_enabled_snapshot IS NULL AND official_name_status_snapshot IS NULL) OR
        (identity_actor_version_snapshot>0 AND identity_role_version_snapshot>0 AND role_enabled_snapshot IS TRUE AND security_enabled_snapshot IS TRUE AND official_name_status_snapshot='VERIFIED')
    );

ALTER TABLE wlt.customer_manual_withdrawal_intakes
    ADD COLUMN identity_actor_version integer,
    ADD COLUMN identity_role_version integer,
    ADD COLUMN role_enabled boolean,
    ADD COLUMN security_enabled boolean,
    ADD COLUMN official_name_status text,
    ADD CONSTRAINT customer_withdrawal_intakes_identity_facts_chk CHECK (
        (identity_actor_version IS NULL AND identity_role_version IS NULL AND role_enabled IS NULL AND security_enabled IS NULL AND official_name_status IS NULL) OR
        (identity_actor_version>0 AND identity_role_version>0 AND role_enabled IS TRUE AND security_enabled IS TRUE AND official_name_status='VERIFIED')
    );
