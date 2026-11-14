-- DSH canonical operational availability; additive to the one canonical Store table.
-- The DSH migration runner replaces __SCHEMA__ after strict SQL-identifier validation.
-- Apply ONLY to a separately isolated synthetic database, after 001_public_discovery.sql.
-- No Customer/Operator/merchant API may write this schema directly.
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
