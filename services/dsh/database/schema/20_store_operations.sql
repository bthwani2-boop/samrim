-- Fresh, disposable DSH schema. Owner: availability and versioned city policies.
-- __SCHEMA__ requires a validated isolated test schema; never overlay retained data.
CREATE TABLE IF NOT EXISTS __SCHEMA__.store_operational_availability (
    store_id text PRIMARY KEY REFERENCES __SCHEMA__.stores(id) ON DELETE RESTRICT,
    store_timezone text NOT NULL CHECK (char_length(store_timezone) BETWEEN 3 AND 64),
    paused_until timestamptz,
    preparation_minutes integer CHECK (preparation_minutes BETWEEN 0 AND 1440),
    version bigint NOT NULL DEFAULT 1 CHECK (version >= 1),
    changed_by_actor text NOT NULL CHECK (char_length(trim(changed_by_actor)) > 0),
    change_reason text NOT NULL CHECK (char_length(trim(change_reason)) BETWEEN 1 AND 300),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS __SCHEMA__.store_operational_weekly_hours (
    store_id text NOT NULL REFERENCES __SCHEMA__.store_operational_availability(store_id) ON DELETE RESTRICT,
    weekday smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),
    opens_minute integer NOT NULL CHECK (opens_minute BETWEEN 0 AND 1439),
    closes_minute integer NOT NULL CHECK (closes_minute BETWEEN 0 AND 1440),
    PRIMARY KEY (store_id, weekday, opens_minute),
    CHECK (opens_minute <> closes_minute)
);
CREATE TABLE IF NOT EXISTS __SCHEMA__.store_operational_commands (
    store_id text NOT NULL REFERENCES __SCHEMA__.store_operational_availability(store_id) ON DELETE RESTRICT,
    operation_id text NOT NULL CHECK (char_length(operation_id) BETWEEN 8 AND 128),
    request_hash text NOT NULL CHECK (char_length(request_hash)=64),
    resulting_version bigint NOT NULL CHECK (resulting_version >= 1),
    result_snapshot jsonb NOT NULL CHECK (jsonb_typeof(result_snapshot) = 'object'),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (store_id, operation_id)
);
CREATE TABLE IF NOT EXISTS __SCHEMA__.store_operational_audit (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    store_id text NOT NULL REFERENCES __SCHEMA__.store_operational_availability(store_id) ON DELETE RESTRICT,
    operation_id text NOT NULL,
    acting_actor_id text NOT NULL,
    authority_source text NOT NULL CHECK (authority_source IN ('MERCHANT_STORE_GRANT', 'OPERATOR_OPERATIONS')),
    reason text NOT NULL CHECK (char_length(trim(reason)) BETWEEN 1 AND 300),
    before_snapshot jsonb NOT NULL,
    after_snapshot jsonb NOT NULL,
    changed_at timestamptz NOT NULL DEFAULT now(),
    policy_version bigint CHECK (policy_version >= 1),
    UNIQUE (store_id, operation_id),
    FOREIGN KEY (store_id, operation_id) REFERENCES __SCHEMA__.store_operational_commands(store_id, operation_id)
);
-- Audits cannot be altered through DSH runtime SQL operations.
CREATE OR REPLACE FUNCTION __SCHEMA__.reject_operational_audit_rewrite()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'operational audit records are immutable';
END;
$$;
DROP TRIGGER IF EXISTS trg_operational_audit_immutable ON __SCHEMA__.store_operational_audit;
CREATE TRIGGER trg_operational_audit_immutable
BEFORE UPDATE OR DELETE ON __SCHEMA__.store_operational_audit
FOR EACH ROW EXECUTE FUNCTION __SCHEMA__.reject_operational_audit_rewrite();

CREATE TABLE IF NOT EXISTS __SCHEMA__.store_operational_limits (
    city_id text PRIMARY KEY REFERENCES __SCHEMA__.service_cities(id) ON DELETE RESTRICT,
    max_pause_seconds integer NOT NULL CHECK (max_pause_seconds BETWEEN 0 AND 31536000),
    max_preparation_minutes integer NOT NULL CHECK (max_preparation_minutes BETWEEN 0 AND 1440),
    version bigint NOT NULL CHECK (version >= 1),
    changed_by_actor text NOT NULL CHECK (char_length(trim(changed_by_actor)) > 0),
    change_reason text NOT NULL CHECK (char_length(trim(change_reason)) BETWEEN 1 AND 300),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- Historical operational audits predate this policy version: keep them NULL,
-- never fabricate a version for an action that was recorded before the policy.
CREATE TABLE IF NOT EXISTS __SCHEMA__.store_operational_limits_audit (
    city_id text NOT NULL REFERENCES __SCHEMA__.service_cities(id) ON DELETE RESTRICT,
    version bigint NOT NULL CHECK (version >= 1),
    max_pause_seconds integer NOT NULL CHECK (max_pause_seconds BETWEEN 0 AND 31536000),
    max_preparation_minutes integer NOT NULL CHECK (max_preparation_minutes BETWEEN 0 AND 1440),
    acting_actor_id text NOT NULL,
    reason text NOT NULL,
    changed_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (city_id, version)
);

-- Enforce monotonically versioned policy changes even if a future writer
-- accidentally omits its expected-version check. Never erase the sole policy.
CREATE OR REPLACE FUNCTION __SCHEMA__.guard_store_operational_limits_version()
RETURNS trigger LANGUAGE plpgsql AS $policy$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Store operational limits cannot be deleted';
    END IF;
    IF TG_OP = 'INSERT' AND NEW.version <> 1 THEN
        RAISE EXCEPTION 'Initial Store operational limits version must be 1';
    END IF;
    IF TG_OP = 'UPDATE' AND (NEW.city_id IS DISTINCT FROM OLD.city_id
        OR NEW.version <> OLD.version + 1) THEN
        RAISE EXCEPTION 'Store operational limits version must advance by one';
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
END;
$policy$;

DROP TRIGGER IF EXISTS trg_store_operational_limits_version ON __SCHEMA__.store_operational_limits;
CREATE TRIGGER trg_store_operational_limits_version
BEFORE INSERT OR UPDATE OR DELETE ON __SCHEMA__.store_operational_limits
FOR EACH ROW EXECUTE FUNCTION __SCHEMA__.guard_store_operational_limits_version();

CREATE OR REPLACE FUNCTION __SCHEMA__.audit_store_operational_limits()
RETURNS trigger LANGUAGE plpgsql AS $policy$
BEGIN
    INSERT INTO __SCHEMA__.store_operational_limits_audit
        (city_id,version,max_pause_seconds,max_preparation_minutes,acting_actor_id,reason)
    VALUES (NEW.city_id,NEW.version,NEW.max_pause_seconds,
        NEW.max_preparation_minutes,NEW.changed_by_actor,NEW.change_reason);
    RETURN NULL;
END;
$policy$;

DROP TRIGGER IF EXISTS trg_store_operational_limits_audit ON __SCHEMA__.store_operational_limits;
CREATE TRIGGER trg_store_operational_limits_audit
AFTER INSERT OR UPDATE ON __SCHEMA__.store_operational_limits
FOR EACH ROW EXECUTE FUNCTION __SCHEMA__.audit_store_operational_limits();

DROP TRIGGER IF EXISTS trg_store_operational_limits_audit_immutable ON __SCHEMA__.store_operational_limits_audit;
CREATE TRIGGER trg_store_operational_limits_audit_immutable
BEFORE UPDATE OR DELETE ON __SCHEMA__.store_operational_limits_audit
FOR EACH ROW EXECUTE FUNCTION __SCHEMA__.reject_operational_audit_rewrite();

CREATE TABLE IF NOT EXISTS __SCHEMA__.store_operational_policy_commands (
    city_id text NOT NULL REFERENCES __SCHEMA__.service_cities(id) ON DELETE RESTRICT,
    operation_id text NOT NULL CHECK (operation_id ~ '^[A-Za-z0-9._-]{8,128}$'),
    request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
    acting_actor_id text NOT NULL CHECK (char_length(trim(acting_actor_id)) BETWEEN 1 AND 128),
    resulting_version bigint NOT NULL CHECK (resulting_version >= 1),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (city_id, operation_id),
    FOREIGN KEY (city_id, resulting_version)
        REFERENCES __SCHEMA__.store_operational_limits_audit(city_id, version)
        ON DELETE RESTRICT
);
-- Commands cannot be removed or rewritten to mask a prior policy outcome.
DROP TRIGGER IF EXISTS trg_store_operational_policy_commands_immutable ON __SCHEMA__.store_operational_policy_commands;
CREATE TRIGGER trg_store_operational_policy_commands_immutable
BEFORE UPDATE OR DELETE ON __SCHEMA__.store_operational_policy_commands
FOR EACH ROW EXECUTE FUNCTION __SCHEMA__.reject_operational_audit_rewrite();

-- One append-only version stream per City/Store relation. This policy is
-- a permissible-mode ceiling, never per-Store admission or payment authority.
CREATE TABLE IF NOT EXISTS __SCHEMA__.city_fulfillment_policy_versions (
    city_id text NOT NULL REFERENCES __SCHEMA__.service_cities(id) ON DELETE RESTRICT,
    relation text NOT NULL CHECK (relation IN ('DIRECT','MARKETPLACE')),
    version bigint NOT NULL CHECK (version BETWEEN 1 AND 9007199254740991),
    operation_id text NOT NULL CHECK (operation_id ~ '^[A-Za-z0-9._-]{8,128}$'),
    allowed_modes text[] NOT NULL CHECK (
        allowed_modes = array_remove(ARRAY[
            CASE WHEN 'BTHWANI_CAPTAIN'=ANY(allowed_modes) THEN 'BTHWANI_CAPTAIN' END,
            CASE WHEN 'PARTNER_CAPTAIN'=ANY(allowed_modes) THEN 'PARTNER_CAPTAIN' END,
            CASE WHEN 'CUSTOMER_PICKUP'=ANY(allowed_modes) THEN 'CUSTOMER_PICKUP' END
        ]::text[],NULL) AND array_position(allowed_modes,NULL) IS NULL
    ),
    acting_actor_id text NOT NULL CHECK (char_length(acting_actor_id) BETWEEN 1 AND 128 AND acting_actor_id=trim(acting_actor_id)),
    reason text NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 300 AND reason=trim(reason)),
    recorded_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
    PRIMARY KEY (city_id,relation,version),
    UNIQUE (city_id,relation,operation_id)
);

CREATE OR REPLACE FUNCTION __SCHEMA__.guard_city_fulfillment_policy_version()
RETURNS trigger LANGUAGE plpgsql AS $policy$
DECLARE
    city_active boolean;
    previous_version bigint;
BEGIN
    SELECT active INTO city_active FROM __SCHEMA__.service_cities WHERE id=NEW.city_id FOR UPDATE;
    IF city_active IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'Fulfillment policy requires an active City';
    END IF;
    SELECT COALESCE(max(version),0) INTO previous_version
        FROM __SCHEMA__.city_fulfillment_policy_versions
        WHERE city_id=NEW.city_id AND relation=NEW.relation;
    IF NEW.version <> previous_version+1 THEN
        RAISE EXCEPTION 'Fulfillment policy version must advance by one';
    END IF;
    NEW.recorded_at := transaction_timestamp();
    RETURN NEW;
END;
$policy$;
DROP TRIGGER IF EXISTS trg_city_fulfillment_policy_version ON __SCHEMA__.city_fulfillment_policy_versions;
CREATE TRIGGER trg_city_fulfillment_policy_version
BEFORE INSERT ON __SCHEMA__.city_fulfillment_policy_versions
FOR EACH ROW EXECUTE FUNCTION __SCHEMA__.guard_city_fulfillment_policy_version();
DROP TRIGGER IF EXISTS trg_city_fulfillment_policy_immutable ON __SCHEMA__.city_fulfillment_policy_versions;
CREATE TRIGGER trg_city_fulfillment_policy_immutable
BEFORE UPDATE OR DELETE ON __SCHEMA__.city_fulfillment_policy_versions
FOR EACH ROW EXECUTE FUNCTION __SCHEMA__.reject_operational_audit_rewrite();
