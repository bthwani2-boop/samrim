CREATE TABLE wlt.partner_store_commission_policies (
    store_id text NOT NULL,
    partner_actor_id text NOT NULL,
    fulfillment_mode text NOT NULL,
    commission_rate_bps integer NOT NULL,
    policy_version integer NOT NULL DEFAULT 1,
    profile_id text NOT NULL,
    profile_version integer NOT NULL,
    rounding_unit_minor bigint NOT NULL DEFAULT 50,
    settlement_period text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    last_changed_by_actor_id text,
    last_change_reason text,
    CONSTRAINT partner_store_commission_policies_pkey PRIMARY KEY (store_id, fulfillment_mode),
    CONSTRAINT partner_store_commission_policies_profile_fk FOREIGN KEY (profile_id) REFERENCES wlt.partner_financial_profiles(id) ON DELETE RESTRICT,
    CONSTRAINT partner_store_commission_policies_mode_chk CHECK (fulfillment_mode IN ('BTHWANI_CAPTAIN','PARTNER_CAPTAIN','CUSTOMER_PICKUP')),
    CONSTRAINT partner_store_commission_policies_rate_chk CHECK (commission_rate_bps BETWEEN 0 AND 10000),
    CONSTRAINT partner_store_commission_policies_version_chk CHECK (policy_version > 0 AND profile_version > 0),
    CONSTRAINT partner_store_commission_policies_rounding_chk CHECK (rounding_unit_minor = 50),
    CONSTRAINT partner_store_commission_policies_period_chk CHECK (settlement_period IN ('DAILY','WEEKLY','MONTHLY')),
    CONSTRAINT partner_store_commission_policies_actor_chk CHECK (length(btrim(store_id)) BETWEEN 1 AND 128 AND length(btrim(partner_actor_id)) BETWEEN 1 AND 128),
    CONSTRAINT partner_store_commission_policies_change_chk CHECK (
        (last_changed_by_actor_id IS NULL AND last_change_reason IS NULL) OR
        (last_changed_by_actor_id IS NOT NULL AND last_change_reason IS NOT NULL AND
            length(btrim(last_changed_by_actor_id)) BETWEEN 1 AND 128 AND
            length(btrim(last_change_reason)) BETWEEN 8 AND 500)
    )
);

CREATE INDEX partner_store_commission_policies_partner_idx
    ON wlt.partner_store_commission_policies(partner_actor_id,store_id,fulfillment_mode);

CREATE TABLE wlt.partner_store_commission_policy_initializations (
    idempotency_key text PRIMARY KEY,
    request_hash text NOT NULL,
    store_id text NOT NULL,
    partner_actor_id text NOT NULL,
    profile_id text NOT NULL REFERENCES wlt.partner_financial_profiles(id) ON DELETE RESTRICT,
    correlation_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT partner_store_commission_policy_initializations_values_chk CHECK (
        length(btrim(idempotency_key)) BETWEEN 8 AND 128 AND
        length(btrim(request_hash)) = 64 AND
        length(btrim(store_id)) BETWEEN 1 AND 128 AND
        length(btrim(partner_actor_id)) BETWEEN 1 AND 128 AND
        length(btrim(correlation_id)) BETWEEN 8 AND 128
    )
);

CREATE TABLE wlt.partner_store_commission_policy_events (
    idempotency_key text PRIMARY KEY,
    request_hash text NOT NULL,
    store_id text NOT NULL,
    partner_actor_id text NOT NULL,
    fulfillment_mode text NOT NULL,
    previous_rate_bps integer NOT NULL,
    new_rate_bps integer NOT NULL,
    previous_policy_version integer NOT NULL,
    new_policy_version integer NOT NULL,
    changed_by_actor_id text NOT NULL,
    reason text NOT NULL,
    correlation_id text NOT NULL,
    changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT partner_store_commission_policy_events_policy_fk FOREIGN KEY (store_id,fulfillment_mode)
        REFERENCES wlt.partner_store_commission_policies(store_id,fulfillment_mode) ON DELETE RESTRICT,
    CONSTRAINT partner_store_commission_policy_events_values_chk CHECK (
        length(btrim(idempotency_key)) BETWEEN 8 AND 128 AND
        length(btrim(request_hash)) = 64 AND
        length(btrim(store_id)) BETWEEN 1 AND 128 AND
        length(btrim(partner_actor_id)) BETWEEN 1 AND 128 AND
        fulfillment_mode IN ('BTHWANI_CAPTAIN','PARTNER_CAPTAIN','CUSTOMER_PICKUP') AND
        previous_rate_bps BETWEEN 0 AND 10000 AND new_rate_bps BETWEEN 0 AND 10000 AND
        previous_policy_version > 0 AND new_policy_version = previous_policy_version + 1 AND
        length(btrim(changed_by_actor_id)) BETWEEN 1 AND 128 AND
        length(btrim(reason)) BETWEEN 8 AND 500 AND
        length(btrim(correlation_id)) BETWEEN 8 AND 128
    )
);

CREATE INDEX partner_store_commission_policy_events_store_idx
    ON wlt.partner_store_commission_policy_events(store_id,fulfillment_mode,changed_at DESC);

ALTER TABLE wlt.customer_payment_allocations
    ADD COLUMN store_id text,
    ADD COLUMN partner_actor_id_snapshot text,
    ADD COLUMN fulfillment_mode text,
    ADD COLUMN commission_rate_bps_snapshot integer,
    ADD COLUMN commission_policy_version_snapshot integer,
    ADD COLUMN commission_profile_id_snapshot text,
    ADD COLUMN commission_profile_version_snapshot integer,
    ADD COLUMN commission_rounding_unit_minor_snapshot bigint,
    ADD COLUMN commission_settlement_period_snapshot text,
    ADD CONSTRAINT customer_payment_allocations_commission_snapshot_chk CHECK (
        (store_id IS NULL AND partner_actor_id_snapshot IS NULL AND fulfillment_mode IS NULL AND commission_rate_bps_snapshot IS NULL AND commission_policy_version_snapshot IS NULL AND commission_profile_id_snapshot IS NULL AND commission_profile_version_snapshot IS NULL AND commission_rounding_unit_minor_snapshot IS NULL AND commission_settlement_period_snapshot IS NULL)
        OR
        (store_id IS NOT NULL AND partner_actor_id_snapshot IS NOT NULL AND fulfillment_mode IS NOT NULL AND commission_rate_bps_snapshot IS NOT NULL AND commission_policy_version_snapshot IS NOT NULL AND commission_profile_id_snapshot IS NOT NULL AND commission_profile_version_snapshot IS NOT NULL AND commission_rounding_unit_minor_snapshot IS NOT NULL AND commission_settlement_period_snapshot IS NOT NULL AND length(btrim(store_id)) BETWEEN 1 AND 128 AND length(btrim(partner_actor_id_snapshot)) BETWEEN 1 AND 128 AND fulfillment_mode IN ('BTHWANI_CAPTAIN','PARTNER_CAPTAIN','CUSTOMER_PICKUP') AND commission_rate_bps_snapshot BETWEEN 0 AND 10000 AND commission_policy_version_snapshot > 0 AND length(btrim(commission_profile_id_snapshot)) BETWEEN 1 AND 128 AND commission_profile_version_snapshot > 0 AND commission_rounding_unit_minor_snapshot=50 AND commission_settlement_period_snapshot IN ('DAILY','WEEKLY','MONTHLY'))
    );
