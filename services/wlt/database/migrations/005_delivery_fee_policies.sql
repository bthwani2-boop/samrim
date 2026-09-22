CREATE TABLE wlt.delivery_fee_policies (
    id text PRIMARY KEY,
    service_city_id text NOT NULL DEFAULT '',
    policy_version text NOT NULL UNIQUE,
    state text NOT NULL DEFAULT 'ACTIVE',
    base_fee_minor bigint NOT NULL DEFAULT 0,
    distance_unit_meters bigint NOT NULL,
    distance_rate_minor bigint NOT NULL DEFAULT 0,
    order_size_unit_base_units bigint NOT NULL,
    order_size_rate_minor bigint NOT NULL DEFAULT 0,
    zone_surcharge_minor bigint NOT NULL DEFAULT 0,
    rounding_unit_minor bigint NOT NULL DEFAULT 50,
    version integer NOT NULL,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    retired_at timestamptz,
    CONSTRAINT delivery_fee_policies_state_chk CHECK (state IN ('ACTIVE', 'RETIRED')),
    CONSTRAINT delivery_fee_policies_base_chk CHECK (base_fee_minor >= 0),
    CONSTRAINT delivery_fee_policies_distance_unit_chk CHECK (distance_unit_meters > 0),
    CONSTRAINT delivery_fee_policies_distance_rate_chk CHECK (distance_rate_minor >= 0),
    CONSTRAINT delivery_fee_policies_size_unit_chk CHECK (order_size_unit_base_units > 0),
    CONSTRAINT delivery_fee_policies_size_rate_chk CHECK (order_size_rate_minor >= 0),
    CONSTRAINT delivery_fee_policies_zone_chk CHECK (zone_surcharge_minor >= 0),
    CONSTRAINT delivery_fee_policies_rounding_chk CHECK (rounding_unit_minor = 50),
    CONSTRAINT delivery_fee_policies_version_chk CHECK (version > 0),
    CONSTRAINT delivery_fee_policies_retired_chk CHECK ((state = 'ACTIVE' AND retired_at IS NULL) OR (state = 'RETIRED' AND retired_at IS NOT NULL)),
    CONSTRAINT delivery_fee_policies_creator_chk CHECK (length(btrim(created_by)) BETWEEN 1 AND 128)
);

CREATE UNIQUE INDEX delivery_fee_policies_active_scope_uq
    ON wlt.delivery_fee_policies(service_city_id) WHERE state = 'ACTIVE';
CREATE INDEX delivery_fee_policies_scope_idx
    ON wlt.delivery_fee_policies(service_city_id, version DESC, created_at DESC);

CREATE TABLE wlt.delivery_fee_policy_events (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    policy_id text NOT NULL,
    event_type text NOT NULL,
    service_city_id text NOT NULL,
    policy_version text NOT NULL,
    request_hash text NOT NULL,
    idempotency_key text NOT NULL UNIQUE,
    correlation_id text NOT NULL,
    acting_actor_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT delivery_fee_policy_events_policy_fk FOREIGN KEY (policy_id) REFERENCES wlt.delivery_fee_policies(id) ON DELETE RESTRICT,
    CONSTRAINT delivery_fee_policy_events_type_chk CHECK (event_type = 'DELIVERY_FEE_POLICY_ACTIVATED'),
    CONSTRAINT delivery_fee_policy_events_text_chk CHECK (length(btrim(service_city_id)) <= 128 AND length(btrim(policy_version)) BETWEEN 1 AND 128 AND length(btrim(request_hash)) BETWEEN 1 AND 128 AND length(btrim(correlation_id)) BETWEEN 8 AND 128 AND length(btrim(acting_actor_id)) BETWEEN 1 AND 128)
);

INSERT INTO wlt.delivery_fee_policies(id, service_city_id, policy_version, state, base_fee_minor, distance_unit_meters, distance_rate_minor, order_size_unit_base_units, order_size_rate_minor, zone_surcharge_minor, rounding_unit_minor, version, created_by)
VALUES ('delivery-policy-global-v1', '', 'delivery-fee:global:v1', 'ACTIVE', 0, 1000, 0, 1, 0, 0, 50, 1, 'system:migration');
