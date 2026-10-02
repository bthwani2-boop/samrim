-- Retain the old per-store rows as immutable financial history while moving
-- current policy ownership to the canonical commercial store type.
ALTER TABLE wlt.partner_store_commission_policies RENAME TO partner_store_commission_policies_legacy;
ALTER TABLE wlt.partner_store_commission_policy_initializations RENAME TO partner_store_commission_policy_initializations_legacy;
ALTER TABLE wlt.partner_store_commission_policy_events RENAME TO partner_store_commission_policy_events_legacy;

CREATE TABLE wlt.commercial_store_type_commission_policies (
    commercial_store_type_id text NOT NULL,
    fulfillment_mode text NOT NULL,
    commission_rate_bps integer NOT NULL,
    policy_version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    last_changed_by_actor_id text,
    last_change_reason text,
    CONSTRAINT commercial_store_type_commission_policies_pkey PRIMARY KEY (commercial_store_type_id, fulfillment_mode),
    CONSTRAINT commercial_store_type_commission_type_chk CHECK (length(btrim(commercial_store_type_id)) BETWEEN 1 AND 128),
    CONSTRAINT commercial_store_type_commission_mode_chk CHECK (fulfillment_mode IN ('BTHWANI_CAPTAIN','PARTNER_CAPTAIN','CUSTOMER_PICKUP')),
    CONSTRAINT commercial_store_type_commission_rate_chk CHECK (commission_rate_bps BETWEEN 0 AND 10000),
    CONSTRAINT commercial_store_type_commission_version_chk CHECK (policy_version > 0),
    CONSTRAINT commercial_store_type_commission_change_chk CHECK (
        (last_changed_by_actor_id IS NULL AND last_change_reason IS NULL) OR
        (last_changed_by_actor_id IS NOT NULL AND last_change_reason IS NOT NULL AND
            length(btrim(last_changed_by_actor_id)) BETWEEN 1 AND 128 AND
            length(btrim(last_change_reason)) BETWEEN 8 AND 500)
    )
);

CREATE TABLE wlt.commercial_store_type_commission_policy_events (
    idempotency_key text PRIMARY KEY,
    request_hash text NOT NULL,
    commercial_store_type_id text NOT NULL,
    fulfillment_mode text NOT NULL,
    previous_rate_bps integer,
    new_rate_bps integer NOT NULL,
    previous_policy_version integer,
    new_policy_version integer NOT NULL,
    changed_by_actor_id text NOT NULL,
    reason text NOT NULL,
    correlation_id text NOT NULL,
    changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT commercial_store_type_commission_event_policy_fk FOREIGN KEY (commercial_store_type_id,fulfillment_mode)
        REFERENCES wlt.commercial_store_type_commission_policies(commercial_store_type_id,fulfillment_mode) ON DELETE RESTRICT,
    CONSTRAINT commercial_store_type_commission_event_values_chk CHECK (
        length(btrim(idempotency_key)) BETWEEN 8 AND 128 AND length(btrim(request_hash))=64 AND
        length(btrim(commercial_store_type_id)) BETWEEN 1 AND 128 AND
        fulfillment_mode IN ('BTHWANI_CAPTAIN','PARTNER_CAPTAIN','CUSTOMER_PICKUP') AND
        (previous_rate_bps IS NULL OR previous_rate_bps BETWEEN 0 AND 10000) AND new_rate_bps BETWEEN 0 AND 10000 AND
        ((previous_policy_version IS NULL AND new_policy_version=1) OR (previous_policy_version>0 AND new_policy_version=previous_policy_version+1)) AND
        length(btrim(changed_by_actor_id)) BETWEEN 1 AND 128 AND length(btrim(reason)) BETWEEN 8 AND 500 AND
        length(btrim(correlation_id)) BETWEEN 8 AND 128
    )
);

CREATE INDEX commercial_store_type_commission_events_scope_idx
    ON wlt.commercial_store_type_commission_policy_events(commercial_store_type_id,fulfillment_mode,changed_at DESC);

ALTER TABLE wlt.customer_payment_allocations
    ADD COLUMN commercial_store_type_id text;

ALTER TABLE wlt.customer_payment_allocations
    DROP CONSTRAINT customer_payment_allocations_commission_snapshot_chk,
    ADD CONSTRAINT customer_payment_allocations_commission_snapshot_chk CHECK (
        (store_id IS NULL AND partner_actor_id_snapshot IS NULL AND fulfillment_mode IS NULL AND commission_rate_bps_snapshot IS NULL AND commission_policy_version_snapshot IS NULL AND commission_profile_id_snapshot IS NULL AND commission_profile_version_snapshot IS NULL AND commission_rounding_unit_minor_snapshot IS NULL AND commission_settlement_period_snapshot IS NULL AND commercial_store_type_id IS NULL)
        OR
        (store_id IS NOT NULL AND partner_actor_id_snapshot IS NOT NULL AND fulfillment_mode IS NOT NULL AND commission_rate_bps_snapshot IS NOT NULL AND commission_policy_version_snapshot IS NOT NULL AND commission_profile_id_snapshot IS NOT NULL AND commission_profile_version_snapshot IS NOT NULL AND commission_rounding_unit_minor_snapshot IS NOT NULL AND commission_settlement_period_snapshot IS NOT NULL AND length(btrim(store_id)) BETWEEN 1 AND 128 AND length(btrim(partner_actor_id_snapshot)) BETWEEN 1 AND 128 AND fulfillment_mode IN ('BTHWANI_CAPTAIN','PARTNER_CAPTAIN','CUSTOMER_PICKUP') AND commission_rate_bps_snapshot BETWEEN 0 AND 10000 AND commission_policy_version_snapshot > 0 AND length(btrim(commission_profile_id_snapshot)) BETWEEN 1 AND 128 AND commission_profile_version_snapshot > 0 AND commission_rounding_unit_minor_snapshot=50 AND commission_settlement_period_snapshot IN ('DAILY','WEEKLY','MONTHLY') AND (commercial_store_type_id IS NULL OR length(btrim(commercial_store_type_id)) BETWEEN 1 AND 128))
    );
